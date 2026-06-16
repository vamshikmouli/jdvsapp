'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Select, Input, Field, Drawer, Modal, EmptyState, Skeleton, TableRowSkeleton, Avatar, Chip, Th, sortRows, nextSort, type SortState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';
import { feeMoney, statusTone, statusLabel, PAY_METHODS, PAY_METHOD_LABEL, type ChargeStatus, type AccountSummary } from '@/lib/fees';
import { CLASSES, CLASS_ID_BY_KEY, ID_CARD_FEE, NEW_ADMISSION_FEE, VILLAGE_VAN_FEES, type Gender as FeeGender } from '@/lib/feeStructure';
import { UNIFORM_ITEM_DEFS, itemsForFromMatrix, type UniformMatrix } from '@/lib/uniformMatrix';
import { AccountView, CollectDrawer, AssignDrawer, type Account } from './account-ui';

const VILLAGE_FEE_MAP: Record<string, number> = Object.fromEntries(VILLAGE_VAN_FEES.map((v) => [v.village, v.fee]));

type Tab = 'collection' | 'counter' | 'concessions' | 'setup' | 'reports';

const TABS: { id: Tab; label: string; icon: string; perm?: string }[] = [
  { id: 'collection', label: 'Collection', icon: 'IndianRupee' },
  { id: 'counter', label: 'Counter billing', icon: 'ShoppingCart' },
  { id: 'concessions', label: 'Concessions', icon: 'BadgePercent', perm: 'FEES_CONCESSION_APPROVE' },
  { id: 'setup', label: 'Fee setup', icon: 'SlidersHorizontal' },
  { id: 'reports', label: 'Reports', icon: 'BarChart3' },
];

function shortClass(name: string | null) {
  return name ? name.replace(/\s?STD$/, '') : '—';
}

export default function FeesPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canCollect = perms.includes('FEES_COLLECT');
  const canManage = perms.includes('SETTINGS_MANAGE');
  const canVoid = perms.includes('FEES_VOID');
  const canNotify = perms.includes('NOTICES_MANAGE');
  const canExport = perms.includes('REPORTS_EXPORT') || perms.includes('SETTINGS_MANAGE');

  const [tab, setTab] = useState<Tab>('collection');
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [feeRefreshKey, setFeeRefreshKey] = useState(0);
  const doExport = async () => {
    setExporting(true);
    try { await downloadBackup('fees'); } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow="Fees"
        title="Fee management"
        meta="Collect fees, configure fee structure, and track balances."
        actions={(canManage || canExport) ? (
          <>
            {canManage && <Button icon="Upload" onClick={() => setImportOpen(true)}>Bulk import (Excel)</Button>}
            {canExport && <Button icon="Download" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export'}</Button>}
          </>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-1 mt-6 border-b border-slate-200">
        {TABS.filter((t) => !t.perm || perms.includes(t.perm)).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon name={t.icon as any} size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'collection' && <CollectionTab refreshKey={feeRefreshKey} canCollect={canCollect} canVoid={canVoid} canNotify={canNotify} canManage={canManage} />}
      {tab === 'counter' && <CounterTab />}
      {tab === 'concessions' && <ConcessionsTab />}
      {tab === 'setup' && <SetupTab canManage={canManage} />}
      {tab === 'reports' && <ReportsTab />}

      {importOpen && <FeeImportDrawer onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); setFeeRefreshKey((k) => k + 1); }} />}
    </>
  );
}

/* ============================ Concessions (admin approval) ============================ */

