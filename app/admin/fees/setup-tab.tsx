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
import { toast } from '@/lib/toast';
import { shortClass } from './_shared';

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

export function SetupTab({ canManage }: { canManage: boolean }) {
  const [section, setSection] = useState<'class' | 'van' | 'uniform' | 'types' | 'settings'>('class');
  const [classId, setClassId] = useState<string>('');

  const { data: cfg = null, isLoading: loading, refetch } = useQuery({
    queryKey: ['fees', 'config'],
    queryFn: () => jsonFetcher<ConfigData>('/api/fees/config'),
  });
  // Reuse across the ~10 mutation handlers below — refetch, typed as Promise<void>.
  const load = useCallback(async () => { await refetch(); }, [refetch]);
  // Default the class picker to the first class once config arrives.
  useEffect(() => { if (cfg && !classId && cfg.classes[0]) setClassId(cfg.classes[0].id); }, [cfg, classId]);

  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/fees/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); toast.error(d.error || 'Could not save fee.'); return; }
    toast.success('Fee saved.');
  };
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/fees/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); const m = d.error || 'Failed'; toast.error(m); throw new Error(m); }
    toast.success('Saved.');
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

// Stable, per-row id so React keys survive add/remove/reorder of installments.
let instSeq = 0;
const rid = () => `inst${instSeq++}`;

/** Edit a class fee's installment plan (count, amount, due date per installment). */
function InstallmentEditor({ classId, feeType, amount, current, onSaved }: {
  classId: string; feeType: { id: string; name: string }; amount: number;
  current: { n: number; amount: number; dueDate: string }[];
  onSaved: () => void | Promise<void>;
}) {
  type Row = { _id: string; amount: string; dueDate: string };
  const seed: Row[] = current.length
    ? current.map((i) => ({ _id: rid(), amount: String(i.amount), dueDate: i.dueDate }))
    : [{ _id: rid(), amount: String(amount || 0), dueDate: '' }];
  const [rows, setRows] = useState<Row[]>(seed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { _id: rid(), amount: '', dueDate: '' }]);
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
      toast.success(clear ? 'Installments cleared.' : 'Installments saved.');
      setTimeout(() => onSaved(), 700);
    } catch (e) { const m = e instanceof Error ? e.message : 'Failed to save'; setMsg(m); toast.error(m); }
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
          <div key={r._id} className="flex items-center gap-2">
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

  const send = async (method: string, body?: Record<string, unknown>, qs = '') => {
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
      toast.success('Fee head added.');
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Failed';
      setError(m);
      toast.error(m);
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

