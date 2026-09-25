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
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query';
import { shortClass } from './_shared';

// A student row returned by the /api/students search, as used to attach an
// existing student to a counter-bill row.
type StudentHit = { id: string; name: string; classId?: string | null; gender?: string | null; class?: { name: string | null } | null };

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

export function CounterTab() {
  const [parentName, setParentName] = useState('');
  const [children, setChildren] = useState<CounterChild[]>([makeCounterChild()]);
  const [cfg, setCfg] = useState<CounterCfg>({ matrix: null, feeTypes: [], classFees: [] });
  const [search, setSearch] = useState<{ id: string; q: string; results: StudentHit[]; loading: boolean } | null>(null);
  const seeded = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shares the ['fees','config'] cache with the Fee setup tab — switching tabs
  // doesn't re-fetch the config.
  const { data: cfgData } = useQuery({
    queryKey: ['fees', 'config'],
    queryFn: () => jsonFetcher<{ uniformMatrix?: CounterCfg['matrix']; feeTypes?: CounterCfg['feeTypes']; classFees?: CounterCfg['classFees'] }>('/api/fees/config'),
  });
  useEffect(() => {
    if (cfgData) setCfg({ matrix: cfgData.uniformMatrix ?? null, feeTypes: cfgData.feeTypes ?? [], classFees: cfgData.classFees ?? [] });
  }, [cfgData]);

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
  const pickStudent = (ch: CounterChild, stu: StudentHit) => {
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