interface ConcessionRow {
  id: string;
  studentId: string;
  studentName: string;
  className: string | null;
  feeTypeName: string;
  amount: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string | null;
  approvedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

function ConcessionsTab() {
  const [rows, setRows] = useState<ConcessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('PENDING');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/fees/concessions?status=${status}`);
    if (res.ok) setRows((await res.json()).items);
    setLoading(false);
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/fees/concessions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed'); }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const pendingTotal = rows.filter((r) => r.status === 'PENDING').reduce((t, r) => t + r.amount, 0);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {['PENDING', 'APPROVED', 'REJECTED', 'all'].map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-pill text-sm font-medium transition-colors ${status === s ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            {s === 'all' ? 'All' : s[0] + s.slice(1).toLowerCase()}
          </button>
        ))}
        {status === 'PENDING' && rows.length > 0 && (
          <span className="ml-auto text-sm text-slate-500">{rows.length} pending · {feeMoney(pendingTotal)}</span>
        )}
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-600">
                <th className="text-left font-semibold px-6 py-2.5">Student</th>
                <th className="text-left font-semibold px-4 py-2.5">Fee head</th>
                <th className="text-right font-semibold px-4 py-2.5">Amount</th>
                <th className="text-left font-semibold px-4 py-2.5">Reason</th>
                <th className="text-left font-semibold px-4 py-2.5">Requested by</th>
                <th className="text-right font-semibold px-6 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => <TableRowSkeleton key={i} cols={6} />)}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="py-12"><EmptyState icon="BadgeCheck" title="Nothing here" body={status === 'PENDING' ? 'No concessions awaiting approval.' : 'No concessions in this state.'} /></td></tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-6 py-3">
                    <a href={`/admin/fees/student/${r.studentId}`} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:text-purple-700 hover:underline">{r.studentName}</a>
                    <div className="text-xs text-slate-500">{shortClass(r.className)} · {r.studentId}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.feeTypeName}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{feeMoney(r.amount)}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[16rem] truncate" title={r.reason}>{r.reason}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.requestedBy || '—'}<div className="text-slate-400">{new Date(r.createdAt).toLocaleDateString('en-IN')}</div></td>
                  <td className="px-6 py-3 text-right">
                    {r.status === 'PENDING' ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" onClick={() => decide(r.id, 'reject')} disabled={busyId === r.id}>Reject</Button>
                        <Button size="sm" kind="primary" onClick={() => decide(r.id, 'approve')} disabled={busyId === r.id}>Approve</Button>
                      </div>
                    ) : (
                      <Chip tone={r.status === 'APPROVED' ? 'success' : 'danger'}>{r.status[0] + r.status.slice(1).toLowerCase()}{r.approvedBy ? ` · ${r.approvedBy}` : ''}</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ============================ Counter billing (walk-in) ============================ */

function CounterTab() {
  const [classKey, setClassKey] = useState(CLASSES[0]);
  const [gender, setGender] = useState<FeeGender>('M');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [idCard, setIdCard] = useState(false);
  const [newAdm, setNewAdm] = useState(false);

  const [matrix, setMatrix] = useState<UniformMatrix | null>(null);
  useEffect(() => { fetch('/api/fees/config').then((r) => (r.ok ? r.json() : null)).then((d) => setMatrix(d?.uniformMatrix ?? null)).catch(() => {}); }, []);

  const classId = CLASS_ID_BY_KEY[classKey];
  const items = useMemo(() => itemsForFromMatrix(matrix, classId, gender), [matrix, classId, gender]);
  // reset quantities when the applicable item set changes
  useEffect(() => { setQty({}); }, [classId, gender]);

  const lines = useMemo(() => {
    const out: { name: string; qty: number; price: number; amount: number }[] = [];
    for (const it of items) {
      const q = qty[it.key] || 0;
      if (q > 0) out.push({ name: it.name, qty: q, price: it.price, amount: it.price * q });
    }
    if (idCard) out.push({ name: 'ID Card', qty: 1, price: ID_CARD_FEE, amount: ID_CARD_FEE });
    if (newAdm) out.push({ name: 'New Admission (tie + belt + socks)', qty: 1, price: NEW_ADMISSION_FEE, amount: NEW_ADMISSION_FEE });
    return out;
  }, [items, qty, idCard, newAdm]);

  const total = lines.reduce((t, l) => t + l.amount, 0);

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
      <style>{`@media print { body { visibility: hidden; } #counterbill, #counterbill * { visibility: visible; } #counterbill { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; } }`}</style>

      {/* picker */}
      <div className="lg:col-span-2 space-y-4">
        <Card title="Build a walk-in bill">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-slate-500 w-full sm:w-auto">Class</span>
            {CLASSES.map((c) => (
              <button key={c} onClick={() => setClassKey(c)}
                className={`px-2.5 py-1 rounded-pill text-xs font-medium transition-colors ${classKey === c ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{c}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-slate-500">Gender</span>
            {(['M', 'F'] as FeeGender[]).map((g) => (
              <button key={g} onClick={() => setGender(g)}
                className={`px-3 py-1 rounded-pill text-xs font-medium transition-colors ${gender === g ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{g === 'M' ? 'Boy' : 'Girl'}</button>
            ))}
          </div>

          <div className="space-y-1.5">
            {items.map((it) => {
              const q = qty[it.key] || 0;
              return (
                <div key={it.key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <label className="flex items-center gap-2 flex-1 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={q > 0} onChange={(e) => setQty((s) => ({ ...s, [it.key]: e.target.checked ? 1 : 0 }))} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" />
                    {it.name}
                  </label>
                  <span className="text-xs text-slate-400 tabular-nums w-16 text-right">{feeMoney(it.price)}</span>
                  {q > 0 && (
                    <input type="number" min={1} value={String(q)} onChange={(e) => setQty((s) => ({ ...s, [it.key]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} className="w-16 py-1 text-right tabular-nums rounded-md border border-slate-200 text-sm" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <label className="flex items-center justify-between text-sm text-slate-700 cursor-pointer">
              <span className="flex items-center gap-2"><input type="checkbox" checked={idCard} onChange={(e) => setIdCard(e.target.checked)} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" /> ID Card</span>
              <span className="text-slate-500 tabular-nums">{feeMoney(ID_CARD_FEE)}</span>
            </label>
            <label className="flex items-center justify-between text-sm text-slate-700 cursor-pointer">
              <span className="flex items-center gap-2"><input type="checkbox" checked={newAdm} onChange={(e) => setNewAdm(e.target.checked)} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" /> New Admission set <span className="text-xs text-slate-400">tie + belt + socks</span></span>
              <span className="text-slate-500 tabular-nums">{feeMoney(NEW_ADMISSION_FEE)}</span>
            </label>
          </div>
        </Card>
      </div>

      {/* bill */}
      <div>
        <div id="counterbill" className="bg-white border border-slate-200 rounded-lg shadow-xs p-5 sticky top-4">
          <div className="text-center pb-3 border-b border-slate-200">
            <div className="font-bold text-slate-900">Jnana Deepika</div>
            <div className="text-xs text-slate-500">Counter bill · {classKey} · {gender === 'M' ? 'Boy' : 'Girl'}</div>
            <div className="text-[11px] text-slate-400">{new Date().toLocaleDateString('en-IN')}</div>
          </div>
          {lines.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Tick items to build the bill.</p>
          ) : (
            <table className="w-full text-sm my-3">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-700">{l.name}{l.qty > 1 ? ` ×${l.qty}` : ''}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-900">{feeMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="font-semibold text-slate-900">Total</span>
            <span className="font-bold text-lg tabular-nums text-slate-900">{feeMoney(total)}</span>
          </div>
          <div className="mt-4 no-print">
            <Button kind="primary" icon="Printer" className="w-full justify-center" onClick={() => window.print()} disabled={lines.length === 0}>Print bill</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ Collection ============================ */

interface AccountRow {
  id: string;
  name: string;
  classId: string | null;
  className: string | null;
  village: string | null;
  totalCharged: number;
  totalPaid: number;
  totalBalance: number;
  status: ChargeStatus;
}

function CollectionTab({ refreshKey, canCollect, canVoid, canNotify, canManage }: { refreshKey?: number; canCollect: boolean; canVoid?: boolean; canNotify?: boolean; canManage?: boolean }) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'status', dir: 'asc' }); // paid → top
  const onSort = (k: string) => setSort((s) => nextSort(s, k));

  // status order so "paid" sorts to the top in ascending order
  const STATUS_RANK: Record<string, number> = { paid: 0, partial: 1, due: 2, overdue: 3 };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (filter !== 'all') params.set('filter', filter);
      const res = await fetch(`/api/fees/accounts?${params}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => {
    const t = setTimeout(fetchRows, 250);
    return () => clearTimeout(t);
  }, [fetchRows, refreshKey]); // reload after a bulk import from the header

  const kpis = useMemo(() => {
    const billed = rows.reduce((t, r) => t + r.totalCharged, 0);
    const collected = rows.reduce((t, r) => t + r.totalPaid, 0);
    const outstanding = rows.reduce((t, r) => t + r.totalBalance, 0);
    const withDues = rows.filter((r) => r.totalBalance > 0).length;
    return { billed, collected, outstanding, withDues };
  }, [rows]);

  const sorted = useMemo(
    () => sortRows(rows, sort, (r, k) =>
      k === 'name' ? r.name :
      k === 'className' ? (r.className || '') :
      k === 'totalCharged' ? r.totalCharged :
      k === 'totalPaid' ? r.totalPaid :
      k === 'totalBalance' ? r.totalBalance :
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

  return (
    <>
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2.5 mt-4">
        {[
          { label: 'Total billed', value: feeMoney(kpis.billed), icon: 'ReceiptText', badge: 'bg-purple-100 text-purple-700' },
          { label: 'Collected', value: feeMoney(kpis.collected), icon: 'CheckCircle2', badge: 'bg-success-100 text-success-700' },
          { label: 'Outstanding', value: feeMoney(kpis.outstanding), icon: 'AlertCircle', badge: 'bg-danger-100 text-danger-700' },
          { label: 'Students with dues', value: kpis.withDues, icon: 'Users', badge: 'bg-marigold-100 text-marigold-700' },
        ].map((s) =>
          loading ? (
            <Skeleton key={s.label} height={52} rounded="lg" />
          ) : (
            <div key={s.label} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl shadow-xs px-4 py-2.5">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.badge}`}>
                <Icon name={s.icon as any} size={18} />
              </div>
              <div>
                <div className="text-lg font-bold text-slate-900 leading-none tabular-nums">{s.value}</div>
                <div className="text-[11px] text-slate-500 mt-1">{s.label}</div>
              </div>
            </div>
          )
        )}
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
        title={
          <div className="flex items-center gap-2 w-full sm:w-96">
            <Icon name="Search" size={18} className="text-slate-400" />
            <input
              type="text"
              placeholder="Search name, admission no, father/mother name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-0 outline-none text-sm"
            />
          </div>
        }
        action={
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40">
            <option value="all">All students</option>
            <option value="due">Has balance</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Fully paid</option>
          </Select>
        }
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
                        <a
                          href={`/admin/fees/student/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-slate-900 hover:text-purple-700 hover:underline inline-flex items-center gap-1"
                          title="Open fee account in a new tab"
                        >
                          {r.name}
                          <Icon name="ExternalLink" size={13} className="text-slate-300" />
                        </a>
                        <div className="text-xs text-slate-500 font-mono">{r.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-6">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium">{shortClass(r.className)}</span>
                  </td>
                  <td className="py-3 px-6 text-right tabular-nums text-slate-700">{feeMoney(r.totalCharged)}</td>
                  <td className="py-3 px-6 text-right tabular-nums text-success-700">{feeMoney(r.totalPaid)}</td>
                  <td className="py-3 px-6 text-right tabular-nums font-semibold text-slate-900">{feeMoney(r.totalBalance)}</td>
                  <td className="py-3 px-6"><Chip tone={statusTone(r.status)}>{statusLabel(r.status)}</Chip></td>
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
                    <div className="text-[11px] text-slate-500">{shortClass(r.className)} · {r.id}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-semibold tabular-nums text-slate-900">{feeMoney(r.totalBalance)}</div>
                    <div className="mt-0.5"><Chip tone={statusTone(r.status)}>{statusLabel(r.status)}</Chip></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {openId && <LedgerDrawer studentId={openId} canCollect={canCollect} canVoid={canVoid} canNotify={canNotify} onClose={() => setOpenId(null)} onChanged={fetchRows} />}
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
function FeeImportDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [rows, setRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { 'Admission No': 'JD1781200142909001', 'Student Name': 'Aarav Sharma', 'Phone': '9876543210', 'Class': '1st STD', 'Academic Year': '2026-27', 'Fee Head': 'Tuition Fee', 'Assigned': 16500, 'Concession': 0, 'Paid': 5000, 'Date': '01/06/2026', 'Payment Mode': 'Cash' },
      { 'Admission No': '', 'Student Name': 'Aarav Sharma', 'Phone': '9876543210', 'Class': '1st STD', 'Academic Year': '2026-27', 'Fee Head': 'Van / Transport', 'Assigned': 6000, 'Concession': 0, 'Paid': 0, 'Date': '', 'Payment Mode': '' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fees');
    XLSX.writeFile(wb, 'fee-import-template.xlsx');
  };

  const onFile = async (file: File) => {
    setError(''); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const mapped = raw.map((r) => ({
        admissionNo: r['Admission No'] ?? r['admissionNo'] ?? '',
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
      setRows(mapped);
      setBusy(true);
      const res = await fetch('/api/fees/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: mapped, dryRun: true }) });
      const d = await res.json();
      setBusy(false);
      if (!res.ok) { setError(d.error || 'Failed to read file'); return; }
      setPreview(d); setStep('preview');
    } catch (e) { setBusy(false); setError(e instanceof Error ? e.message : 'Could not read the file'); }
  };

  const apply = async () => {
    if (!confirm('Apply the import? This adds the fees/payments to the matched students. Existing fees are kept and duplicate payments are skipped.')) return;
    setBusy(true); setError('');
    const res = await fetch('/api/fees/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, dryRun: false }) });
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
            One row per student per fee head. Columns: <b>Admission No</b>, <b>Student Name</b>, <b>Phone</b>, <b>Class</b>, <b>Academic Year</b>, <b>Fee Head</b>, <b>Assigned</b>, <b>Concession</b>, <b>Paid</b>, <b>Date</b>, <b>Payment Mode</b>. Due is calculated for you.
          </div>
          <ul className="text-xs text-slate-500 list-disc pl-5 space-y-1">
            <li>Match is by <b>Admission No</b> if given, otherwise <b>Name + Phone</b> (<b>Class</b> helps when names repeat).</li>
            <li><b>Fee Head</b> must match a fee type from the Setup tab (e.g. Tuition Fee, Van / Transport).</li>
            <li><b>Academic Year</b> (e.g. 2026-27) lets you import past years — blank uses the current year.</li>
            <li><b>Date</b> (dd/mm/yyyy) and <b>Payment Mode</b> (Cash/UPI/Card/Bank/Cheque) apply to the Paid amount — blank = today / Cash.</li>
            <li>Applying <b>adds</b> to each student's fees — existing charges & payments are kept, and duplicate payments are skipped (safe to re-upload).</li>
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

const DEFAULT_BULK_TEMPLATE = `Dear {guardian},

This is a gentle reminder that the pending fee for {name} (Class {class}) is {balance}.

{breakup}

Kindly clear the dues at the school office at your earliest convenience. Thank you.`;

function BulkNotifyModal({ students, onClose, onDone }: { students: { id: string; name: string; className: string | null; balance: number }[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('Fee payment reminder');
  const [body, setBody] = useState(DEFAULT_BULK_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skippedZero: number; pushSent: number } | null>(null);

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
      <Modal open onClose={onDone} title="Reminders sent" width={460}
        footer={<div className="flex justify-end"><Button kind="primary" onClick={onDone}>Done</Button></div>}>
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={26} /></div>
          <p className="text-sm text-slate-700"><span className="font-semibold">{result.created}</span> personalized reminder{result.created === 1 ? '' : 's'} sent — each parent got their own balance.</p>
          <p className="text-xs text-slate-500 mt-1">{result.pushSent} phone notification{result.pushSent === 1 ? '' : 's'} delivered{result.skippedZero ? ` · ${result.skippedZero} skipped (no balance)` : ''}.</p>
        </div>
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
          Each parent receives their <b>own child’s balance</b>. Write one message using the tags below — they’re filled in per student automatically.
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

function LedgerDrawer({ studentId, canCollect, canVoid, canNotify, onClose, onChanged }: { studentId: string; canCollect: boolean; canVoid?: boolean; canNotify?: boolean; onClose: () => void; onChanged: () => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/fees/accounts/${studentId}`);
    if (res.ok) setAccount(await res.json());
    setLoading(false);
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  const s = account?.summary;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={account?.student.name || 'Fee account'}
        subtitle={account ? `${account.student.id} · ${shortClass(account.student.className)}${account.student.section ? ' ' + account.student.section : ''}` : ''}
        width={560}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              <span className="text-slate-500">Balance </span>
              <span className="font-bold text-slate-900 tabular-nums">{s ? feeMoney(s.totalBalance) : '—'}</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={onClose}>Close</Button>
              {canCollect && <Button icon="SlidersHorizontal" onClick={() => setEditing(true)}>Edit plan</Button>}
              {canCollect && s && s.totalBalance > 0 && (
                <Button kind="primary" icon="IndianRupee" onClick={() => setCollecting(true)}>Collect payment</Button>
              )}
            </div>
          </div>
        }
      >
        {loading || !account ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>
        ) : (
          <AccountView account={account} canRequestConcession={canCollect} canVoid={canVoid} canNotify={canNotify} onChanged={load} />
        )}
      </Drawer>

      {collecting && account && (
        <CollectDrawer
          account={account}
          onClose={() => setCollecting(false)}
          onDone={async () => { setCollecting(false); await load(); onChanged(); }}
        />
      )}

      {editing && (
        <AssignDrawer
          studentId={studentId}
          onClose={() => setEditing(false)}
          onDone={async () => { setEditing(false); await load(); onChanged(); }}
        />
      )}
    </>
  );
}

/* ============================ Fee setup ============================ */

interface ConfigData {
  year: { id: string; label: string };
  feeTypes: { id: string; key: string; name: string; billingMode: string; installmentable: boolean; autoAssign: boolean; active: boolean; order: number }[];
  classes: { id: string; name: string; group: string }[];
  classFees: { id: string; classId: string; feeTypeId: string; amount: number; installments: { id: string; n: number; amount: number; dueDate: string | null }[] }[];
  vanFees: { id: string; village: string; monthlyFee: number; annualFee: number }[];
  uniformItems: { id: string; name: string; price: number; defaultQty: number; active: boolean }[];
  uniformMatrix: Record<string, Record<string, { M?: number; F?: number; ANY?: number }>> | null;
}

function SetupTab({ canManage }: { canManage: boolean }) {
  const [cfg, setCfg] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<'class' | 'van' | 'uniform' | 'types'>('class');
  const [classId, setClassId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/fees/config');
    if (res.ok) {
      const data = await res.json();
      setCfg(data);
      if (!classId && data.classes[0]) setClassId(data.classes[0].id);
    }
    setLoading(false);
  }, [classId]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body: any) => {
    await fetch('/api/fees/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  };
  const post = async (body: any) => {
    const r = await fetch('/api/fees/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
  };
  const removeRow = async (kind: string, id: string) => {
    await fetch(`/api/fees/config?kind=${kind}&id=${id}`, { method: 'DELETE' });
    await load();
  };

  const [newVan, setNewVan] = useState({ village: '', monthly: '', annual: '' });
  const [newUniform, setNewUniform] = useState({ name: '', price: '' });
  const [setupErr, setSetupErr] = useState('');
  const addVan = async () => {
    if (!newVan.village.trim()) return;
    setSetupErr('');
    try { await post({ action: 'addVanFee', village: newVan.village, monthlyFee: newVan.monthly, annualFee: newVan.annual }); setNewVan({ village: '', monthly: '', annual: '' }); await load(); }
    catch (e) { setSetupErr(e instanceof Error ? e.message : 'Failed to add'); }
  };
  const addUniform = async () => {
    if (!newUniform.name.trim()) return;
    setSetupErr('');
    try { await post({ action: 'addUniformItem', name: newUniform.name, price: newUniform.price }); setNewUniform({ name: '', price: '' }); await load(); }
    catch (e) { setSetupErr(e instanceof Error ? e.message : 'Failed to add'); }
  };
  const seedDefaults = async (action: 'seedVanDefaults' | 'seedUniformDefaults') => {
    setSetupErr('');
    try { await post({ action }); await load(); }
    catch (e) { setSetupErr(e instanceof Error ? e.message : 'Failed to load defaults'); }
  };

  // Uniform price matrix (class × gender), edited locally then saved.
  const [matrix, setMatrix] = useState<NonNullable<ConfigData['uniformMatrix']>>({});
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [expandedItem, setExpandedItem] = useState('');
  useEffect(() => { setMatrix(cfg?.uniformMatrix || {}); setMatrixDirty(false); }, [cfg]);
  const setMatrixCell = (key: string, cid: string, g: 'M' | 'F' | 'ANY', val: string) => {
    setMatrix((m) => {
      const cell: any = { ...((m[key] || {})[cid] || {}) };
      if (val === '') delete cell[g]; else cell[g] = Math.max(0, Math.round(Number(val) || 0));
      return { ...m, [key]: { ...(m[key] || {}), [cid]: cell } };
    });
    setMatrixDirty(true);
  };
  const saveMatrix = async () => {
    setSetupErr('');
    try { await post({ action: 'setUniformMatrix', matrix }); setMatrixDirty(false); await load(); }
    catch (e) { setSetupErr(e instanceof Error ? e.message : 'Failed to save prices'); }
  };
  const seedMatrix = async () => {
    setSetupErr('');
    try { await post({ action: 'seedUniformMatrix' }); await load(); }
    catch (e) { setSetupErr(e instanceof Error ? e.message : 'Failed to load matrix'); }
  };
  const [assignMsg, setAssignMsg] = useState('');
  const assignAll = async () => {
    setSetupErr(''); setAssignMsg('Assigning…');
    try {
      const r = await fetch('/api/fees/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assignAllClassFees' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed');
      setAssignMsg(`Done — class fees assigned across ${d.assigned}/${d.total} students.`);
    } catch (e) { setAssignMsg(''); setSetupErr(e instanceof Error ? e.message : 'Failed to assign'); }
  };

  if (loading || !cfg) return <div className="mt-6 space-y-3 max-w-3xl">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>;

  const classFeesFor = (cid: string) =>
    cfg.feeTypes
      .filter((ft) => ft.billingMode === 'CLASS_AMOUNT')
      .map((ft) => ({ ft, cf: cfg.classFees.find((c) => c.classId === cid && c.feeTypeId === ft.id) }))
      .filter((x) => x.cf);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-4">
        {([['class', 'Class fees', 'GraduationCap'], ['van', 'Van fees', 'Bus'], ['uniform', 'Uniform items', 'Shirt'], ['types', 'Fee types', 'ListPlus']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setSection(id)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-pill text-sm font-medium transition-colors ${section === id ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            <Icon name={icon as any} size={15} />{label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">Year {cfg.year.label}</span>
      </div>

      {!canManage && (
        <div className="mb-4 text-xs text-slate-500 bg-slate-50 rounded-md p-3 inline-flex items-center gap-2">
          <Icon name="Lock" size={14} /> View only — ask an admin to change the fee structure.
        </div>
      )}

      {section === 'class' && (
        <Card padded={false}
          title={
            <div className="flex items-center gap-2">
              <span>Class fees</span>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-44">
                {cfg.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          }>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="text-left font-semibold px-6 py-2.5">Fee type</th>
              <th className="text-right font-semibold px-6 py-2.5 w-48">Amount (₹)</th>
            </tr></thead>
            <tbody>
              {classFeesFor(classId).map(({ ft, cf }) => (
                <tr key={ft.id} className="border-t border-slate-100">
                  <td className="px-6 py-2.5 font-medium text-slate-900">{ft.name}{ft.installmentable && cf!.installments.length > 0 && <span className="ml-2 text-xs text-slate-400">{cf!.installments.length} installments</span>}</td>
                  <td className="px-6 py-2 text-right">
                    <InlineAmount value={cf!.amount} disabled={!canManage} onSave={(v) => patch({ kind: 'classFee', id: cf!.id, amount: v }).then(load)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-slate-100">
              <span className="text-xs text-slate-500">{assignMsg || 'New students get these fees automatically. Use this for students added before fees were set up.'}</span>
              <Button icon="Users" onClick={assignAll}>Assign to all students</Button>
            </div>
          )}
        </Card>
      )}

      {setupErr && <div className="mb-3 px-4 py-2.5 bg-danger-50 text-danger-700 rounded-md text-sm">{setupErr}</div>}

      {section === 'van' && (
        <Card padded={false} title="Van fees by village">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="text-left font-semibold px-6 py-2.5">Village</th>
              <th className="text-right font-semibold px-6 py-2.5 w-40">Monthly (₹)</th>
              <th className="text-right font-semibold px-6 py-2.5 w-40">Annual (₹)</th>
              {canManage && <th className="w-12" />}
            </tr></thead>
            <tbody>
              {cfg.vanFees.map((v) => (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="px-6 py-2.5 font-medium text-slate-900">{v.village}</td>
                  <td className="px-6 py-2 text-right"><InlineAmount value={v.monthlyFee} disabled={!canManage} onSave={(x) => patch({ kind: 'vanFee', id: v.id, monthlyFee: x }).then(load)} /></td>
                  <td className="px-6 py-2 text-right"><InlineAmount value={v.annualFee} disabled={!canManage} onSave={(x) => patch({ kind: 'vanFee', id: v.id, annualFee: x }).then(load)} /></td>
                  {canManage && <td className="px-3 text-center"><button onClick={() => removeRow('vanFee', v.id)} className="text-slate-400 hover:text-danger-600" title="Remove"><Icon name="Trash2" size={15} /></button></td>}
                </tr>
              ))}
              {cfg.vanFees.length === 0 && <tr><td colSpan={canManage ? 4 : 3} className="px-6 py-4 text-center text-sm text-slate-400">No van fees yet — add a village below.</td></tr>}
            </tbody>
          </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 px-6 py-3 border-t border-slate-100">
              <Input placeholder="Village" value={newVan.village} onChange={(e) => setNewVan({ ...newVan, village: e.target.value })} className="w-40" />
              <Input placeholder="Monthly ₹" type="number" value={newVan.monthly} onChange={(e) => setNewVan({ ...newVan, monthly: e.target.value })} className="w-28" />
              <Input placeholder="Annual ₹" type="number" value={newVan.annual} onChange={(e) => setNewVan({ ...newVan, annual: e.target.value })} className="w-28" />
              <Button kind="primary" icon="Plus" onClick={addVan} disabled={!newVan.village.trim()}>Add village</Button>
              <Button icon="Download" onClick={() => seedDefaults('seedVanDefaults')} className="ml-auto">Load standard villages</Button>
            </div>
          )}
        </Card>
      )}

      {section === 'uniform' && (
        <Card padded={false} title="Uniform prices (class × gender)">
          <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Set each item&apos;s price per class. Gendered items (School / White) have separate Boy &amp; Girl prices.</span>
            {canManage && <Button size="sm" icon="Download" className="ml-auto" onClick={seedMatrix}>Load standard matrix</Button>}
          </div>
          <div className="divide-y divide-slate-100">
            {UNIFORM_ITEM_DEFS.map((it) => {
              const open = expandedItem === it.key;
              return (
                <div key={it.key}>
                  <button onClick={() => setExpandedItem(open ? '' : it.key)} className="w-full flex items-center justify-between px-6 py-3 hover:bg-slate-50">
                    <span className="font-medium text-slate-900 inline-flex items-center gap-2">{it.name}{it.gendered && <Chip tone="info">Boy / Girl</Chip>}</span>
                    <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-slate-400" />
                  </button>
                  {open && (
                    <div className="px-6 pb-4 overflow-x-auto">
                      <table className="text-sm">
                        <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="text-left py-1 pr-6">Class</th>
                          {it.gendered ? <><th className="px-2 text-right">Boy ₹</th><th className="px-2 text-right">Girl ₹</th></> : <th className="px-2 text-right">Price ₹</th>}
                        </tr></thead>
                        <tbody>
                          {cfg.classes.map((c) => {
                            const cell = matrix[it.key]?.[c.id] || {};
                            const inp = 'w-24 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none disabled:bg-slate-50';
                            return (
                              <tr key={c.id} className="border-t border-slate-50">
                                <td className="py-1 pr-6 text-slate-700 whitespace-nowrap">{c.name}</td>
                                {it.gendered ? (
                                  <>
                                    <td className="px-2 py-1 text-right"><input type="number" disabled={!canManage} value={cell.M ?? ''} onChange={(e) => setMatrixCell(it.key, c.id, 'M', e.target.value)} className={inp} /></td>
                                    <td className="px-2 py-1 text-right"><input type="number" disabled={!canManage} value={cell.F ?? ''} onChange={(e) => setMatrixCell(it.key, c.id, 'F', e.target.value)} className={inp} /></td>
                                  </>
                                ) : (
                                  <td className="px-2 py-1 text-right"><input type="number" disabled={!canManage} value={cell.ANY ?? ''} onChange={(e) => setMatrixCell(it.key, c.id, 'ANY', e.target.value)} className={inp} /></td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {canManage && (
            <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-slate-100">
              {matrixDirty && <span className="text-xs text-marigold-700">Unsaved changes</span>}
              <Button kind="primary" icon="Check" onClick={saveMatrix} disabled={!matrixDirty}>Save prices</Button>
            </div>
          )}
        </Card>
      )}

      {section === 'types' && <FeeTypesSection cfg={cfg} canManage={canManage} reload={load} />}
    </div>
  );
}

const BILLING_LABEL: Record<string, { label: string; tone: 'info' | 'success' | 'warn' | 'neutral' }> = {
  CLASS_AMOUNT: { label: 'Per class', tone: 'info' },
  VILLAGE: { label: 'Per village (van)', tone: 'success' },
  ITEMIZED: { label: 'Itemized (uniform)', tone: 'warn' },
  MANUAL: { label: 'Manual (old due)', tone: 'neutral' },
};

function MiniToggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-purple-500' : 'bg-slate-300'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function FeeTypesSection({ cfg, canManage, reload }: { cfg: ConfigData; canManage: boolean; reload: () => Promise<void> | void }) {
  const types = [...cfg.feeTypes].sort((a, b) => a.order - b.order);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [billingMode, setBillingMode] = useState<'CLASS_AMOUNT' | 'MANUAL'>('CLASS_AMOUNT');
  const [installmentable, setInstallmentable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (method: string, body?: any, qs = '') => {
    const res = await fetch(`/api/fees/config${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Failed (${res.status})`);
    }
    await reload();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= types.length) return;
    const order = types.map((t) => t.id);
    [order[i], order[j]] = [order[j], order[i]];
    await send('POST', { action: 'reorderFeeTypes', order });
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      if (!name.trim()) throw new Error('Enter a name');
      await send('POST', { name: name.trim(), billingMode, installmentable, autoAssign: billingMode === 'CLASS_AMOUNT' });
      setAdding(false);
      setName('');
      setBillingMode('CLASS_AMOUNT');
      setInstallmentable(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card padded={false}
        title={
          <div className="flex items-center justify-between w-full">
            <span>Fee types</span>
            {canManage && <Button size="sm" icon="Plus" onClick={() => setAdding(true)}>Add fee type</Button>}
          </div>
        }>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="text-left font-semibold px-6 py-2.5">Fee type</th>
            <th className="text-left font-semibold px-4 py-2.5">Billing</th>
            <th className="text-center font-semibold px-4 py-2.5">Auto-assign</th>
            <th className="text-center font-semibold px-4 py-2.5">Installments</th>
            <th className="text-center font-semibold px-4 py-2.5">Active</th>
            <th className="text-right font-semibold px-6 py-2.5 w-28">Order</th>
          </tr></thead>
          <tbody>
            {types.map((t, i) => {
              const meta = BILLING_LABEL[t.billingMode] || { label: t.billingMode, tone: 'neutral' as const };
              return (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-6 py-2.5">
                    {canManage ? (
                      <input defaultValue={t.name}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) send('PATCH', { kind: 'feeType', id: t.id, name: v }); }}
                        className="font-medium text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-purple-500 rounded px-2 py-1 -ml-2 focus:outline-none focus:ring-2 focus:ring-purple-500/20" />
                    ) : <span className="font-medium text-slate-900">{t.name}</span>}
                  </td>
                  <td className="px-4 py-2.5"><Chip tone={meta.tone}>{meta.label}</Chip></td>
                  <td className="px-4 py-2.5 text-center"><MiniToggle on={t.autoAssign} disabled={!canManage} onChange={(v) => send('PATCH', { kind: 'feeType', id: t.id, autoAssign: v })} /></td>
                  <td className="px-4 py-2.5 text-center">
                    {t.billingMode === 'CLASS_AMOUNT' || t.billingMode === 'VILLAGE'
                      ? <MiniToggle on={t.installmentable} disabled={!canManage} onChange={(v) => send('PATCH', { kind: 'feeType', id: t.id, installmentable: v })} />
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center"><MiniToggle on={t.active} disabled={!canManage} onChange={(v) => send('PATCH', { kind: 'feeType', id: t.id, active: v })} /></td>
                  <td className="px-6 py-2.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <button disabled={!canManage || i === 0} onClick={() => move(i, -1)} className="text-slate-300 hover:text-slate-600 disabled:opacity-30 p-1"><Icon name="ChevronUp" size={15} /></button>
                      <button disabled={!canManage || i === types.length - 1} onClick={() => move(i, 1)} className="text-slate-300 hover:text-slate-600 disabled:opacity-30 p-1"><Icon name="ChevronDown" size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <p className="text-xs text-slate-500 mt-3 flex items-start gap-2">
        <Icon name="Info" size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
        New types apply to students assigned/admitted afterwards — existing accounts keep their current charges. For a “Per class” type, set its amounts in the Class fees tab.
      </p>

      {adding && (
        <Drawer open onClose={() => setAdding(false)} title="Add fee type" width={460}
          footer={<div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button kind="primary" onClick={create} disabled={busy}>{busy ? 'Adding…' : 'Add fee type'}</Button>
          </div>}>
          {error && <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}
          <div className="space-y-4">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sports Fee" /></Field>
            <Field label="Billing mode" hint={billingMode === 'CLASS_AMOUNT' ? 'A fixed amount per class, auto-assigned on admission.' : 'An amount entered manually per student.'}>
              <Select value={billingMode} onChange={(e) => setBillingMode(e.target.value as any)}>
                <option value="CLASS_AMOUNT">Per class (fixed amount)</option>
                <option value="MANUAL">Manual (per student)</option>
              </Select>
            </Field>
            {billingMode === 'CLASS_AMOUNT' && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={installmentable} onChange={(e) => setInstallmentable(e.target.checked)} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" />
                Allow splitting into installments
              </label>
            )}
          </div>
        </Drawer>
      )}
    </>
  );
}

function InlineAmount({ value, disabled, onSave }: { value: number; disabled?: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  if (disabled) return <span className="tabular-nums text-slate-700">{feeMoney(value)}</span>;
  return (
    <input
      type="number"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = Math.max(0, Math.round(Number(v) || 0)); if (n !== value) onSave(n); }}
      className="w-32 text-right tabular-nums rounded-md border border-slate-200 px-2 py-1.5 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none"
    />
  );
}

/* ============================ Reports ============================ */

interface ReportData {
  year: { id: string; label: string };
  collectedTotal: number;
  paymentCount: number;
  byHead: { name: string; amount: number }[];
  byClass: { name: string; amount: number }[];
  byVillage: { name: string; amount: number }[];
  byDay: { day: string; amount: number }[];
  outstanding: { id: string; name: string; className: string | null; balance: number }[];
  outstandingTotal: number;
  oldDue: { id: string; name: string; className: string | null; amount: number; balance: number }[];
  installmentDue: { id: string; name: string; className: string | null; label: string; dueDate: string | null; balance: number; status: ChargeStatus }[];
}

function ReportsTab() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const res = await fetch(`/api/fees/reports?${params}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const thisMonth = () => {
    const now = new Date();
    setFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
    setTo(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
  };
  const clearRange = () => { setFrom(''); setTo(''); };

  if (loading || !data) return <div className="mt-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>;

  return (
    <div className="mt-6 space-y-5">
      {/* range filter */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button size="sm" onClick={thisMonth}>This month</Button>
          <Button size="sm" onClick={clearRange}>Whole year</Button>
          <div className="ml-auto text-right">
            <div className="text-2xl font-bold text-slate-900 tabular-nums">{feeMoney(data.collectedTotal)}</div>
            <div className="text-xs text-slate-500">{data.paymentCount} payments {from || to ? 'in range' : `· year ${data.year.label}`}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReportTable title="Collection by fee head" rows={data.byHead.map((r) => [r.name, feeMoney(r.amount)])} empty="No collection yet" />
        <ReportTable title="Collection by class" rows={data.byClass.map((r) => [r.name, feeMoney(r.amount)])} empty="No collection yet" />
        <ReportTable title="Collection by village" rows={data.byVillage.map((r) => [r.name, feeMoney(r.amount)])} empty="No collection yet" />
        <ReportTable title="Daily collection" rows={data.byDay.map((r) => [new Date(r.day).toLocaleDateString('en-IN'), feeMoney(r.amount)])} empty="No collection yet" />
      </div>

      <Card padded={false} title={<div className="flex items-center justify-between w-full"><span>Outstanding fees</span><span className="text-sm font-normal text-danger-700">{feeMoney(data.outstandingTotal)} total</span></div>}>
        <ReportRows
          head={['Student', 'Class', 'Balance']}
          rows={data.outstanding.map((r) => [r.name + '  ·  ' + r.id, shortClass(r.className), feeMoney(r.balance)])}
          empty="Everyone is paid up 🎉"
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card padded={false} title="Old dues (previous year)">
          <ReportRows head={['Student', 'Class', 'Balance']} rows={data.oldDue.map((r) => [r.name, shortClass(r.className), feeMoney(r.balance)])} empty="No old dues" />
        </Card>
        <Card padded={false} title="Installments due">
          <ReportRows head={['Student', 'Installment', 'Balance']} rows={data.installmentDue.map((r) => [r.name, `${r.label}${r.dueDate ? ' · ' + r.dueDate : ''}`, feeMoney(r.balance)])} empty="No pending installments" />
        </Card>
      </div>
    </div>
  );
}

function ReportTable({ title, rows, empty }: { title: string; rows: [string, string][]; empty: string }) {
  return (
    <Card padded={false} title={title}>
      {rows.length === 0 ? (
        <div className="py-8"><EmptyState icon="BarChart3" title={empty} /></div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 first:border-0">
                <td className="px-6 py-2.5 text-slate-700">{r[0]}</td>
                <td className="px-6 py-2.5 text-right tabular-nums font-medium text-slate-900">{r[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ReportRows({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <div className="py-8"><EmptyState icon="CheckCircle2" title={empty} /></div>;
  return (
    <div className="overflow-x-auto max-h-96 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50">
          <tr className="text-[11px] uppercase tracking-wide text-slate-500">
            {head.map((h, i) => <th key={i} className={`font-semibold px-6 py-2.5 ${i === head.length - 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((cell, j) => <td key={j} className={`px-6 py-2 ${j === r.length - 1 ? 'text-right tabular-nums font-medium text-slate-900' : 'text-slate-700'}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
