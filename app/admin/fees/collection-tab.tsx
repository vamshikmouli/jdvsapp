'use client';

import { toast } from '@/lib/toast';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Select, Input, Field, Drawer, Modal, EmptyState, Skeleton, TableRowSkeleton, Avatar, Chip, Th, sortRows, nextSort, type SortState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';
import { feeMoney, statusTone, statusLabel, PAY_METHODS, PAY_METHOD_LABEL, type ChargeStatus, type AccountSummary } from '@/lib/fees';
import { CLASSES, CLASS_ID_BY_KEY, CLASS_KEY_BY_ID, VILLAGE_VAN_FEES, type Gender as FeeGender, type ClassKey } from '@/lib/feeStructure';
import { UNIFORM_ITEM_DEFS, itemsForFromMatrix, type UniformMatrix } from '@/lib/uniformMatrix';
import { CollectDrawer, PaymentTimeline, type Account } from './account-ui';
import { MultiCollectDrawer } from './multi-collect-ui';
import { useBranding } from '@/components/useBranding';
import { CollectionSettingsPanel } from './collection-settings';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query';
import { shortClass } from './_shared';

/* ============================ Collection ============================ */

interface AccountRow {
  id: string;
  name: string;
  fatherName: string | null;
  phone: string | null;
  classId: string | null;
  className: string | null;
  village: string | null;
  totalCharged: number;
  totalPaid: number;
  totalBalance: number;
  status: ChargeStatus;
  hasVan?: boolean;
  lastPaidAt?: string | null;
  lastSeq?: number;
  siblingCount?: number;
  heads?: { name: string; balance: number }[];
}

// A little cluster of person icons showing how many children the parent has (1–4,
// capped). When `onClick` is given it becomes the button that opens Multi Collect
// (the family payment drawer) for that family.
function SiblingIcons({ count, onClick }: { count: number; onClick?: (e: React.MouseEvent) => void }) {
  const n = Math.min(Math.max(1, count), 4);
  const inner = (
    <>
      {Array.from({ length: n }).map((_, i) => <Icon key={i} name="User" size={12} className="-ml-1 first:ml-0" />)}
      {count > 4 && <span className="text-[10px] font-semibold ml-0.5">{count}</span>}
    </>
  );
  const title = `${count} child${count === 1 ? '' : 'ren'} for this parent — open family payment`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title}
        className="inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-slate-400 hover:text-purple-700 hover:bg-purple-50 transition-colors">
        {inner}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-slate-400" title={title}>{inner}</span>
  );
}

