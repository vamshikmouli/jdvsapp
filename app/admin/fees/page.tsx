'use client';

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
    try {
      const res = await fetch('/api/fees/export');
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `fees-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
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

      <div className="flex flex-nowrap items-center gap-1 mt-6 border-b border-slate-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.filter((t) => !t.perm || perms.includes(t.perm)).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex-shrink-0 transition-colors ${
              tab === t.id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon name={t.icon as any} size={16} className="flex-shrink-0" />
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

  const decide = async (id: string, action: 'approve' | 'reject' | 'cancel') => {
    if (action === 'cancel' && !confirm('Cancel this approved concession? The waived amount becomes payable again for the student.')) return;
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
                      <div className="flex items-center justify-end gap-2">
                        <Chip tone={r.status === 'APPROVED' ? 'success' : 'danger'}>{r.status[0] + r.status.slice(1).toLowerCase()}{r.approvedBy ? ` · ${r.approvedBy}` : ''}</Chip>
                        {r.status === 'APPROVED' && (
                          <Button size="sm" icon="X" onClick={() => decide(r.id, 'cancel')} disabled={busyId === r.id}>Cancel</Button>
                        )}
                      </div>
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

type CounterAdmission = 'new' | 'old';
type CounterChild = {
  id: string;
  name: string;
  classKey: ClassKey;
  gender: FeeGender;
  admission: CounterAdmission;
  qty: Record<string, number>;   // uniform item key → quantity (pre-ticked for new admission)
  idCard: boolean;
  newSet: boolean;
  studentId?: string;            // set when linked to an existing enrolled student
};
type CounterCfg = {
  matrix: UniformMatrix | null;
  feeTypes: { id: string; key: string; name: string }[];
  classFees: { classId: string; feeTypeId: string; amount: number }[];
};

let counterChildSeq = 0;
const makeCounterChild = (): CounterChild => ({
  id: `cc${Date.now()}_${counterChildSeq++}`,
  name: '', classKey: CLASSES[0], gender: 'M', admission: 'new', qty: {}, idCard: true, newSet: true,
});

const ccInput = 'px-2.5 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20';

function CounterTab() {
  const [parentName, setParentName] = useState('');
  const [children, setChildren] = useState<CounterChild[]>([makeCounterChild()]);
  const [cfg, setCfg] = useState<CounterCfg>({ matrix: null, feeTypes: [], classFees: [] });
  const [search, setSearch] = useState<{ id: string; q: string; results: any[]; loading: boolean } | null>(null);
  const seeded = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/fees/config').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) setCfg({ matrix: d.uniformMatrix ?? null, feeTypes: d.feeTypes ?? [], classFees: d.classFees ?? [] });
    }).catch(() => {});
  }, []);

  // Resolve a fee head by concept (tuition / software / idcard / newadmission),
  // tolerant of admin-named keys/slugs — mirrors the server's resolveHeadId.
  const feeTypeId = useCallback((concept: string): string | undefined => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const h = norm(concept);
    const t = cfg.feeTypes;
    return t.find((x) => x.key === concept)?.id
      ?? t.find((x) => norm(x.key) === h || norm(x.key).startsWith(h))?.id
      ?? t.find((x) => norm(x.name).startsWith(h))?.id;
  }, [cfg.feeTypes]);
  const classFeeAmt = useCallback((classId: string, concept: string): number => {
    const ftId = feeTypeId(concept);
    if (!ftId) return 0;
    return cfg.classFees.find((c) => c.classId === classId && c.feeTypeId === ftId)?.amount || 0;
  }, [cfg.classFees, feeTypeId]);
  // Live display name for a concept, straight from Fee Setup (falls back to a
  // sensible default if that fee type isn't configured). So renaming a fee type
  // (e.g. Tuition → School Fee) shows the new name here too.
  const feeTypeName = useCallback((concept: string, fallback: string): string => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const h = norm(concept);
    const t = cfg.feeTypes;
    const ft = t.find((x) => x.key === concept)
      ?? t.find((x) => norm(x.key) === h || norm(x.key).startsWith(h))
      ?? t.find((x) => norm(x.name).startsWith(h));
    return ft?.name || fallback;
  }, [cfg.feeTypes]);

  // All amounts come from Fee Setup (class fees) — no static/file fallback.
  const tuitionFor = useCallback((ck: ClassKey) => classFeeAmt(CLASS_ID_BY_KEY[ck], 'tuition'), [classFeeAmt]);
  const softwareFor = useCallback((ck: ClassKey) => classFeeAmt(CLASS_ID_BY_KEY[ck], 'software'), [classFeeAmt]);
  const idCardFor = useCallback((ck: ClassKey) => classFeeAmt(CLASS_ID_BY_KEY[ck], 'idcard'), [classFeeAmt]);
  const newSetFor = useCallback((ck: ClassKey) => classFeeAmt(CLASS_ID_BY_KEY[ck], 'newadmission'), [classFeeAmt]);
  const uniformItemsFor = useCallback((ck: ClassKey, g: FeeGender) => itemsForFromMatrix(cfg.matrix, CLASS_ID_BY_KEY[ck], g), [cfg.matrix]);
  const allQty = useCallback((ck: ClassKey, g: FeeGender): Record<string, number> =>
    Object.fromEntries(uniformItemsFor(ck, g).map((it) => [it.key, 1])), [uniformItemsFor]);

  // The first child is created before /api/fees/config resolves, so its uniform
  // quantities are empty. Seed the uniform set for any new-admission child once
  // the matrix arrives (runs once).
  useEffect(() => {
    if (seeded.current) return;
    if (!cfg.feeTypes.length && !cfg.matrix) return;
    seeded.current = true;
    setChildren((cs) => cs.map((c) => (c.admission === 'new' && Object.keys(c.qty).length === 0
      ? { ...c, qty: allQty(c.classKey, c.gender) } : c)));
  }, [cfg, allQty]);

  const patchChild = (id: string, p: Partial<CounterChild>) =>
    setChildren((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const setAdmission = (ch: CounterChild, a: CounterAdmission) =>
    patchChild(ch.id, a === 'new'
      // New admission: uniforms pre-ticked, ID card + new-admission set on.
      ? { admission: 'new', idCard: true, newSet: true, qty: allQty(ch.classKey, ch.gender) }
      // Old admission: only Tuition + Software auto; uniforms optional & unticked.
      : { admission: 'old', idCard: false, newSet: false, qty: {} });
  const setClassGender = (ch: CounterChild, p: Partial<Pick<CounterChild, 'classKey' | 'gender'>>) => {
    const next = { ...ch, ...p };
    // Item set changes with class/gender: re-seed for new admission, clear for old.
    patchChild(ch.id, { ...p, qty: next.admission === 'new' ? allQty(next.classKey, next.gender) : {} });
  };

  // Attach an existing enrolled student to this child row (fills name/class/gender,
  // marks it an old admission by default).
  const pickStudent = (ch: CounterChild, stu: any) => {
    const ck = (stu.classId && CLASS_KEY_BY_ID[stu.classId as string]) || ch.classKey;
    const g: FeeGender = stu.gender === 'F' ? 'F' : 'M';
    patchChild(ch.id, { name: stu.name || ch.name, classKey: ck, gender: g, studentId: stu.id, admission: 'old', idCard: false, newSet: false, qty: {} });
    setSearch(null);
  };
  const runSearch = (id: string, q: string) => {
    setSearch({ id, q, results: search?.id === id ? search.results : [], loading: q.trim().length >= 1 });
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 1) { setSearch({ id, q, results: [], loading: false }); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/students?status=ACTIVE&q=${encodeURIComponent(q.trim())}`);
        const data = r.ok ? await r.json() : [];
        setSearch((s) => (s && s.id === id ? { ...s, results: Array.isArray(data) ? data.slice(0, 8) : [], loading: false } : s));
      } catch { setSearch((s) => (s && s.id === id ? { ...s, results: [], loading: false } : s)); }
    }, 250);
  };

  const childLines = useCallback((ch: CounterChild): { name: string; qty: number; amount: number }[] => {
    const out: { name: string; qty: number; amount: number }[] = [];
    out.push({ name: feeTypeName('tuition', 'Tuition fee'), qty: 1, amount: tuitionFor(ch.classKey) });
    out.push({ name: feeTypeName('software', 'Software'), qty: 1, amount: softwareFor(ch.classKey) });
    // Uniforms — available for both new and old admission (ticked lines only).
    for (const it of uniformItemsFor(ch.classKey, ch.gender)) {
      const q = ch.qty[it.key] || 0;
      if (q > 0) out.push({ name: it.name, qty: q, amount: it.price * q });
    }
    // One-time new-admission charges.
    if (ch.admission === 'new') {
      if (ch.newSet) out.push({ name: feeTypeName('newadmission', 'New admission set (tie + belt + socks)'), qty: 1, amount: newSetFor(ch.classKey) });
      if (ch.idCard) out.push({ name: feeTypeName('idcard', 'ID Card'), qty: 1, amount: idCardFor(ch.classKey) });
    }
    return out;
  }, [tuitionFor, softwareFor, uniformItemsFor, newSetFor, idCardFor, feeTypeName]);

  const childTotal = (ch: CounterChild) => childLines(ch).reduce((t, l) => t + l.amount, 0);
  const grandTotal = children.reduce((t, ch) => t + childTotal(ch), 0);
  const clabel = (ch: CounterChild) => `${ch.name.trim() || 'Child'} · ${ch.classKey} · ${ch.gender === 'M' ? 'Boy' : 'Girl'} · ${ch.admission === 'new' ? 'New' : 'Old'}${ch.studentId ? ` · ${ch.studentId}` : ''}`;

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
      <style>{`@media print { body { visibility: hidden; } #counterbill, #counterbill * { visibility: visible; } #counterbill { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; } }`}</style>

      {/* picker */}
      <div className="lg:col-span-2 space-y-4">
        <Card title="Walk-in bill (per parent)">
          <p className="text-xs text-slate-400 -mt-1 mb-4">Add each child, pick new or old admission — fees fill in automatically.</p>
          <div className="mb-4">
            <label className="text-xs text-slate-500 block mb-1">Parent / guardian name <span className="text-slate-400">(optional)</span></label>
            <input value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="e.g. Ramesh Kumar" className={ccInput + ' w-full sm:w-72'} />
          </div>

          <div className="space-y-4">
            {children.map((ch, idx) => {
              const uniforms = uniformItemsFor(ch.classKey, ch.gender);
              return (
                <div key={ch.id} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold flex-shrink-0">{idx + 1}</span>
                    <input value={ch.name} onChange={(e) => patchChild(ch.id, { name: e.target.value })} placeholder={`Child ${idx + 1} name`} className={ccInput + ' flex-1 min-w-0'} />
                    {children.length > 1 && (
                      <button onClick={() => setChildren((cs) => cs.filter((c) => c.id !== ch.id))} className="p-1.5 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50 flex-shrink-0" title="Remove child">
                        <Icon name="Trash2" size={16} />
                      </button>
                    )}
                  </div>

                  {/* Existing-student lookup */}
                  <div className="relative mb-3">
                    {ch.studentId ? (
                      <div className="inline-flex items-center gap-2 rounded-lg bg-purple-50 border border-purple-200 px-2.5 py-1.5 text-xs text-purple-700">
                        <Icon name="UserCheck" size={14} />
                        <span className="font-medium">Existing student · {ch.studentId}</span>
                        <button onClick={() => patchChild(ch.id, { studentId: undefined })} className="text-purple-400 hover:text-purple-700" title="Unlink">
                          <Icon name="X" size={13} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          value={search?.id === ch.id ? search.q : ''}
                          onChange={(e) => runSearch(ch.id, e.target.value)}
                          onFocus={(e) => runSearch(ch.id, e.target.value)}
                          placeholder="Add existing student — search name or ID"
                          className={ccInput + ' w-full sm:w-80'} />
                        {search?.id === ch.id && (search.q.trim().length >= 1) && (
                          <div className="absolute z-20 mt-1 w-full sm:w-80 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                            {search.loading ? (
                              <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
                            ) : search.results.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-slate-400">No matches.</div>
                            ) : search.results.map((stu) => (
                              <button key={stu.id} onClick={() => pickStudent(ch, stu)}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                                <span className="text-slate-700 truncate">{stu.name}</span>
                                <span className="text-xs text-slate-400 flex-shrink-0">{stu.class?.name ? shortClass(stu.class.name) : '—'} · {stu.id}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <select value={ch.classKey} onChange={(e) => setClassGender(ch, { classKey: e.target.value as ClassKey })} className={ccInput}>
                      {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                      {(['M', 'F'] as FeeGender[]).map((g) => (
                        <button key={g} onClick={() => setClassGender(ch, { gender: g })}
                          className={`px-3 py-2 text-xs font-medium transition-colors ${ch.gender === g ? 'bg-purple-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{g === 'M' ? 'Boy' : 'Girl'}</button>
                      ))}
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                      {(['new', 'old'] as CounterAdmission[]).map((a) => (
                        <button key={a} onClick={() => setAdmission(ch, a)}
                          className={`px-3 py-2 text-xs font-medium transition-colors ${ch.admission === a ? 'bg-purple-500 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{a === 'new' ? 'New admission' : 'Old admission'}</button>
                      ))}
                    </div>
                  </div>

                  {/* auto fees */}
                  <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-600">{feeTypeName('tuition', 'Tuition fee')}</span><span className="tabular-nums font-medium text-slate-900">{feeMoney(tuitionFor(ch.classKey))}</span></div>
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-600">{feeTypeName('software', 'Software')}</span><span className="tabular-nums font-medium text-slate-900">{feeMoney(softwareFor(ch.classKey))}</span></div>
                  </div>

                  <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                    <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                      Uniform{ch.admission === 'new' ? ' & one-time' : ''}
                      {ch.admission === 'old' && <span className="ml-1 normal-case text-slate-400">(optional — tick what they take)</span>}
                    </div>
                    {uniforms.map((it) => {
                      const q = ch.qty[it.key] || 0;
                      return (
                        <div key={it.key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-1.5">
                          <label className="flex items-center gap-2 flex-1 text-sm text-slate-700 cursor-pointer">
                            <input type="checkbox" checked={q > 0} onChange={(e) => patchChild(ch.id, { qty: { ...ch.qty, [it.key]: e.target.checked ? 1 : 0 } })} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" />
                            {it.name}
                          </label>
                          <span className="text-xs text-slate-400 tabular-nums w-16 text-right">{feeMoney(it.price)}</span>
                          {q > 0 && (
                            <input type="number" min={1} value={String(q)} onChange={(e) => patchChild(ch.id, { qty: { ...ch.qty, [it.key]: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} className="w-14 py-1 text-right tabular-nums rounded-md border border-slate-200 text-sm" />
                          )}
                        </div>
                      );
                    })}
                    {ch.admission === 'new' && (
                      <>
                        <label className="flex items-center justify-between text-sm text-slate-700 cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5">
                          <span className="flex items-center gap-2"><input type="checkbox" checked={ch.newSet} onChange={(e) => patchChild(ch.id, { newSet: e.target.checked })} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" /> New admission set <span className="text-xs text-slate-400">tie + belt + socks</span></span>
                          <span className="text-slate-500 tabular-nums">{feeMoney(newSetFor(ch.classKey))}</span>
                        </label>
                        <label className="flex items-center justify-between text-sm text-slate-700 cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5">
                          <span className="flex items-center gap-2"><input type="checkbox" checked={ch.idCard} onChange={(e) => patchChild(ch.id, { idCard: e.target.checked })} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" /> ID Card</span>
                          <span className="text-slate-500 tabular-nums">{feeMoney(idCardFor(ch.classKey))}</span>
                        </label>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 mt-2.5 pt-2.5">
                    <span className="text-xs text-slate-500">Subtotal</span>
                    <span className="font-semibold tabular-nums text-slate-900">{feeMoney(childTotal(ch))}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <Button icon="Plus" onClick={() => setChildren((cs) => [...cs, makeCounterChild()])}>Add child</Button>
          </div>
        </Card>
      </div>

      {/* bill */}
      <div>
        <div id="counterbill" className="bg-white border border-slate-200 rounded-lg shadow-xs p-5 sticky top-4">
          <div className="text-center pb-3 border-b border-slate-200">
            <div className="font-bold text-slate-900">Jnana Deepika</div>
            <div className="text-xs text-slate-500">Counter bill{parentName.trim() ? ` · ${parentName.trim()}` : ''}</div>
            <div className="text-[11px] text-slate-400">{new Date().toLocaleDateString('en-IN')}</div>
          </div>
          {grandTotal === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Add children and pick items to build the bill.</p>
          ) : (
            <div className="my-3 space-y-3">
              {children.map((ch) => {
                const lines = childLines(ch);
                if (!lines.length) return null;
                return (
                  <div key={ch.id}>
                    <div className="text-xs font-semibold text-purple-700">{clabel(ch)}</div>
                    <table className="w-full text-sm">
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="py-1 text-slate-700">{l.name}{l.qty > 1 ? ` ×${l.qty}` : ''}</td>
                            <td className="py-1 text-right tabular-nums text-slate-900">{feeMoney(l.amount)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="py-1 text-right text-xs text-slate-500">Subtotal</td>
                          <td className="py-1 text-right tabular-nums font-medium text-slate-700">{feeMoney(childTotal(ch))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="font-semibold text-slate-900">Grand total</span>
            <span className="font-bold text-lg tabular-nums text-slate-900">{feeMoney(grandTotal)}</span>
          </div>
          <div className="mt-4 no-print">
            <Button kind="primary" icon="Printer" className="w-full justify-center" onClick={() => window.print()} disabled={grandTotal === 0}>Print bill</Button>
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

function CollectionTab({ refreshKey, canCollect, canVoid, canNotify, canManage }: { refreshKey?: number; canCollect: boolean; canVoid?: boolean; canNotify?: boolean; canManage?: boolean }) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [classId, setClassId] = useState('all');
  const [classList, setClassList] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [multiId, setMultiId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{ id: string; name: string } | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'recent', dir: 'desc' }); // most recent collection → top
  const onSort = (k: string) => setSort((s) => nextSort(s, k));

  // status order so "paid" sorts to the top in ascending order
  const STATUS_RANK: Record<string, number> = { paid: 0, partial: 1, due: 2, overdue: 3 };

  // Unpaid uniform / ID-card / item heads — flags students who took items on credit.
  const itemsDue = (r: AccountRow) =>
    (r.heads || []).filter((h) => h.balance > 0 && /uniform|tie|belt|sock|id\s*card|track\s*suit/i.test(h.name));
  const itemsDueTotal = (r: AccountRow) => itemsDue(r).reduce((t, h) => t + h.balance, 0);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (filter !== 'all') params.set('filter', filter);
      if (classId !== 'all') params.set('classId', classId);
      const res = await fetch(`/api/fees/accounts?${params}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [search, filter, classId]);

  useEffect(() => {
    const t = setTimeout(fetchRows, 250);
    return () => clearTimeout(t);
  }, [fetchRows, refreshKey]); // reload after a bulk import from the header

  // Class list for the class-wise filter/print.
  useEffect(() => {
    fetch('/api/fees/grid').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.classes) setClassList(d.classes.map((c: any) => ({ id: c.id, name: c.name }))); }).catch(() => {});
  }, []);


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
    if (!w) { alert('Please allow pop-ups to print.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${inner}<script>window.onload=function(){window.focus();window.print();};</script></head></html>`);
    w.document.close();
  };

  // Individual slips the office cuts along the dashed lines and hands to students.
  const printChits = () => {
    // Only students who actually owe something — skip fully-paid (zero balance) students.
    const list = [...sorted]
      .filter((r) => r.totalBalance > 0)
      .sort((a, b) => (a.className || '').localeCompare(b.className || '') || a.name.localeCompare(b.name));
    if (!list.length) { alert('No students with a pending balance to print.'); return; }
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
function FeeImportDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
  const [section, setSection] = useState<'class' | 'van' | 'uniform' | 'types' | 'settings'>('class');
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
  const [expandedInst, setExpandedInst] = useState(''); // feeTypeId whose installment editor is open
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
      setAssignMsg(d.charged > 0
        ? `Done — added ${d.charged} fee${d.charged === 1 ? '' : 's'} across ${d.assigned} of ${d.total} students. (Already-billed heads were left as-is.)`
        : `All ${d.total} students already have every class fee — nothing to add.`);
    } catch (e) { setAssignMsg(''); setSetupErr(e instanceof Error ? e.message : 'Failed to assign'); }
  };

  if (loading || !cfg) return <div className="mt-6 space-y-3 max-w-3xl">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>;

  // Show every class-amount fee type for the class — including a class added
  // after the fee type (which has no ClassFee row yet); its amount starts at 0.
  const classFeesFor = (cid: string) =>
    cfg.feeTypes
      .filter((ft) => ft.billingMode === 'CLASS_AMOUNT')
      .map((ft) => ({ ft, cf: cfg.classFees.find((c) => c.classId === cid && c.feeTypeId === ft.id) }));

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {([['class', 'Class fees', 'GraduationCap'], ['van', 'Van fees', 'Bus'], ['uniform', 'Uniform items', 'Shirt'], ['types', 'Fee types', 'ListPlus'], ['settings', 'Fee settings', 'Settings2']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setSection(id)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-pill text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors ${section === id ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            <Icon name={icon as any} size={15} className="flex-shrink-0" />{label}
          </button>
        ))}
        <span className="ml-auto pl-2 text-xs text-slate-500 whitespace-nowrap flex-shrink-0">Year {cfg.year.label}</span>
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
                <React.Fragment key={ft.id}>
                  <tr className="border-t border-slate-100">
                    <td className="px-6 py-2.5 font-medium text-slate-900">
                      {ft.name}
                      {ft.installmentable && (cf?.installments.length ?? 0) > 0 && <span className="ml-2 text-xs text-slate-400">{cf!.installments.length} installments</span>}
                      {ft.installmentable && canManage && (
                        <button onClick={() => setExpandedInst(expandedInst === ft.id ? '' : ft.id)} className="ml-3 text-xs font-medium text-purple-600 hover:text-purple-700 inline-flex items-center gap-1">
                          <Icon name="CalendarClock" size={13} /> {(cf?.installments.length ?? 0) > 0 ? 'Edit installments' : 'Add installments'}
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-2 text-right">
                      <InlineAmount value={cf?.amount ?? 0} disabled={!canManage} onSave={(v) => patch({ kind: 'classFee', classId, feeTypeId: ft.id, amount: v }).then(load)} />
                    </td>
                  </tr>
                  {ft.installmentable && canManage && expandedInst === ft.id && (
                    <tr className="border-t border-slate-100 bg-slate-50/50">
                      <td colSpan={2} className="px-6 py-4">
                        <InstallmentEditor classId={classId} feeType={ft} amount={cf?.amount ?? 0}
                          current={(cf?.installments || []).map((i) => ({ n: i.n, amount: i.amount, dueDate: (i.dueDate || '').slice(0, 10) }))}
                          onSaved={async () => { setExpandedInst(''); await load(); }} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
        <>
        <Card padded={false} title="Uniform prices (class × gender)">
          <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Set each item&apos;s price per class. Gendered items (School / White) have separate Boy &amp; Girl prices.</span>
            {canManage && <Button size="sm" icon="Download" className="ml-auto" onClick={seedMatrix}>Load standard matrix</Button>}
          </div>
          <div className="divide-y divide-slate-100">
            {[
              ...UNIFORM_ITEM_DEFS.map((d) => ({ key: d.key, name: d.name, gendered: d.gendered })),
              ...cfg.uniformItems.filter((u) => !UNIFORM_ITEM_DEFS.some((d) => d.name.toLowerCase() === u.name.toLowerCase())).map((u) => ({ key: u.id, name: u.name, gendered: false })),
            ].map((it) => {
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

          {/* Extra uniform items beyond the standard set (e.g. Dupatta, Track Suit) */}
          <Card padded={false} className="mt-4" title="Extra uniform items">
            <div className="px-6 py-2.5 text-xs text-slate-500 border-b border-slate-100">Add items beyond the standard set with a <b>default price</b> (used in Collect Payment). Optionally set <b>class-wise prices in the grid above</b> to override the default for specific classes.</div>
            <div className="divide-y divide-slate-100">
              {cfg.uniformItems.filter((it) => !UNIFORM_ITEM_DEFS.some((d) => d.name.toLowerCase() === it.name.toLowerCase())).map((it) => (
                <div key={it.id} className="flex items-center justify-between px-6 py-2.5">
                  <span className="font-medium text-slate-900">{it.name}</span>
                  <div className="flex items-center gap-3">
                    <InlineAmount value={it.price} disabled={!canManage} onSave={(v) => patch({ kind: 'uniformItem', id: it.id, price: v }).then(load)} />
                    {canManage && <button onClick={async () => { if (!confirm(`Remove "${it.name}"?`)) return; await fetch(`/api/fees/config?kind=uniformItem&id=${it.id}`, { method: 'DELETE' }); await load(); }} className="text-slate-300 hover:text-danger-600" title="Remove item"><Icon name="Trash2" size={15} /></button>}
                  </div>
                </div>
              ))}
              {cfg.uniformItems.filter((it) => !UNIFORM_ITEM_DEFS.some((d) => d.name.toLowerCase() === it.name.toLowerCase())).length === 0 && (
                <div className="px-6 py-4 text-sm text-slate-400">No extra items yet.</div>
              )}
            </div>
            {canManage && (
              <div className="flex items-end gap-2 px-6 py-3 border-t border-slate-100">
                <div className="flex-1"><Field label="New item name"><Input value={newUniform.name} onChange={(e) => setNewUniform({ ...newUniform, name: e.target.value })} placeholder="e.g. Dupatta" /></Field></div>
                <div className="w-28"><Field label="Default price (₹)"><Input type="number" value={newUniform.price} onChange={(e) => setNewUniform({ ...newUniform, price: e.target.value })} placeholder="0" className="text-right tabular-nums" /></Field></div>
                <Button icon="Plus" onClick={addUniform} disabled={!newUniform.name.trim()}>Add</Button>
              </div>
            )}
          </Card>
        </>
      )}

      {section === 'types' && <FeeTypesSection cfg={cfg} canManage={canManage} reload={load} />}
      {section === 'settings' && <CollectionSettingsPanel canEdit={canManage} />}
    </div>
  );
}

const BILLING_LABEL: Record<string, { label: string; tone: 'info' | 'success' | 'warn' | 'neutral' }> = {
  CLASS_AMOUNT: { label: 'Per class', tone: 'info' },
  VILLAGE: { label: 'Per village (van)', tone: 'success' },
  ITEMIZED: { label: 'Itemized (uniform)', tone: 'warn' },
  MANUAL: { label: 'Manual (per student)', tone: 'neutral' },
};

/** Edit a class fee's installment plan (count, amount, due date per installment). */
function InstallmentEditor({ classId, feeType, amount, current, onSaved }: {
  classId: string; feeType: { id: string; name: string }; amount: number;
  current: { n: number; amount: number; dueDate: string }[];
  onSaved: () => void | Promise<void>;
}) {
  type Row = { amount: string; dueDate: string };
  const seed: Row[] = current.length
    ? current.map((i) => ({ amount: String(i.amount), dueDate: i.dueDate }))
    : [{ amount: String(amount || 0), dueDate: '' }];
  const [rows, setRows] = useState<Row[]>(seed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { amount: '', dueDate: '' }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const splitEqually = () => {
    const n = rows.length || 1;
    const base = Math.floor((amount || 0) / n);
    const rem = (amount || 0) - base * n;
    setRows((rs) => rs.map((r, i) => ({ ...r, amount: String(base + (i === 0 ? rem : 0)) })));
  };

  const save = async (clear = false) => {
    setBusy(true); setMsg('');
    try {
      const installments = clear ? [] : rows
        .map((r, i) => ({ n: i + 1, amount: Number(r.amount) || 0, dueDate: r.dueDate }))
        .filter((r) => r.amount > 0 && r.dueDate);
      if (!clear && installments.length === 0) throw new Error('Enter an amount and due date for each installment.');
      const res = await fetch('/api/fees/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setInstallments', classId, feeTypeId: feeType.id, installments, resplitExisting: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed to save');
      setMsg(clear ? 'Installments cleared.' : `Saved ${d.installments} installments · re-split ${d.resplit} student${d.resplit === 1 ? '' : 's'}${d.skippedPaid ? ` · ${d.skippedPaid} left (already paid)` : ''}.`);
      setTimeout(() => onSaved(), 700);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 max-w-xl">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-800">{feeType.name} — installments</div>
        <button onClick={splitEqually} className="text-xs font-medium text-purple-600 hover:text-purple-700">Split ₹{amount.toLocaleString('en-IN')} equally</button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 w-10">#{i + 1}</span>
            <div className="flex-1">
              <input type="number" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} placeholder="Amount ₹"
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-right tabular-nums outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
            </div>
            <div className="flex-1">
              <input type="date" value={r.dueDate} onChange={(e) => setRow(i, { dueDate: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20" />
            </div>
            <button onClick={() => delRow(i)} disabled={rows.length === 1} className="text-slate-300 hover:text-danger-600 disabled:opacity-30" title="Remove installment"><Icon name="X" size={15} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <button onClick={addRow} className="font-medium text-purple-600 hover:text-purple-700 inline-flex items-center gap-1"><Icon name="Plus" size={13} /> Add installment</button>
        <span className={`tabular-nums ${total === amount ? 'text-slate-500' : 'text-marigold-700 font-medium'}`}>Total ₹{total.toLocaleString('en-IN')}{total !== amount ? ` (fee is ₹${amount.toLocaleString('en-IN')})` : ''}</span>
      </div>
      {msg && <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-3 py-2">{msg}</div>}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" kind="primary" icon="Check" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save installments'}</Button>
        {current.length > 0 && <Button size="sm" onClick={() => save(true)} disabled={busy}>Clear</Button>}
      </div>
      <p className="text-[11px] text-slate-400">Saving also splits students who have this fee unpaid. Students with a payment on it are left unchanged.</p>
    </div>
  );
}

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
  byHead: { key: string; name: string; amount: number }[];
  byClass: { name: string; amount: number }[];
  byVillage: { name: string; amount: number }[];
  byDay: { day: string; amount: number }[];
  outstanding: { id: string; name: string; className: string | null; balance: number }[];
  outstandingTotal: number;
  notPaidInRange: { id: string; name: string; className: string | null; balance: number }[];
  notPaidInRangeTotal: number;
  notPaidInRangeCount: number;
  rangeActive: boolean;
  billedTotal: number;
  collectedAllTotal: number;
  withDues: number;
  classSummary: { classId: string | null; name: string; billed: number; collected: number; pending: number; students: number; withDues: number }[];
  oldFeeCollected: number;
  oldFeePending: number;
  uniformCollected: number;
  uniformPending: number;
  uniformItems: { name: string; collected: number; pending: number }[];
  uniformPendingStudents: { id: string; name: string; className: string | null; balance: number }[];
  vanByVillage: { village: string; students: number; charged: number; collected: number; pending: number }[];
  concessionTotal: number;
  concessionByHead: { name: string; amount: number }[];
  concessionStudents: { id: string; name: string; className: string | null; amount: number }[];
  oldDue: { id: string; name: string; className: string | null; amount: number; paid: number; balance: number }[];
  oldDueUnpaid: { id: string; name: string; className: string | null; amount: number; paid: number; balance: number }[];
  installmentDue: { id: string; name: string; className: string | null; label: string; dueDate: string | null; balance: number; status: ChargeStatus }[];
}

function ReportsTab() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [headDrill, setHeadDrill] = useState<{ key: string; name: string } | null>(null);
  const [classDrill, setClassDrill] = useState<{ classId: string; name: string } | null>(null);
  const [uniformDrill, setUniformDrill] = useState(false);
  const [concessionDrill, setConcessionDrill] = useState(false);

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

  const rate = data.billedTotal > 0 ? Math.round((data.collectedAllTotal / data.billedTotal) * 100) : 0;

  return (
    <div className="mt-6 space-y-5">
      {/* Year overview — compact KPI strip (denser than the old hero, more data) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {([
          { label: `Collected · ${data.year.label}`, value: feeMoney(data.collectedAllTotal), icon: 'IndianRupee', bar: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700', sub: `${rate}% of billed` },
          { label: 'Billed (year)', value: feeMoney(data.billedTotal), icon: 'ReceiptText', bar: 'bg-slate-400', badge: 'bg-slate-100 text-slate-700' },
          { label: 'Outstanding', value: feeMoney(data.outstandingTotal), icon: 'AlertCircle', bar: 'bg-danger-500', badge: 'bg-danger-100 text-danger-700', sub: `${data.withDues} student${data.withDues === 1 ? '' : 's'}` },
          { label: 'Collection rate', value: `${rate}%`, icon: 'TrendingUp', bar: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700', pct: rate },
          { label: 'Uniform collected', value: feeMoney(data.uniformCollected), icon: 'Shirt', bar: 'bg-info-500', badge: 'bg-info-100 text-info-700', sub: data.uniformPending > 0 ? `${feeMoney(data.uniformPending)} pending` : 'fully paid' },
          { label: 'Old fee collected', value: feeMoney(data.oldFeeCollected), icon: 'History', bar: 'bg-success-500', badge: 'bg-success-100 text-success-700' },
          { label: 'Old fee pending', value: feeMoney(data.oldFeePending), icon: 'History', bar: 'bg-danger-500', badge: 'bg-danger-100 text-danger-700' },
          { label: 'Uniform pending', value: feeMoney(data.uniformPending), icon: 'Shirt', bar: 'bg-danger-500', badge: 'bg-danger-100 text-danger-700' },
        ] as { label: string; value: string; icon: string; bar: string; badge: string; sub?: string; pct?: number }[]).map((k) => (
          <div key={k.label} className="relative bg-white border border-slate-200 rounded-2xl shadow-xs px-3.5 py-3 overflow-hidden">
            <span className={`absolute left-0 top-0 bottom-0 w-1 ${k.bar}`} aria-hidden />
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${k.badge}`}><Icon name={k.icon as any} size={15} /></div>
              <div className="text-[10.5px] text-slate-500 leading-tight">{k.label}</div>
            </div>
            <div className="text-lg font-bold text-slate-900 leading-none tabular-nums mt-2 truncate">{k.value}</div>
            {k.sub && <div className="text-[10.5px] text-slate-400 mt-1">{k.sub}</div>}
            {typeof k.pct === 'number' && <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${k.bar}`} style={{ width: `${Math.min(100, k.pct)}%` }} /></div>}
          </div>
        ))}
      </div>

      {/* range filter — collection within a date range (also drives "not paid in range") */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button size="sm" onClick={thisMonth}>This month</Button>
          <Button size="sm" onClick={clearRange}>Whole year</Button>
          <div className="ml-auto text-right">
            <div className="text-2xl font-bold text-purple-600 tabular-nums">{feeMoney(data.collectedTotal)}</div>
            <div className="text-xs text-slate-500">{data.paymentCount} payments {from || to ? 'in range' : `· year ${data.year.label}`}</div>
          </div>
        </div>
        {data.rangeActive && (
          <p className="text-[12px] text-slate-500 mt-3 pt-3 border-t border-slate-100">
            Set a range (e.g. 20 May → today) to see the <b className="text-danger-700">{data.notPaidInRangeCount}</b> student{data.notPaidInRangeCount === 1 ? '' : 's'} who owe money and made <b>no payment</b> in that period — listed below.
          </p>
        )}
      </Card>

      {/* Who hasn't paid in the selected range (with dues, zero payments in range) */}
      {data.rangeActive && (
        <Card padded={false} title={<div className="flex items-center justify-between w-full">
          <span className="inline-flex items-center gap-2"><Icon name="UserX" size={16} className="text-danger-600" /> Not paid {from ? `since ${new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}{to ? ` – ${new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</span>
          <span className="text-sm font-normal"><span className="text-slate-500">{data.notPaidInRangeCount} student{data.notPaidInRangeCount === 1 ? '' : 's'} · </span><span className="text-danger-700 font-semibold tabular-nums">{feeMoney(data.notPaidInRangeTotal)}</span></span>
        </div>}>
          <ReportRows
            head={['Student', 'Class', 'Outstanding']}
            rows={data.notPaidInRange.map((r) => [r.name + '  ·  ' + r.id, shortClass(r.className), feeMoney(r.balance)])}
            empty="Everyone with dues has paid something in this range 🎉"
          />
        </Card>
      )}

      {/* Class-wise: collected vs pending, with headcounts. Click a class → its students. */}
      <ClassBreakdown rows={data.classSummary} onClass={(r) => setClassDrill({ classId: r.classId || 'unassigned', name: r.name })} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarList title="Collection by fee head" icon="Layers" accent="purple"
          rows={data.byHead} empty="No collection yet" onRow={(r) => setHeadDrill({ key: r.key!, name: r.name })} />
        <BarList title="Collection by village" icon="MapPin" accent="marigold"
          rows={data.byVillage} empty="No collection yet" />
        <BarList title="Daily collection" icon="CalendarDays" accent="success"
          rows={data.byDay.map((r) => ({ name: new Date(r.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), amount: r.amount }))} empty="No collection yet" />
      </div>

      {/* Uniform — collected per item (White Uniform, School Uniform…) + pending drill-down */}
      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="Shirt" size={16} className="text-info-600" /> Uniform — collected by item</span>
        <span className="text-sm font-normal"><span className="text-success-700 font-semibold tabular-nums">{feeMoney(data.uniformCollected)}</span><span className="text-slate-400"> collected</span></span>
      </div>}>
        {data.uniformItems.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-400">No uniform collection yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[360px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="text-left font-semibold px-4 py-2">Item</th>
                    <th className="text-right font-semibold px-4 py-2">Collected</th>
                    <th className="text-right font-semibold px-4 py-2">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data.uniformItems.map((u) => (
                    <tr key={u.name} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 text-slate-800">{u.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-success-700 font-medium">{feeMoney(u.collected)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${u.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(u.pending)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="px-4 py-2 text-slate-900">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums text-success-700">{feeMoney(data.uniformCollected)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-danger-700">{feeMoney(data.uniformPending)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {data.uniformPendingStudents.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
                <span className="text-[12.5px] text-slate-500">{data.uniformPendingStudents.length} student{data.uniformPendingStudents.length === 1 ? '' : 's'} owe uniform · {feeMoney(data.uniformPending)}</span>
                <Button size="sm" icon="ListChecks" onClick={() => setUniformDrill(true)}>View pending students</Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Van fee by village — van students only */}
      {data.vanByVillage.length > 0 && (
        <Card padded={false} title={<div className="flex items-center justify-between w-full">
          <span className="inline-flex items-center gap-2"><Icon name="Bus" size={16} className="text-purple-600" /> Van fee by village <span className="text-slate-400 font-normal">(van students only)</span></span>
          <span className="text-sm font-normal"><span className="text-success-700 font-semibold tabular-nums">{feeMoney(data.vanByVillage.reduce((t, v) => t + v.collected, 0))}</span><span className="text-slate-400"> collected</span></span>
        </div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="text-left font-semibold px-4 py-2">Village</th>
                  <th className="text-right font-semibold px-4 py-2">Students</th>
                  <th className="text-right font-semibold px-4 py-2">Collected</th>
                  <th className="text-right font-semibold px-4 py-2">Pending</th>
                </tr>
              </thead>
              <tbody>
                {data.vanByVillage.map((v) => (
                  <tr key={v.village} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 text-slate-800">{v.village}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{v.students}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-success-700 font-medium">{feeMoney(v.collected)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${v.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(v.pending)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-4 py-2 text-slate-900">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">{data.vanByVillage.reduce((t, v) => t + v.students, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-success-700">{feeMoney(data.vanByVillage.reduce((t, v) => t + v.collected, 0))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-danger-700">{feeMoney(data.vanByVillage.reduce((t, v) => t + v.pending, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Concessions given (fee waived) — by head + which students */}
      {data.concessionTotal > 0 && (
        <Card padded={false} title={<div className="flex items-center justify-between w-full">
          <span className="inline-flex items-center gap-2"><Icon name="BadgePercent" size={16} className="text-info-600" /> Concessions given <span className="text-slate-400 font-normal">(fee waived)</span></span>
          <span className="text-sm font-normal"><span className="text-info-700 font-semibold tabular-nums">{feeMoney(data.concessionTotal)}</span></span>
        </div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[320px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="text-left font-semibold px-4 py-2">Fee head</th>
                  <th className="text-right font-semibold px-4 py-2">Concession</th>
                </tr>
              </thead>
              <tbody>
                {data.concessionByHead.map((h) => (
                  <tr key={h.name} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 text-slate-800">{h.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-info-700 font-medium">{feeMoney(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-4 py-2 text-slate-900">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums text-info-700">{feeMoney(data.concessionTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {data.concessionStudents.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
              <span className="text-[12.5px] text-slate-500">{data.concessionStudents.length} student{data.concessionStudents.length === 1 ? '' : 's'} got a concession</span>
              <Button size="sm" icon="ListChecks" onClick={() => setConcessionDrill(true)}>View students</Button>
            </div>
          )}
        </Card>
      )}

      {/* Old fee — who hasn't paid yet */}
      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="History" size={16} className="text-danger-600" /> Old fee — not paid yet</span>
        <span className="text-sm font-normal">
          <span className="text-slate-500">{data.oldDueUnpaid.length} student{data.oldDueUnpaid.length === 1 ? '' : 's'} · </span>
          <span className="text-danger-700 font-semibold tabular-nums">{feeMoney(data.oldFeePending)}</span>
        </span>
      </div>}>
        <ReportRows
          head={['Student', 'Class', 'Old fee', 'Paid', 'Pending']}
          rows={data.oldDueUnpaid.map((r) => [`${r.name}  ·  ${r.id}`, shortClass(r.className), feeMoney(r.amount), feeMoney(r.paid), feeMoney(r.balance)])}
          empty="No pending old fees 🎉"
        />
      </Card>

      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="AlertCircle" size={16} className="text-danger-600" /> Outstanding fees</span>
        <span className="text-sm font-normal"><span className="text-slate-500">{data.withDues} student{data.withDues === 1 ? '' : 's'} · </span><span className="text-danger-700 font-semibold tabular-nums">{feeMoney(data.outstandingTotal)}</span></span>
      </div>}>
        <ReportRows
          head={['Student', 'Class', 'Balance']}
          rows={data.outstanding.map((r) => [r.name + '  ·  ' + r.id, shortClass(r.className), feeMoney(r.balance)])}
          empty="Everyone is paid up 🎉"
        />
      </Card>

      <Card padded={false} title={<div className="flex items-center justify-between w-full">
        <span className="inline-flex items-center gap-2"><Icon name="CalendarClock" size={16} className="text-marigold-600" /> Installments due</span>
        <span className="text-sm font-normal text-slate-500">{data.installmentDue.length} pending</span>
      </div>}>
        <ReportRows head={['Student', 'Installment', 'Balance']} rows={data.installmentDue.map((r) => [r.name, `${r.label}${r.dueDate ? ' · ' + r.dueDate : ''}`, feeMoney(r.balance)])} empty="No pending installments" />
      </Card>

      {headDrill && <HeadPaymentsDrawer headKey={headDrill.key} headName={headDrill.name} from={from} to={to} onClose={() => setHeadDrill(null)} />}
      {classDrill && <ClassStudentsDrawer classId={classDrill.classId} className={classDrill.name} onClose={() => setClassDrill(null)} />}
      {uniformDrill && (
        <Drawer open onClose={() => setUniformDrill(false)} title="Uniform pending" width={520}
          subtitle={`${data.uniformPendingStudents.length} student(s) · ${feeMoney(data.uniformPending)}`}
          footer={<div className="flex justify-end"><Button onClick={() => setUniformDrill(false)}>Close</Button></div>}>
          <ReportRows
            head={['Student', 'Class', 'Pending']}
            rows={data.uniformPendingStudents.map((r) => [`${r.name}  ·  ${r.id}`, shortClass(r.className), feeMoney(r.balance)])}
            empty="No uniform dues 🎉"
          />
        </Drawer>
      )}
      {concessionDrill && (
        <Drawer open onClose={() => setConcessionDrill(false)} title="Concessions given" width={520}
          subtitle={`${data.concessionStudents.length} student(s) · ${feeMoney(data.concessionTotal)}`}
          footer={<div className="flex justify-end"><Button onClick={() => setConcessionDrill(false)}>Close</Button></div>}>
          <ReportRows
            head={['Student', 'Class', 'Concession']}
            rows={data.concessionStudents.map((r) => [`${r.name}  ·  ${r.id}`, shortClass(r.className), feeMoney(r.amount)])}
            empty="No concessions"
          />
        </Drawer>
      )}
    </div>
  );
}

// Drill-down: students who paid toward a fee head, by date.
function HeadPaymentsDrawer({ headKey, headName, from, to, onClose }: { headKey: string; headName: string; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<{ headName: string; total: number; count: number; rows: { studentId: string; student: string; className: string | null; date: string; amount: number; receiptNo: string; method: string; label: string }[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const p = new URLSearchParams({ headKey });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    fetch(`/api/fees/reports/head-payments?${p}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [headKey, from, to]);

  const rangeLabel = from || to ? `${from || '…'} → ${to || '…'}` : 'Whole year';

  return (
    <Drawer open onClose={onClose} title={headName} subtitle={`Who paid · ${rangeLabel}`} width={620}
      footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      {!data && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>}
      {error && <EmptyState icon="AlertCircle" title="Couldn't load" body={error} />}
      {data && (
        <>
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-slate-500">{data.count} payment{data.count === 1 ? '' : 's'}</span>
            <span className="font-bold tabular-nums text-slate-900">{feeMoney(data.total)}</span>
          </div>
          {data.rows.length === 0 ? (
            <EmptyState icon="ReceiptText" title="No payments to this head" body="Nothing was collected for this fee head in the selected range." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Date</th>
                    <th className="text-left font-semibold px-3 py-2">Student</th>
                    <th className="text-left font-semibold px-3 py-2">Class</th>
                    <th className="text-right font-semibold px-3 py-2">Amount</th>
                    <th className="text-left font-semibold px-3 py-2">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                      <td className="px-3 py-2"><div className="text-slate-900">{r.student}</div>{r.label && !/^tuition|software|id\s*card/i.test(r.label) && <div className="text-[11px] text-slate-400">{r.label}</div>}</td>
                      <td className="px-3 py-2 text-slate-600">{shortClass(r.className)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{feeMoney(r.amount)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.receiptNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

// Drill-down: each student in a class with their paid & pending for the year.
function ClassStudentsDrawer({ classId, className, onClose }: { classId: string; className: string; onClose: () => void }) {
  const [data, setData] = useState<{ className: string; students: { id: string; name: string; billed: number; paid: number; pending: number }[]; totals: { billed: number; paid: number; pending: number } } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/fees/reports/class-students?classId=${encodeURIComponent(classId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [classId]);

  return (
    <Drawer open onClose={onClose} title={shortClass(className) || 'Class'} subtitle="Each student — paid & pending" width={620}
      footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      {!data && !error && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>}
      {error && <EmptyState icon="AlertCircle" title="Couldn't load" body={error} />}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: 'Billed', value: feeMoney(data.totals.billed), tone: 'text-slate-900' },
              { label: 'Paid', value: feeMoney(data.totals.paid), tone: 'text-success-700' },
              { label: 'Pending', value: feeMoney(data.totals.pending), tone: data.totals.pending > 0 ? 'text-danger-700' : 'text-slate-400' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <div className={`text-base font-bold tabular-nums ${s.tone}`}>{s.value}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          {data.students.length === 0 ? (
            <EmptyState icon="Users" title="No students" body="No students in this class." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Student</th>
                    <th className="text-right font-semibold px-3 py-2">Paid</th>
                    <th className="text-right font-semibold px-3 py-2">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100 odd:bg-slate-50/40">
                      <td className="px-3 py-2"><div className="text-slate-900">{s.name}</div><div className="text-[11px] text-slate-400 font-mono">{s.id}</div></td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-success-700">{feeMoney(s.paid)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(s.pending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

// A breakdown list where each row carries a proportional bar — turns a plain
// column of numbers into an at-a-glance visual. Optionally clickable (drill-down).
const BAR_ACCENT: Record<string, { bar: string; chip: string }> = {
  purple: { bar: 'bg-purple-500', chip: 'bg-purple-100 text-purple-700' },
  info: { bar: 'bg-info-500', chip: 'bg-info-100 text-info-700' },
  marigold: { bar: 'bg-marigold-500', chip: 'bg-marigold-100 text-marigold-700' },
  success: { bar: 'bg-success-500', chip: 'bg-success-100 text-success-700' },
};
function BarList({ title, icon, accent = 'purple', rows, empty, onRow }: {
  title: string; icon: string; accent?: keyof typeof BAR_ACCENT;
  rows: { key?: string; name: string; amount: number }[]; empty: string;
  onRow?: (r: { key?: string; name: string; amount: number }) => void;
}) {
  const a = BAR_ACCENT[accent] || BAR_ACCENT.purple;
  const total = rows.reduce((t, r) => t + r.amount, 0);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className={`w-7 h-7 rounded-lg grid place-items-center ${a.chip}`}><Icon name={icon as any} size={15} /></span>
          <span className="text-sm font-bold text-slate-900">{title}</span>
        </div>
        {rows.length > 0 && <span className="text-xs font-semibold tabular-nums text-slate-500">{feeMoney(total)}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">{empty}</div>
      ) : (
        <div className="p-2 max-h-96 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={r.key || i} onClick={onRow ? () => onRow(r) : undefined}
              className={`group rounded-lg px-3 py-2 transition-colors ${onRow ? 'cursor-pointer hover:bg-slate-50' : ''}`}
              title={onRow ? 'Show who paid, by date' : undefined}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="text-[13px] text-slate-700 truncate">{r.name}</span>
                <span className="text-[13px] font-semibold tabular-nums text-slate-900 whitespace-nowrap flex items-center gap-1">
                  {feeMoney(r.amount)}
                  {onRow && <Icon name="ChevronRight" size={13} className="text-slate-300 group-hover:text-purple-400" />}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${a.bar}`} style={{ width: `${Math.max(3, (r.amount / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Class-wise detail: billed / collected / pending, a collected-vs-pending bar,
// and how many students still owe. The core "who's behind, by class" view.
function ClassBreakdown({ rows, onClass }: { rows: { classId: string | null; name: string; billed: number; collected: number; pending: number; students: number; withDues: number }[]; onClass?: (r: { classId: string | null; name: string }) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg grid place-items-center bg-info-100 text-info-700"><Icon name="GraduationCap" size={15} /></span>
          <span className="text-sm font-bold text-slate-900">Class-wise collection &amp; pending</span>
        </div>
        <span className="text-xs text-slate-400">{rows.length} class{rows.length === 1 ? '' : 'es'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-5 py-2.5">Class</th>
                <th className="text-right font-semibold px-4 py-2.5">Students</th>
                <th className="text-right font-semibold px-4 py-2.5">Collected</th>
                <th className="text-right font-semibold px-4 py-2.5">Pending</th>
                <th className="text-left font-semibold px-4 py-2.5 w-[170px]">Progress</th>
                {onClass && <th className="px-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.billed > 0 ? Math.round((r.collected / r.billed) * 100) : 100;
                return (
                  <tr key={r.name} onClick={onClass ? () => onClass({ classId: r.classId, name: r.name }) : undefined}
                    className={`group border-t border-slate-100 transition-colors ${onClass ? 'cursor-pointer hover:bg-purple-50/40' : 'hover:bg-slate-50/60'}`}
                    title={onClass ? 'Show each student — paid & pending' : undefined}>
                    <td className="px-5 py-2.5 font-medium text-slate-800 whitespace-nowrap">{shortClass(r.name)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {r.students}
                      {r.withDues > 0 && <span className="ml-1.5 inline-flex items-center rounded-full bg-danger-50 text-danger-700 text-[10.5px] font-semibold px-1.5 py-0.5">{r.withDues} due</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-success-700">{feeMoney(r.collected)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${r.pending > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{feeMoney(r.pending)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-danger-100 overflow-hidden min-w-[70px]">
                          <div className="h-full rounded-full bg-success-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] tabular-nums text-slate-500 w-9 text-right">{pct}%</span>
                      </div>
                    </td>
                    {onClass && <td className="px-2 text-right"><Icon name="ChevronRight" size={15} className="text-slate-300 group-hover:text-purple-400" /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportRows({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <div className="py-8"><EmptyState icon="CheckCircle2" title={empty} /></div>;
  return (
    <div className="overflow-x-auto max-h-96 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
          <tr className="text-[11px] uppercase tracking-wide text-slate-500">
            {head.map((h, i) => <th key={i} className={`font-semibold px-6 py-2.5 border-b border-slate-200 ${i === head.length - 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 odd:bg-slate-50/40 hover:bg-purple-50/40 transition-colors">
              {r.map((cell, j) => <td key={j} className={`px-6 py-2 ${j === r.length - 1 ? 'text-right tabular-nums font-semibold text-slate-900' : 'text-slate-700'}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