export function CollectionTab({ refreshKey, canCollect, canVoid, canNotify, canManage }: { refreshKey?: number; canCollect: boolean; canVoid?: boolean; canNotify?: boolean; canManage?: boolean }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [classId, setClassId] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [multiId, setMultiId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{ id: string; name: string } | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'recent', dir: 'desc' }); // most recent collection → top
  const onSort = (k: string) => setSort((s) => nextSort(s, k));

  // Debounce the free-text search so typing doesn't fire a query per keystroke.
  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 250); return () => clearTimeout(t); }, [search]);

  // status order so "paid" sorts to the top in ascending order
  const STATUS_RANK: Record<string, number> = { paid: 0, partial: 1, due: 2, overdue: 3 };

  // Unpaid uniform / ID-card / item heads — flags students who took items on credit.
  const itemsDue = (r: AccountRow) =>
    (r.heads || []).filter((h) => h.balance > 0 && /uniform|tie|belt|sock|id\s*card|track\s*suit/i.test(h.name));
  const itemsDueTotal = (r: AccountRow) => itemsDue(r).reduce((t, h) => t + h.balance, 0);

  const accountsUrl = (() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (filter !== 'all') params.set('filter', filter);
    if (classId !== 'all') params.set('classId', classId);
    return `/api/fees/accounts?${params}`;
  })();
  // Cached per (search, filter, class); refreshKey bumps after a bulk import.
  const { data, isLoading: loading, error: queryError, refetch } = useQuery({
    queryKey: ['fees', 'accounts', debouncedSearch, filter, classId, refreshKey ?? 0],
    queryFn: () => jsonFetcher<{ rows: AccountRow[] }>(accountsUrl),
  });
  const rows = data?.rows ?? [];
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : '';
  // Kept for the collect / multi-collect drawers' onDone — force a refresh.
  const fetchRows = useCallback(async () => { await refetch(); }, [refetch]);

  // Class list for the class-wise filter/print (its own cached query).
  const { data: gridData } = useQuery({
    queryKey: ['fees', 'grid'],
    queryFn: () => jsonFetcher<{ classes?: { id: string; name: string }[] }>('/api/fees/grid'),
  });
  const classList = (gridData?.classes ?? []).map((c) => ({ id: c.id, name: c.name }));


  const sorted = useMemo(
    () => sortRows(rows, sort, (r, k) =>
      k === 'name' ? r.name :
      k === 'className' ? (r.className || '') :
      k === 'totalCharged' ? r.totalCharged :
      k === 'totalPaid' ? r.totalPaid :
      k === 'totalBalance' ? r.totalBalance :
      k === 'recent' ? (r.lastSeq ?? 0) :
      k === 'status' ? STATUS_RANK[r.status] ?? 9 : r.name
    ),
    [rows, sort]
  );

  // ---- Bulk personalized fee reminders (select many → notify each parent with their balance) ----
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const selectableIds = useMemo(() => sorted.filter((r) => r.totalBalance > 0).map((r) => r.id), [sorted]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(() => (allSelected ? new Set<string>() : new Set(selectableIds)));
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const selectedTotal = selectedRows.reduce((t, r) => t + r.totalBalance, 0);
  const colCount = canNotify ? 7 : 6;

  // ---- Printable cut-out fee chits — one small slip per student, ~30 per A4 ----
  const brand = useBranding();
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
  const printHtml = (title: string, inner: string) => {
    const w = window.open('', '_blank');
    if (!w) { toast.error('Please allow pop-ups to print.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${inner}<script>window.onload=function(){window.focus();window.print();};</script></head></html>`);
    w.document.close();
  };

  // Individual slips the office cuts along the dashed lines and hands to students.
  const printChits = () => {
    // Only students who actually owe something — skip fully-paid (zero balance) students.
    const list = [...sorted]
      .filter((r) => r.totalBalance > 0)
      .sort((a, b) => (a.className || '').localeCompare(b.className || '') || a.name.localeCompare(b.name));
    if (!list.length) { toast.info('No students with a pending balance to print.'); return; }
    const now = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const chits = list
      .map(
        (r) => {
          // Show fee heads only — exclude uniform (items) from the chit.
          const heads = (r.heads || []).filter((h) => h.balance > 0 && !/uniform/i.test(h.name));
          const lines = heads.map((h) => `<div class="row"><span>${esc(h.name)}</span><span>₹${fmt(h.balance)}</span></div>`).join('');
          return `<div class="chit">
          <div class="nm">${esc(r.name)}</div>
          <div class="cl">Class: <b>${esc(shortClass(r.className) || '—')}</b></div>
          ${lines}
          <div class="row bal"><span>Total Balance</span><span>₹${fmt(r.totalBalance)}</span></div>
          <div class="dt">${now}</div>
        </div>`;
        }
      )
      .join('');
    printHtml(
      'Fee Chits',
      `<style>
        @page { size: A4 portrait; margin: 8mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
        .sheet { font-size: 0; }
        .chit { display: inline-block; vertical-align: top; width: 48.5%; margin: 0 0.6% 9px; padding: 12px 14px 9px;
                border: 1.5px dashed #888; border-radius: 6px; page-break-inside: avoid; }
        .nm { font-size: 16px; font-weight: 700; line-height: 1.2; }
        .cl { font-size: 12.5px; color: #333; margin: 3px 0 6px; }
        .row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; padding: 1px 0; }
        .row.bal { font-weight: 700; border-top: 1px solid #ddd; margin-top: 3px; padding-top: 6px; }
        .row.bal span:first-child { font-size: 13px; }
        .row.bal span:last-child { color: #b00; font-size: 18px; }
        .dt { font-size: 10px; color: #999; text-align: right; margin-top: 6px; }
      </style></head><body><div class="sheet">${chits}</div></body>`
    );
  };

  // Plain office list (Name / Class / Paid / Balance), 40+ per A4.
  const printList = () => {
    const list = [...sorted].sort((a, b) => (a.className || '').localeCompare(b.className || '') || a.name.localeCompare(b.name));
    if (!list.length) return;
    const now = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const filterLabel: Record<string, string> = { all: 'All students', due: 'With balance', paid: 'Fully paid', overdue: 'Overdue', van: 'Van students' };
    const clsName = classId === 'all' ? 'All classes' : (classList.find((c) => c.id === classId)?.name || 'Class');
    const sub = `${clsName} · ${filterLabel[filter] || 'All students'}${search ? ` · "${esc(search)}"` : ''} · ${list.length} students · ${now}`;
    const totPaid = list.reduce((t, r) => t + r.totalPaid, 0);
    const totBal = list.reduce((t, r) => t + r.totalBalance, 0);
    const body = list
      .map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td class="c">${esc(shortClass(r.className) || '—')}</td><td class="r">${fmt(r.totalPaid)}</td><td class="r b">${fmt(r.totalBalance)}</td></tr>`)
      .join('');
    printHtml(
      'Balance Fee List',
      `<style>
        @page { size: A4 portrait; margin: 12mm 10mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
        h1 { font-size: 15px; margin: 0; }
        .sub { font-size: 10px; color: #555; margin: 2px 0 8px; }
        table { width: 100%; border-collapse: collapse; }
        thead { display: table-header-group; }
        th, td { border: 1px solid #999; padding: 2px 6px; font-size: 11px; line-height: 1.35; }
        th { background: #eee; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
        td.c, th.c { text-align: center; }
        td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
        td.b { font-weight: 700; }
        tr { page-break-inside: avoid; }
        tfoot td { font-weight: 700; background: #f4f4f4; }
        .sl { width: 34px; } .cl { width: 60px; } .amt { width: 90px; }
      </style></head><body>
        <h1>${esc(brand.schoolName)} — Balance Fee List</h1>
        <div class="sub">${sub}</div>
        <table>
          <thead><tr><th class="c sl">#</th><th>Student name</th><th class="c cl">Class</th><th class="r amt">Paid (₹)</th><th class="r amt">Balance (₹)</th></tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr><td></td><td colspan="2">Total (${list.length})</td><td class="r">${fmt(totPaid)}</td><td class="r">${fmt(totBal)}</td></tr></tfoot>
        </table>
      </body>`
    );
  };

  return (
    <>
      {/* Prominent search bar */}
      <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
        <div className="flex items-center gap-2 flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-500/20 shadow-xs">
          <Icon name="Search" size={18} className="text-slate-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search by name, admission no, father / mother name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-slate-400"
          />
          {search && <button onClick={() => setSearch('')} className="text-slate-300 hover:text-slate-500" title="Clear"><Icon name="X" size={16} /></button>}
        </div>
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full sm:w-40">
          <option value="all">All classes</option>
          {classList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full sm:w-40">
          <option value="all">All students</option>
          <option value="due">Has balance</option>
          <option value="paid">Fully paid</option>
          <option value="overdue">Overdue</option>
          <option value="van">Van students</option>
        </Select>
        <Button kind="secondary" icon="Scissors" onClick={printChits} disabled={loading || sorted.length === 0} className="w-full sm:w-auto">Print chits</Button>
        <Button kind="secondary" icon="Printer" onClick={printList} disabled={loading || sorted.length === 0} className="w-full sm:w-auto">Print list</Button>
      </div>

      {canNotify && selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5">
          <div className="text-sm text-purple-900 font-medium inline-flex items-center gap-2">
            <Icon name="CheckSquare" size={16} />
            {selected.size} selected · total due <span className="tabular-nums font-bold">{feeMoney(selectedTotal)}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" kind="primary" icon="Send" onClick={() => setBulkOpen(true)}>Notify {selected.size} parent{selected.size > 1 ? 's' : ''}</Button>
          </div>
        </div>
      )}

      <Card
        className="mt-4"
        padded={false}
        title={<span className="text-sm font-medium text-slate-500">{loading ? 'Loading…' : `${rows.length} student${rows.length === 1 ? '' : 's'}`}</span>}
      >
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {canNotify && (
                  <th className="w-10 pl-6 pr-1 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectableIds.length === 0}
                      className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20 align-middle" title="Select all with a balance" />
                  </th>
                )}
                <Th label="Student" sortKey="name" sort={sort} onSort={onSort} />
                <Th label="Class" sortKey="className" sort={sort} onSort={onSort} />
                <Th label="Total" sortKey="totalCharged" sort={sort} onSort={onSort} align="right" />
                <Th label="Paid" sortKey="totalPaid" sort={sort} onSort={onSort} align="right" />
                <Th label="Balance" sortKey="totalBalance" sort={sort} onSort={onSort} align="right" />
                <Th label="Status" sortKey="status" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} cols={colCount} />)}
              {!loading && error && (
                <tr><td colSpan={colCount} className="py-12"><EmptyState icon="AlertCircle" title="Couldn't load accounts" body={error} /></td></tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr><td colSpan={colCount} className="py-12"><EmptyState icon="SearchX" title="No students match" body="Try a different search or filter." /></td></tr>
              )}
              {!loading && !error && sorted.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${selected.has(r.id) ? 'bg-purple-50/40' : ''}`}>
                  {canNotify && (
                    <td className="pl-6 pr-1" onClick={(e) => e.stopPropagation()}>
                      {r.totalBalance > 0 ? (
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)}
                          className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20 align-middle" />
                      ) : null}
                    </td>
                  )}
                  <td className="py-3 px-6">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.name} size="sm" />
                      <div>
                        <div className="font-medium text-slate-900">{r.name}</div>
                        {r.fatherName && <div className="text-xs text-slate-500">S/o {r.fatherName}</div>}
                        {r.village && <div className="text-xs text-slate-500 inline-flex items-center gap-1"><Icon name="MapPin" size={11} className="text-slate-400" /> {r.village}</div>}
                        <div className="text-xs text-slate-500 font-mono flex items-center gap-2">
                          <span>{r.id}</span>
                          {r.phone && (
                            <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-slate-500 hover:text-purple-700" title="Call">
                              <Icon name="Phone" size={11} /> {r.phone}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-6">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium">{shortClass(r.className)}</span>
                      <SiblingIcons count={r.siblingCount || 1} onClick={canCollect ? (e) => { e.stopPropagation(); setMultiId(r.id); } : undefined} />
                    </span>
                  </td>
                  <td className="py-3 px-6 text-right tabular-nums text-slate-700">{feeMoney(r.totalCharged)}</td>
                  <td className="py-3 px-6 text-right tabular-nums text-success-700">
                    <div>{feeMoney(r.totalPaid)}</div>
                    {r.lastPaidAt && <div className="text-[11px] font-normal text-slate-400 mt-0.5">Last {new Date(r.lastPaidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</div>}
                  </td>
                  <td className="py-3 px-6 text-right tabular-nums font-semibold text-slate-900">{feeMoney(r.totalBalance)}</td>
                  <td className="py-3 px-6">
                    <div className="flex items-center gap-2">
                      <Chip tone={statusTone(r.status)}>{statusLabel(r.status)}</Chip>
                      {itemsDueTotal(r) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-marigold-50 text-marigold-700 text-[11px] font-semibold whitespace-nowrap"
                          title={itemsDue(r).map((h) => `${h.name}: ${feeMoney(h.balance)}`).join('\n')}>
                          <Icon name="Shirt" size={11} /> Uniform/items due {feeMoney(itemsDueTotal(r))}
                        </span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setTimeline({ id: r.id, name: r.name }); }}
                        className="inline-flex items-center justify-center rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 p-1.5" title="Payment history"><Icon name="Eye" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="sm:hidden">
          {loading && <div className="divide-y divide-slate-100">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="px-4 py-3"><Skeleton height={40} rounded="md" /></div>)}</div>}
          {!loading && error && <div className="py-12"><EmptyState icon="AlertCircle" title="Couldn't load accounts" body={error} /></div>}
          {!loading && !error && rows.length === 0 && <div className="py-12"><EmptyState icon="SearchX" title="No students match" body="Try a different search or filter." /></div>}
          {!loading && !error && (
            <div className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <div key={r.id} onClick={() => setOpenId(r.id)} className={`flex items-center gap-3 px-4 py-3 active:bg-slate-50 ${selected.has(r.id) ? 'bg-purple-50/40' : ''}`}>
                  {canNotify && (
                    <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0 w-5">
                      {r.totalBalance > 0 && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />}
                    </div>
                  )}
                  <Avatar name={r.name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 truncate">{r.name}</div>
                    {r.fatherName && <div className="text-[11px] text-slate-500 truncate">S/o {r.fatherName}</div>}
                    <div className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">{shortClass(r.className)} · {r.id}{r.village ? ` · ${r.village}` : ''} <SiblingIcons count={r.siblingCount || 1} onClick={canCollect ? (e) => { e.stopPropagation(); setMultiId(r.id); } : undefined} /></div>
                    {r.phone && <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="text-[11px] text-purple-700 inline-flex items-center gap-1"><Icon name="Phone" size={10} /> {r.phone}</a>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-semibold tabular-nums text-slate-900">{feeMoney(r.totalBalance)}</div>
                    <div className="mt-0.5"><Chip tone={statusTone(r.status)}>{statusLabel(r.status)}</Chip></div>
                    {r.lastPaidAt && <div className="mt-0.5 text-[10px] text-slate-400">Last paid {new Date(r.lastPaidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>}
                    {itemsDueTotal(r) > 0 && <div className="mt-0.5 text-[10px] font-semibold text-marigold-700 inline-flex items-center gap-0.5"><Icon name="Shirt" size={10} /> Uniform/items due</div>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setTimeline({ id: r.id, name: r.name }); }}
                    className="flex-shrink-0 inline-flex items-center justify-center rounded-lg bg-purple-50 text-purple-600 p-1.5" title="Payment history"><Icon name="Eye" size={18} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {openId && <CollectDrawer studentId={openId} onClose={() => setOpenId(null)} onDone={async () => { setOpenId(null); await fetchRows(); }} />}
      {multiId && <MultiCollectDrawer studentId={multiId} onClose={() => setMultiId(null)} onDone={async () => { setMultiId(null); await fetchRows(); }} />}
      {timeline && <PaymentTimeline studentId={timeline.id} name={timeline.name} onClose={() => setTimeline(null)} />}
      {bulkOpen && (
        <BulkNotifyModal
          students={selectedRows.map((r) => ({ id: r.id, name: r.name, className: r.className, balance: r.totalBalance }))}
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); setSelected(new Set()); }}
        />
      )}
    </>
  );
}


/* ---------- Bulk fee import (Excel) ---------- */
export function FeeImportDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [rows, setRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fmt, setFmt] = useState<'long' | 'wide'>('wide');

  // Wide fee-sheet template (matches Export): three columns (Assigned / Paid /
  // Date) per fee head. Two example rows show one student paying tuition in two
  // installments — a second row (blank Assigned) records the later payment.
  const downloadTemplate = () => {
    const cols = ['Name', 'Father Name', 'Student ID', 'Class',
      'Tuition Fee — Assigned', 'Tuition Fee — Paid', 'Tuition Fee — Date',
      'ID Card — Assigned', 'ID Card — Paid', 'ID Card — Date',
      'School Uniform — Assigned', 'School Uniform — Paid', 'School Uniform — Date',
      'Socks — Assigned', 'Socks — Paid', 'Socks — Date'];
    const blank = Object.fromEntries(cols.map((c) => [c, '']));
    const rows = [
      { ...blank, 'Name': 'Aarav Sharma', 'Father Name': 'Ramesh Sharma', 'Student ID': 'JD1781200142909001', 'Class': '1st STD',
        'Tuition Fee — Assigned': 12000, 'Tuition Fee — Paid': 5000, 'Tuition Fee — Date': '2026-06-01',
        'ID Card — Assigned': 120, 'ID Card — Paid': 120, 'ID Card — Date': '2026-06-01',
        'School Uniform — Assigned': 900, 'School Uniform — Paid': 900, 'School Uniform — Date': '2026-06-05',
        'Socks — Assigned': 60, 'Socks — Paid': 60, 'Socks — Date': '2026-06-05' },
      { ...blank, 'Name': 'Aarav Sharma', 'Student ID': 'JD1781200142909001', 'Class': '1st STD',
        'Tuition Fee — Paid': 7000, 'Tuition Fee — Date': '2026-07-01' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: cols });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fees');
    XLSX.writeFile(wb, 'fee-sheet-template.xlsx');
  };

  // Detect the wide fee sheet (from Export) vs the classic long format: the wide
  // sheet has "<Head> — Assigned/Paid/Date" columns and no "Fee Head" column.
  const detectWide = (raw: any[]) => {
    const keys = raw.length ? Object.keys(raw[0]).map((k) => String(k).trim().toLowerCase()) : [];
    const hasHead = keys.includes('fee head') || keys.includes('feehead');
    const hasGroups = keys.some((k) => /[—-]\s*(assigned|paid|date)$/.test(k));
    return hasGroups && !hasHead;
  };

  const onFile = async (file: File) => {
    setError(''); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const wide = detectWide(raw);
      setFmt(wide ? 'wide' : 'long');
      // Wide → send raw header-keyed rows (dynamic uniform columns). Long → map.
      const payloadRows = wide ? raw : raw.map((r) => ({
        admissionNo: r['Student ID'] ?? r['StudentID'] ?? r['Admission No'] ?? r['admissionNo'] ?? '',
        name: r['Student Name'] ?? r['Name'] ?? r['name'] ?? '',
        phone: r['Phone'] ?? r['phone'] ?? '',
        className: r['Class'] ?? r['className'] ?? '',
        yearStr: r['Academic Year'] ?? r['Year'] ?? r['yearStr'] ?? '',
        feeHead: r['Fee Head'] ?? r['feeHead'] ?? '',
        assigned: r['Assigned'] ?? r['assigned'] ?? 0,
        concession: r['Concession'] ?? r['concession'] ?? 0,
        paid: r['Paid'] ?? r['paid'] ?? 0,
        date: r['Date'] ?? r['date'] ?? '',
        mode: r['Payment Mode'] ?? r['Mode'] ?? r['mode'] ?? '',
      }));
      setRows(payloadRows);
      setBusy(true);
      const res = await fetch('/api/fees/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: payloadRows, format: wide ? 'wide' : 'long', dryRun: true }) });
      const d = await res.json();
      setBusy(false);
      if (!res.ok) { setError(d.error || 'Failed to read file'); return; }
      setPreview(d); setStep('preview');
    } catch (e) { setBusy(false); setError(e instanceof Error ? e.message : 'Could not read the file'); }
  };

  const apply = async () => {
    if (!confirm('Apply the import? This adds the fees/payments to the matched students. Existing fees are kept and duplicate payments are skipped.')) return;
    setBusy(true); setError('');
    const res = await fetch('/api/fees/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, format: fmt, dryRun: false }) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setError(d.error || 'Import failed'); return; }
    setResult(d); setStep('done');
  };

  return (
    <Drawer open onClose={onClose} title="Bulk fee import" subtitle="Upload assigned fees, concessions and collected amounts from Excel" width={620}
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-400">{step === 'preview' && preview ? `${preview.matchedStudents} students · ${preview.totalRows} rows` : ''}</div>
          <div className="flex gap-2">
            <Button onClick={step === 'done' ? onDone : onClose}>{step === 'done' ? 'Done' : 'Cancel'}</Button>
            {step === 'preview' && <Button kind="primary" icon="Check" onClick={apply} disabled={busy || preview?.matchedStudents === 0}>{busy ? 'Importing…' : `Import ${preview?.matchedStudents || 0} students`}</Button>}
          </div>
        </div>
      }>
      {error && <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}

      {step === 'upload' && (
        <div className="space-y-4">
          <div className="rounded-lg bg-purple-50 border border-purple-100 p-3 text-sm text-purple-800">
            One row per student — the same layout <b>Export</b> produces, so you can export, edit and re-upload. After <b>Name</b>, <b>Father Name</b>, <b>Student ID</b>, <b>Class</b>, each fee head has three columns: <b>“Head — Assigned”</b>, <b>“Head — Paid”</b>, <b>“Head — Date”</b> — one group per fee head, and one per uniform item.
          </div>
          <ul className="text-xs text-slate-500 list-disc pl-5 space-y-1">
            <li>Match is by <b>Student ID</b> (best); otherwise <b>Name</b> (<b>Class</b> helps when names repeat).</li>
            <li><b>Assigned</b> sets that head's charge (blank = use the configured class/uniform fee). <b>Paid</b> is what was collected.</li>
            <li>Heads paid on the <b>same Date</b> become one receipt; different dates = separate receipts. Dates as <b>yyyy-mm-dd</b> or dd/mm/yyyy; blank = today.</li>
            <li>Applying <b>adds/updates</b> each student — existing receipts are kept and duplicates skipped (safe to re-upload the same file).</li>
            <li>The classic long format (with a <b>Fee Head</b> column) is still accepted too.</li>
          </ul>
          <Button icon="Download" onClick={downloadTemplate}>Download template</Button>
          <div>
            <label className="block">
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/40 transition-colors">
                <Icon name="Upload" size={28} className="text-slate-400 mx-auto" />
                <div className="text-sm font-medium text-slate-700 mt-2">{busy ? 'Reading…' : 'Choose an Excel file'}</div>
                <div className="text-xs text-slate-400 mt-0.5">.xlsx / .xls</div>
              </div>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            </label>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="text-sm text-slate-500">{fileName}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { label: 'Assigned', value: feeMoney(preview.totals.assigned), tone: 'text-slate-900' },
              { label: 'Concession', value: feeMoney(preview.totals.concession), tone: 'text-info-700' },
              { label: 'Collected', value: feeMoney(preview.totals.paid), tone: 'text-success-700' },
              { label: 'Due', value: feeMoney(preview.totals.due), tone: 'text-danger-700' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-slate-200 px-3 py-2.5 text-center">
                <div className={`text-base font-bold tabular-nums ${s.tone}`}>{s.value}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 text-success-700 px-2.5 py-1"><Icon name="CheckCircle2" size={14} />{preview.matchedStudents} students matched</span>
            {preview.unmatched.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2.5 py-1"><Icon name="AlertTriangle" size={14} />{preview.unmatched.length} unmatched</span>}
            {preview.errors.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 text-danger-700 px-2.5 py-1"><Icon name="XCircle" size={14} />{preview.errors.length} errors</span>}
          </div>

          {preview.errors.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Errors (these rows are skipped)</div>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                {preview.errors.slice(0, 50).map((e: any, i: number) => <div key={i} className="px-3 py-1.5 text-danger-700">Row {e.rowNo}: {e.reason}</div>)}
              </div>
            </div>
          )}
          {preview.unmatched.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Unmatched students (skipped — fix and re-upload)</div>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                {preview.unmatched.slice(0, 50).map((u: any, i: number) => <div key={i} className="px-3 py-1.5"><span className="text-slate-700">{u.name || '—'}{u.phone ? ` · ${u.phone}` : ''}</span> <span className="text-amber-700">— {u.reason}</span></div>)}
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-400">Only the {preview.matchedStudents} matched students are imported. Existing fees are kept — this adds charges/payments and skips duplicates.</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="text-center py-4">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={26} /></div>
          <p className="text-sm text-slate-700"><b>{result.appliedStudents}</b> students imported · <b>{result.paymentsCreated}</b> opening payments recorded.</p>
          <p className="text-xs text-slate-500 mt-1">Collected {feeMoney(result.totals.paid)} · Due {feeMoney(result.totals.due)}{result.unmatched.length ? ` · ${result.unmatched.length} skipped` : ''}.</p>
        </div>
      )}
    </Drawer>
  );
}

/* ---------- Bulk personalized fee reminder ---------- */

// Mirrors the approved WhatsApp template "school_fee_reminder" so the in-app /
// push message matches what parents receive on WhatsApp.
const DEFAULT_BULK_TEMPLATE = `Dear {guardian},
Fee reminder from Jnana Deepika Vidhya Samsthe.
Student: {name} — Class {class}
Outstanding balance: {balance}
{breakup}
Please pay at the school office. Thank you.`;

function BulkNotifyModal({ students, onClose, onDone }: { students: { id: string; name: string; className: string | null; balance: number }[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('Fee payment reminder');
  const [body, setBody] = useState(DEFAULT_BULK_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skippedZero: number; pushSent: number; waSent?: number; waFailed?: number; waDetails?: { student: string; className: string | null; name: string; to: string; ok: boolean; error?: string }[] } | null>(null);

  const total = students.reduce((t, s) => t + s.balance, 0);
  const insertToken = (tok: string) => setBody((b) => b + tok);

  const send = async () => {
    setBusy(true); setError('');
    try {
      if (!title.trim() || !body.trim()) throw new Error('Title and message are required');
      const res = await fetch('/api/circulars/bulk-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: students.map((s) => s.id), title: title.trim(), body: body.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal open onClose={onDone} title="Reminders sent" width={480}
        footer={<div className="flex justify-end"><Button kind="primary" onClick={onDone}>Done</Button></div>}>
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={26} /></div>
          <p className="text-sm text-slate-700"><span className="font-semibold">{result.created}</span> personalized reminder{result.created === 1 ? '' : 's'} sent — each parent got their own balance.</p>
          <p className="text-xs text-slate-500 mt-1">{result.waSent ? `${result.waSent} WhatsApp sent · ` : ''}{result.pushSent} phone notification{result.pushSent === 1 ? '' : 's'} delivered{result.skippedZero ? ` · ${result.skippedZero} skipped (no balance)` : ''}{result.waFailed ? ` · ${result.waFailed} WhatsApp failed (no number/blocked)` : ''}.</p>
        </div>
        {result.waDetails && result.waDetails.length > 0 && (
          <div className="mt-3 text-left">
            <div className="text-xs font-semibold text-slate-600 mb-1.5">Per-number delivery ({result.waDetails.length})</div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {[...result.waDetails].sort((a, b) => Number(a.ok) - Number(b.ok)).map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{d.student} <span className="text-slate-400">· {shortClass(d.className)}</span></div>
                    <div className="text-slate-500 truncate">{d.name}{d.to ? ` · ${d.to}` : ''}</div>
                  </div>
                  {d.ok
                    ? <span className="flex-shrink-0 inline-flex items-center gap-1 text-success-700 font-medium"><Icon name="Check" size={13} /> Sent</span>
                    : <span className="flex-shrink-0 text-danger-700 font-medium text-right max-w-[45%] truncate" title={d.error}>Failed{d.error ? `: ${d.error}` : ''}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Notify parents" subtitle={`${students.length} student${students.length === 1 ? '' : 's'} · total due ${feeMoney(total)}`} width={580}
      footer={<div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" icon="Send" onClick={send} disabled={busy}>{busy ? 'Sending…' : `Send to ${students.length}`}</Button>
      </div>}>
      <div className="space-y-4">
        {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}

        <div className="rounded-lg bg-purple-50 border border-purple-100 px-3 py-2.5 text-xs text-purple-800">
          Each parent receives their <b>own child’s balance</b>. This text is the in-app &amp; phone notification. On <b>WhatsApp</b> the approved <span className="font-mono">school_fee_reminder</span> template is sent (same details — parent, student, class, balance) to the father, mother and fee-contact numbers.
        </div>

        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label="Message template" hint="Tap a tag to insert it">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none resize-y font-mono" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {[
            { t: '{name}', d: 'Student name' },
            { t: '{firstname}', d: 'First name' },
            { t: '{class}', d: 'Class' },
            { t: '{guardian}', d: 'Parent name' },
            { t: '{balance}', d: 'Amount due' },
            { t: '{breakup}', d: 'Fee-wise dues' },
          ].map((tok) => (
            <button key={tok.t} type="button" onClick={() => insertToken(tok.t)} title={tok.d}
              className="text-[11px] font-mono rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600 hover:border-purple-300 hover:text-purple-700">{tok.t}</button>
          ))}
        </div>

        <div>
          <div className="text-xs font-medium text-slate-500 mb-1.5">Recipients</div>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {students.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span className="text-slate-700">{s.name} <span className="text-slate-400 text-xs">· {shortClass(s.className)}</span></span>
                <span className="tabular-nums text-slate-600">{feeMoney(s.balance)}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-slate-400">Goes to each student’s parent in the app + as a phone notification (if they enabled it). Students with no balance are skipped.</p>
      </div>
    </Modal>
  );
}

/* ---------- Ledger drawer (per-student account) ---------- */

