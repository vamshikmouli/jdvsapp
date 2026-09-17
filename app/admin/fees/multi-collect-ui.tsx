'use client';

// Multi Collect — collect fees for several siblings (one parent) in one go.
// Standalone: it only READS accounts and POSTs to the existing /api/fees/payments
// endpoint (one payment per child), so the single-student CollectDrawer is untouched.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Drawer, Modal, Skeleton, EmptyState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { feeMoney, PAY_METHOD_LABEL } from '@/lib/fees';
import { shortClass } from './account-ui';
import { useBranding } from '@/components/useBranding';

interface Charge { chargeId: string; headKey: string; headName: string; label: string; balance: number; dueDate: string | null }
interface AddOpts {
  van: { feeTypeId: string | null; suggested: number; rates: { village: string; fee: number }[]; village: string | null };
  uniform: { feeTypeId: string | null; items: { name: string; price: number }[] };
  idCard: { feeTypeId: string | null; fee: number };
  oldFeeTypeId: string | null;
}
interface Kid { id: string; name: string; className: string | null; gender: string; village: string | null; outstanding: number; charges: Charge[]; add: AddOpts | null }
interface Family { parent: { name: string; phone: string }; students: Kid[]; priority: string[] }

// Per-child "Add a fee" (Van / Uniform / ID card / Old fee) — mirrors single Collect.
function AddFeePanel({ kid, adding, onAdd }: {
  kid: Kid; adding: string;
  onAdd: (feeTypeId: string | null | undefined, amount: number, label: string, opKey: string, append: boolean, village?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chip, setChip] = useState<'van' | 'uniform' | 'idcard' | 'oldfee' | null>(null);
  const [label, setLabel] = useState('');
  const [amt, setAmt] = useState('');
  const [uni, setUni] = useState('');
  const [vanVillage, setVanVillage] = useState('');
  const a = kid.add;
  if (!a) return null;
  const vanNorm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const pick = (k: typeof chip) => {
    setChip(k);
    if (k === 'van') {
      setLabel('Van / Transport');
      // Default to the child's own village if it has a configured rate.
      const own = a.van.rates.find((r) => vanNorm(r.village) === vanNorm(kid.village || ''));
      setVanVillage(own ? own.village : '');
      setAmt(own ? String(own.fee) : (a.van.suggested ? String(a.van.suggested) : ''));
    }
    else if (k === 'idcard') { setLabel('ID Card'); setAmt(a.idCard.fee ? String(a.idCard.fee) : ''); }
    else if (k === 'oldfee') { setLabel('Old dues'); setAmt(''); }
    else { setLabel(''); setAmt(''); setUni(''); }
  };
  const pickVanVillage = (v: string) => { setVanVillage(v); const r = a.van.rates.find((x) => x.village === v); if (r) setAmt(String(r.fee)); };
  const pickUni = (name: string) => { setUni(name); const it = a.uniform.items.find((x) => x.name === name); setLabel(`Uniform — ${name}`); if (it?.price) setAmt(String(it.price)); };
  const reset = () => { setChip(null); setLabel(''); setAmt(''); setUni(''); setVanVillage(''); };

  const feeTypeId = chip === 'van' ? a.van.feeTypeId : chip === 'uniform' ? a.uniform.feeTypeId : chip === 'idcard' ? a.idCard.feeTypeId : chip === 'oldfee' ? a.oldFeeTypeId : null;
  const submit = () => {
    const amount = Math.round(Number(String(amt).replace(/[^\d]/g, '')) || 0);
    onAdd(feeTypeId, amount, label.trim() || 'Fee', `${kid.id}-${chip}`, chip === 'uniform', chip === 'van' ? (vanVillage || kid.village || undefined) : undefined);
    reset(); setOpen(false);
  };

  const chips: [typeof chip, string, string][] = [['van', 'Van', 'Bus'], ['uniform', 'Uniform', 'Shirt'], ['idcard', 'ID card', 'CreditCard'], ['oldfee', 'Old fee', 'History']];
  return (
    <div className="px-2 pb-2">
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-purple-300 hover:text-purple-700 hover:bg-purple-50/40 py-2 text-[12.5px] font-semibold">
          <Icon name="Plus" size={14} /> Add a fee (van, uniform, ID card, old fee)
        </button>
      ) : (
        <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-3">
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {chips.map(([k, lbl, icon]) => (
              <button key={k} onClick={() => pick(k)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${chip === k ? 'border-purple-500 bg-white text-purple-700 ring-2 ring-purple-100' : 'border-slate-200 bg-white text-slate-600 hover:text-purple-700'}`}>
                <Icon name={icon as any} size={13} />{lbl}
              </button>
            ))}
          </div>
          {chip === 'van' && (
            <select value={vanVillage} onChange={(e) => pickVanVillage(e.target.value)} className="w-full mb-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]">
              <option value="">— Choose village —</option>
              {a.van.rates.map((r) => <option key={r.village} value={r.village}>{r.village} — ₹{r.fee}/yr</option>)}
              {vanVillage && !a.van.rates.some((r) => r.village === vanVillage) && <option value={vanVillage}>{vanVillage}</option>}
            </select>
          )}
          {chip === 'uniform' && a.uniform.items.length > 0 && (
            <select value={uni} onChange={(e) => pickUni(e.target.value)} className="w-full mb-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]">
              <option value="">— Choose a uniform item —</option>
              {a.uniform.items.map((it) => <option key={it.name} value={it.name}>{it.name} — ₹{it.price}</option>)}
            </select>
          )}
          {chip && (
            <div className="flex gap-2">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Fee name" className="flex-1 py-1.5 text-[13px]" />
              <Input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" className="w-24 py-1.5 text-right tabular-nums text-[13px]" />
              <Button size="sm" kind="primary" onClick={submit} disabled={adding === `${kid.id}-${chip}`}>{adding === `${kid.id}-${chip}` ? '…' : 'Add'}</Button>
            </div>
          )}
          <div className="flex justify-end mt-2"><button onClick={() => { reset(); setOpen(false); }} className="text-[11.5px] text-slate-400 hover:text-slate-600">Cancel</button></div>
        </div>
      )}
    </div>
  );
}

// Per-child "Request concession" — waive one or more heads (needs admin approval
// before it reduces the balance), mirroring the single-student flow.
function ConcessionPanel({ kid, busy, onSubmit }: {
  kid: Kid; busy: boolean;
  onSubmit: (items: { feeTypeKey: string; amount: number }[], reason: string) => Promise<boolean>;
}) {
  const heads = useMemo(() => {
    const m = new Map<string, { key: string; name: string; balance: number }>();
    for (const c of kid.charges) {
      const h = m.get(c.headKey) || { key: c.headKey, name: c.headName, balance: 0 };
      h.balance += c.balance; m.set(c.headKey, h);
    }
    return [...m.values()];
  }, [kid]);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ key: string; amount: string }[]>([{ key: '', amount: '' }]);
  const [reason, setReason] = useState('');
  const setRow = (i: number, patch: Partial<{ key: string; amount: string }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { key: heads[0]?.key || '', amount: '' }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  const reset = () => { setRows([{ key: '', amount: '' }]); setReason(''); };
  const total = rows.reduce((t, r) => t + (Math.round(Number(r.amount)) || 0), 0);
  if (!heads.length) return null;

  const submit = async () => {
    const items = rows.filter((r) => r.key && Number(r.amount) > 0).map((r) => ({ feeTypeKey: r.key, amount: Math.round(Number(r.amount)) }));
    if (!items.length || !reason.trim()) return;
    const ok = await onSubmit(items, reason.trim());
    if (ok) { reset(); setOpen(false); }
  };

  return (
    <div className="px-2 pb-2">
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-info-300 hover:text-info-700 hover:bg-info-50/40 py-2 text-[12.5px] font-semibold">
          <Icon name="BadgePercent" size={14} /> Request a concession (needs approval)
        </button>
      ) : (
        <div className="rounded-xl border border-info-100 bg-info-50/40 p-3 space-y-2">
          <div className="grid grid-cols-[1fr_96px_28px] gap-2 text-[10px] uppercase tracking-wide text-slate-400 font-semibold px-0.5">
            <span>Fee head</span><span className="text-right">Amount ₹</span><span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_96px_28px] gap-2 items-center">
              <select value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12.5px]">
                <option value="">— Fee head —</option>
                {heads.map((h) => <option key={h.key} value={h.key}>{h.name} · bal {feeMoney(h.balance)}</option>)}
              </select>
              <Input value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value.replace(/[^\d]/g, '') })} placeholder="0" className="text-right tabular-nums py-1.5 text-[12.5px]" />
              <button onClick={() => removeRow(i)} disabled={rows.length === 1} className="text-slate-300 hover:text-danger-600 disabled:opacity-30 p-1 justify-self-center" title="Remove"><Icon name="X" size={15} /></button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button onClick={addRow} className="text-[11.5px] font-semibold text-info-700 hover:text-info-800 inline-flex items-center gap-1"><Icon name="Plus" size={13} /> Add head</button>
            {total > 0 && <span className="text-[11.5px] font-semibold text-slate-600 tabular-nums">Total {feeMoney(total)}</span>}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (sibling discount / staff ward / hardship…)" className="py-1.5 text-[12.5px]" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { reset(); setOpen(false); }} className="text-[11.5px] text-slate-400 hover:text-slate-600">Cancel</button>
            <Button size="sm" kind="primary" onClick={submit} disabled={busy || total <= 0 || !reason.trim()}>{busy ? 'Submitting…' : 'Submit for approval'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const PAY_MODES = [
  { v: 'CASH', label: 'Cash', icon: 'Banknote' },
  { v: 'UPI', label: 'UPI', icon: 'Smartphone' },
  { v: 'CARD', label: 'Card', icon: 'CreditCard' },
  { v: 'BANK', label: 'Bank', icon: 'Building2' },
  { v: 'CHEQUE', label: 'Cheque', icon: 'ScrollText' },
] as const;
const KID_COLORS = ['#7C3AED', '#1F8A4C', '#B7770A', '#1C77C3', '#C7322E'];

export function MultiCollectDrawer({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [family, setFamily] = useState<Family | null>(null);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<string[]>([]);           // child id order (draggable)
  const [amounts, setAmounts] = useState<Record<string, number>>({}); // `${sid}:${chargeId}` -> amount
  const [received, setReceived] = useState('');
  const [method, setMethod] = useState('');
  const [splitOpen, setSplitOpen] = useState(false);
  const [splits, setSplits] = useState<Record<string, string>>({}); // mode -> amount typed (family total)
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sendWa, setSendWa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; receiptNo: string; id: string; total: number; payLabel: string; allocations: { label: string; amount: number }[] }[] | null>(null);
  const brand = useBranding();
  const dragId = useRef<string | null>(null);

  const [adding, setAdding] = useState('');
  const [concBusy, setConcBusy] = useState('');                  // kid id being submitted
  const [concMsg, setConcMsg] = useState<Record<string, string>>({}); // kid id -> confirmation

  useEffect(() => {
    fetch(`/api/fees/siblings?studentId=${encodeURIComponent(studentId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d: Family) => { setFamily(d); setOrder(d.students.map((s) => s.id)); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [studentId]);

  // Reload the family after adding a fee, keeping the current child order + amounts.
  const reloadFamily = async () => {
    const r = await fetch(`/api/fees/siblings?studentId=${encodeURIComponent(studentId)}`);
    if (!r.ok) return;
    const d: Family = await r.json();
    setFamily(d);
    setOrder((prev) => { const ids = d.students.map((s) => s.id); const kept = prev.filter((id) => ids.includes(id)); return [...kept, ...ids.filter((id) => !kept.includes(id))]; });
  };

  // Add a one-off fee (Van / Uniform / ID card / Old fee) to one child.
  const addCharge = async (kidId: string, feeTypeId: string | null | undefined, amount: number, label: string, opKey: string, append = false, village?: string) => {
    if (!feeTypeId) { setError('That fee head isn’t set up in Fee setup.'); return; }
    if (amount <= 0) { setError('Enter an amount greater than 0.'); return; }
    setAdding(opKey); setError('');
    try {
      const r = await fetch(`/api/fees/accounts/${kidId}/charge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeTypeId, amount, label, append, village }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not add');
      await reloadFamily();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
    finally { setAdding(''); }
  };

  // Request a concession for one child (one or more heads, shared reason). Like the
  // single flow it needs admin approval, so it doesn't reduce the amount collected now.
  const addConcession = async (kidId: string, items: { feeTypeKey: string; amount: number }[], reason: string): Promise<boolean> => {
    setConcBusy(kidId); setError('');
    try {
      const r = await fetch('/api/fees/concessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: kidId, items, reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not request concession');
      const total = items.reduce((t, i) => t + i.amount, 0);
      setConcMsg((m) => ({ ...m, [kidId]: `Concession ${feeMoney(total)} requested — pending admin approval.` }));
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not request concession'); return false; }
    finally { setConcBusy(''); }
  };

  const kidsById = useMemo(() => Object.fromEntries((family?.students || []).map((s) => [s.id, s])), [family]);
  const orderedKids = order.map((id) => kidsById[id]).filter(Boolean) as Kid[];
  const rank = (headKey: string) => { const i = (family?.priority || []).indexOf(headKey); return i < 0 ? 999 : i; };
  const sortedCharges = (k: Kid) => [...k.charges].sort((a, b) =>
    (isTuition(a.headKey, a.headName) ? 1 : 0) - (isTuition(b.headKey, b.headName) ? 1 : 0) ||
    rank(a.headKey) - rank(b.headKey) || (a.dueDate || '').localeCompare(b.dueDate || ''));

  const key = (sid: string, cid: string) => `${sid}:${cid}`;
  const kidTotal = (k: Kid) => k.charges.reduce((t, c) => t + (amounts[key(k.id, c.chargeId)] || 0), 0);
  const grand = orderedKids.reduce((t, k) => t + kidTotal(k), 0);
  const totalOutstanding = orderedKids.reduce((t, k) => t + k.outstanding, 0);

  const parseAmt = (s: string) => Math.max(0, Math.round(Number(String(s).replace(/[^\d]/g, '')) || 0));

  // Family-level split tender (e.g. UPI + Cash for the whole family). The per-mode
  // amounts must add up to what's being collected; on record they're split across
  // each child's payment proportionally.
  const splitTenders = PAY_MODES.map((m) => ({ method: m.v, amount: parseAmt(splits[m.v] || '') })).filter((t) => t.amount > 0);
  const splitSum = splitTenders.reduce((t, x) => t + x.amount, 0);

  // Tuition / School fee is always paid LAST (across every child), after all the
  // other priority fees are cleared for all children.
  const isTuition = (headKey: string, headName: string) => headKey === 'tuition' || /tuition|school\s*fee/i.test(headName);

  // Global allocation order: priority fees (by Fee-setup order) across ALL children
  // first, then Tuition/School fee for all children. The draggable child order is
  // the tie-breaker within the same fee head, then due date.
  const allChargesOrdered = () => {
    const list: { sid: string; c: Charge; tuition: number; rank: number; ki: number }[] = [];
    orderedKids.forEach((k, ki) => k.charges.forEach((c) =>
      list.push({ sid: k.id, c, ki, tuition: isTuition(c.headKey, c.headName) ? 1 : 0, rank: rank(c.headKey) })));
    list.sort((a, b) =>
      a.tuition - b.tuition ||                                   // tuition/school fee last
      a.rank - b.rank ||                                         // fee-head priority (Fee setup)
      a.ki - b.ki ||                                             // child order (draggable)
      (a.c.dueDate || '').localeCompare(b.c.dueDate || ''));     // earliest installment first
    return list;
  };

  const autoAllocate = (amt?: number) => {
    let left = amt != null ? amt : parseAmt(received);
    const next: Record<string, number> = {};
    for (const { sid, c } of allChargesOrdered()) {
      if (left <= 0) break;
      const take = Math.min(c.balance, left);
      if (take > 0) { next[key(sid, c.chargeId)] = take; left -= take; }
    }
    setAmounts(next);
  };
  const clearAll = () => { setAmounts({}); setReceived(''); };
  const fillAll = () => { setReceived(String(totalOutstanding)); autoAllocate(totalOutstanding); };

  const setCharge = (sid: string, cid: string, v: number, bal: number) =>
    setAmounts((a) => ({ ...a, [key(sid, cid)]: Math.min(Math.max(0, Math.round(v)), bal) }));

  // drag reorder
  const onDragStart = (id: string) => { dragId.current = id; };
  const onDropOn = (id: string) => {
    const from = dragId.current; dragId.current = null;
    if (!from || from === id) return;
    setOrder((o) => { const a = [...o]; const fi = a.indexOf(from), ti = a.indexOf(id); a.splice(fi, 1); a.splice(ti, 0, from); return a; });
  };
  const move = (id: string, dir: -1 | 1) => setOrder((o) => {
    const a = [...o]; const i = a.indexOf(id); const j = i + dir; if (j < 0 || j >= a.length) return o;
    [a[i], a[j]] = [a[j], a[i]]; return a;
  });

  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (grand <= 0) throw new Error('Enter an amount received, then Auto-allocate — or type amounts against fees.');
      if (!date) throw new Error('Select a payment date.');
      const useSplit = splitOpen && splitTenders.length > 0;
      if (useSplit) {
        if (splitTenders.length < 2) throw new Error('A split needs at least two payment modes — otherwise just pick one mode.');
        if (splitSum !== grand) throw new Error(`Split amounts (${feeMoney(splitSum)}) must add up to what you're collecting (${feeMoney(grand)}).`);
      } else if (!method) {
        throw new Error('Select a payment mode.');
      }
      // Mode pools for the family split — filled child by child so each child's
      // payment tenders sum exactly to that child's total (no rounding drift).
      const pool: Record<string, number> | null = useSplit ? Object.fromEntries(splitTenders.map((t) => [t.method, t.amount])) : null;

      const results: NonNullable<typeof done> = [];
      for (const k of orderedKids) {
        const allocations = k.charges
          .map((c) => ({ chargeId: c.chargeId, amount: amounts[key(k.id, c.chargeId)] || 0, label: c.label }))
          .filter((a) => a.amount > 0);
        if (!allocations.length) continue;
        const childTotal = allocations.reduce((t, a) => t + a.amount, 0);

        const body: any = { studentId: k.id, note, date, sendWhatsApp: sendWa, allocations: allocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount })) };
        if (useSplit && pool) {
          const ts: { method: string; amount: number }[] = [];
          let need = childTotal;
          for (const m of PAY_MODES) { if (need <= 0) break; const avail = pool[m.v] || 0; if (avail <= 0) continue; const take = Math.min(need, avail); ts.push({ method: m.v, amount: take }); pool[m.v] -= take; need -= take; }
          if (ts.length > 1) body.tenders = ts; else if (ts.length === 1) body.method = ts[0].method;
        } else {
          body.method = method;
        }

        const res = await fetch('/api/fees/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${k.name}: ${data.error || `Failed (${res.status})`}`);
        const payLabel = body.tenders
          ? body.tenders.map((t: any) => `${PAY_METHOD_LABEL[t.method as keyof typeof PAY_METHOD_LABEL] || t.method} ₹${feeMoney(t.amount).slice(1)}`).join(' · ')
          : (PAY_METHOD_LABEL[body.method as keyof typeof PAY_METHOD_LABEL] || body.method);
        results.push({ name: k.name, receiptNo: data.receiptNo, id: data.id, total: childTotal, payLabel, allocations });
      }
      if (!results.length) throw new Error('Nothing to collect — allocate an amount first.');
      setDone(results); // parent refresh happens when the operator taps Done (onDone)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to record payments'); }
    finally { setBusy(false); }
  };

  const printAll = () => {
    if (!done || !family) return;
    const esc = (t: string) => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rup = (n: number) => '₹' + feeMoney(n).slice(1);
    const dt = date;
    // Uniform items print as short codes (e.g. "School Uniform" → "SU"), like the single flow.
    const shortName = (label: string) => { const t = label.replace(/^\s*uniform\s*[—\-:]\s*/i, '').trim(); const w = t.split(/\s+/).filter(Boolean); return w.length > 1 ? w.map((x) => x[0]).join('').toUpperCase() : t.slice(0, 4).toUpperCase(); };
    const sum = (arr: { amount: number }[]) => arr.reduce((t, a) => t + a.amount, 0);
    // Per child: a Fee Receipt (school fee etc., with school name) AND a separate
    // Uniform Receipt (uniform items, short codes, no school name) — same as single collect.
    const slips: string[] = [];
    done.forEach((r) => {
      const kid = kidsById[order.find((id) => kidsById[id]?.name === r.name) || ''] || null;
      const cls = kid ? shortClass(kid.className) : '';
      const meta = `<b>${esc(r.name)}</b> · ${esc(cls || '—')}<br>${esc(r.receiptNo)} · ${dt} · ${esc(r.payLabel)}`;
      const feeAl = r.allocations.filter((a) => !/uniform/i.test(a.label) && a.amount > 0);
      const uniAl = r.allocations.filter((a) => /uniform/i.test(a.label) && a.amount > 0);
      if (feeAl.length) slips.push(`<div class="slip">
        <div class="sch">${esc(brand.schoolName)}</div><div class="ttl">Fee Receipt</div>
        <div class="meta">${meta}</div>
        <table><thead><tr><th>Item</th><th class="r">Amount Paid</th></tr></thead>
          <tbody>${feeAl.map((a) => `<tr><td>${esc(a.label)}</td><td class="r b">${rup(a.amount)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total paid</td><td class="r">${rup(sum(feeAl))}</td></tr></tfoot></table>
        <div class="foot">Thank you.</div></div>`);
      if (uniAl.length) slips.push(`<div class="slip">
        <div class="ttl big">Uniform Receipt</div>
        <div class="meta">${meta}</div>
        <table><thead><tr><th>Item</th><th class="r">Amount Paid</th></tr></thead>
          <tbody>${uniAl.map((a) => `<tr><td>${esc(shortName(a.label))}</td><td class="r b">${rup(a.amount)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total paid</td><td class="r">${rup(sum(uniAl))}</td></tr></tfoot></table>
        <div class="foot">Thank you.</div></div>`);
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipts</title><style>
      @page{size:80mm auto;margin:5mm}*{box-sizing:border-box}
      body{font-family:Arial,sans-serif;color:#111;margin:0;width:72mm}
      .slip{padding-bottom:6px}.sch{text-align:center;font-weight:700;font-size:13px;text-transform:uppercase}
      .ttl{text-align:center;font-size:10px;color:#555;margin:1px 0 6px;text-transform:uppercase;letter-spacing:1px}
      .ttl.big{font-size:13px;font-weight:700;color:#111}
      .meta{font-size:11px;line-height:1.5;border-top:1px dashed #999;border-bottom:1px dashed #999;padding:5px 0;margin-bottom:5px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{text-align:left;font-size:9px;text-transform:uppercase;color:#666;border-bottom:1px solid #000;padding:2px 0}
      td{padding:3px 0;border-bottom:1px dotted #ccc}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}td.b{font-weight:700}
      tfoot td{border-top:1px solid #000;font-weight:700;padding-top:5px}.foot{margin-top:8px;font-size:10px;text-align:center;color:#555}
    </style></head><body><div class="stage"></div><script>
      var SLIPS=${JSON.stringify(slips)};var st=document.querySelector('.stage');var i=0;
      function step(){if(i>=SLIPS.length){setTimeout(function(){try{window.close();}catch(e){}},300);return;}st.innerHTML=SLIPS[i];i++;window.focus();window.print();}
      window.onafterprint=function(){setTimeout(step,500);};window.onload=function(){if(SLIPS.length)step();};
    </script></body></html>`;
    const w = window.open('', '_blank'); if (!w) { setError('Allow pop-ups to print.'); return; } w.document.write(html); w.document.close();
  };

  // ---- done modal ----
  if (done) {
    const total = done.reduce((t, r) => t + r.total, 0);
    return (
      <Modal open onClose={onDone} title="Payments recorded" width={460}
        footer={<div className="flex justify-end gap-2"><Button onClick={onDone}>Done</Button>
          <Button kind="primary" icon="Printer" onClick={printAll}>Print all receipts</Button></div>}>
        <div className="text-center py-1">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={26} /></div>
          <p className="text-sm text-slate-600">Collected <span className="font-semibold text-slate-900">{feeMoney(total)}</span> across {done.length} child{done.length === 1 ? '' : 'ren'}.</p>
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 divide-y divide-slate-100">
          {done.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div><div className="font-medium text-slate-800">{r.name}</div><div className="text-[11px] font-mono text-slate-400">{r.receiptNo}</div></div>
              <div className="font-semibold tabular-nums text-slate-900">{feeMoney(r.total)}</div>
            </div>
          ))}
        </div>
        {sendWa && <p className="text-xs text-slate-500 mt-2 text-center">Receipts sent to the parent on WhatsApp (where enabled).</p>}
      </Modal>
    );
  }

  if (!family) {
    return (
      <Drawer open onClose={onClose} title="Multi Collect" width={1120}>
        {error ? <EmptyState icon="AlertCircle" title="Couldn't load" body={error} />
          : <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={72} />)}</div>}
      </Drawer>
    );
  }

  const dues = totalOutstanding - grand;

  return (
    <Drawer open onClose={onClose} title="Multi Collect — family payment"
      subtitle={`${family.parent.name}${family.parent.phone ? ' · ' + family.parent.phone : ''} · ${orderedKids.length} children`} width={1160}
      footer={
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="lg:mr-auto">
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-slate-400 font-semibold">Collecting now</div>
            <div className="font-display text-2xl font-extrabold tabular-nums text-purple-600 leading-none mt-0.5">{feeMoney(grand)}</div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-slate-400 font-semibold">Payment mode <span className="text-danger-500">*</span></div>
              <button type="button" onClick={() => setSplitOpen((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${splitOpen ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                title="Split the family total across two or more modes (e.g. UPI + Cash)">
                <Icon name="Split" size={12} /> {splitOpen ? 'Single mode' : 'Split'}
              </button>
            </div>
            {!splitOpen ? (
              <div className="flex flex-wrap gap-1.5">
                {PAY_MODES.map((m) => (
                  <button key={m.v} onClick={() => setMethod(m.v)} title={m.label}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-2.5 py-1.5 text-[10px] font-semibold min-w-[52px] transition-colors ${method === m.v ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <Icon name={m.icon as any} size={16} />{m.label}
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap gap-2">
                  {PAY_MODES.map((m) => (
                    <label key={m.v} title={m.label}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${parseAmt(splits[m.v] || '') > 0 ? 'border-purple-400 bg-purple-50' : 'border-slate-200'}`}>
                      <Icon name={m.icon as any} size={16} className="text-slate-500" />
                      <span className="text-[12px] font-semibold text-slate-600 w-10">{m.label}</span>
                      <input inputMode="numeric" placeholder="0" value={splits[m.v] ?? ''}
                        onChange={(e) => setSplits((s) => ({ ...s, [m.v]: e.target.value.replace(/[^\d]/g, '') }))}
                        className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400" />
                    </label>
                  ))}
                </div>
                <div className={`mt-1 text-[10.5px] font-semibold tabular-nums ${splitSum === grand ? 'text-success-600' : 'text-danger-600'}`}>
                  Split {feeMoney(splitSum)} / {feeMoney(grand)}{splitSum !== grand ? ` · ${splitSum > grand ? 'over by' : 'short by'} ${feeMoney(Math.abs(grand - splitSum))}` : ' ✓'}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] uppercase tracking-[0.06em] text-slate-400 font-semibold">Date <span className="text-danger-500">*</span></label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full lg:w-40" />
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose} className="flex-1 lg:flex-none">Close</Button>
            <Button kind="primary" icon="Check" onClick={submit} disabled={busy || grand <= 0} className="flex-1 lg:flex-none">{busy ? 'Saving…' : `Record ${orderedKids.filter((k) => kidTotal(k) > 0).length} payment(s)`}</Button>
          </div>
        </div>
      }>
      {error && <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700 flex items-start gap-2"><Icon name="AlertCircle" size={16} className="mt-0.5 flex-shrink-0" />{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* children */}
        <div className="space-y-4">
          <p className="text-[13px] text-slate-500">Auto-allocate clears the <b>priority fees for all children first</b> (in Fee-setup order), and pays <b>Tuition / School fee last</b>. Drag the <Icon name="GripVertical" size={13} className="inline align-middle text-slate-400" /> handle to set which child is filled first when fees tie.</p>
          {orderedKids.map((k, idx) => {
            const color = KID_COLORS[idx % KID_COLORS.length];
            const sub = kidTotal(k);
            return (
              <div key={k.id} draggable onDragStart={() => onDragStart(k.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropOn(k.id)}
                className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                  <span className="cursor-grab text-slate-300 hover:text-slate-500" title="Drag to reorder"><Icon name="GripVertical" size={18} /></span>
                  <span className="w-7 h-7 rounded-lg grid place-items-center text-white text-[11px] font-bold flex-shrink-0" style={{ background: color }}>{idx + 1}</span>
                  <div className="min-w-0"><div className="font-semibold text-slate-900 text-sm truncate">{k.name}</div><div className="text-xs text-slate-500">{shortClass(k.className)} · outstanding {feeMoney(k.outstanding)}</div></div>
                  <div className="ml-auto flex items-center gap-2">
                    <div className="text-right"><div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Collecting</div><div className="font-bold tabular-nums text-purple-600">{feeMoney(sub)}</div></div>
                    <div className="flex flex-col text-slate-300">
                      <button onClick={() => move(k.id, -1)} disabled={idx === 0} className="hover:text-purple-600 disabled:opacity-30 leading-none"><Icon name="ChevronUp" size={15} /></button>
                      <button onClick={() => move(k.id, 1)} disabled={idx === orderedKids.length - 1} className="hover:text-purple-600 disabled:opacity-30 leading-none"><Icon name="ChevronDown" size={15} /></button>
                    </div>
                  </div>
                </div>
                {k.charges.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-slate-400 text-center">All fees cleared 🎉</div>
                ) : (
                  <div className="p-2">
                    {sortedCharges(k).map((c) => {
                      const val = amounts[key(k.id, c.chargeId)] || 0;
                      return (
                        <div key={c.chargeId} className={`flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-lg ${val > 0 ? 'bg-purple-50/40' : ''}`}>
                          <div className="flex-1 min-w-[130px]"><div className="text-[13.5px] text-slate-800">{c.label}</div><div className="text-[11.5px] text-slate-500">Balance {feeMoney(c.balance)}{c.dueDate ? ` · due ${c.dueDate}` : ''}</div></div>
                          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[12px]">
                            <button onClick={() => setCharge(k.id, c.chargeId, 0, c.balance)} className={`px-2.5 py-1.5 ${val === 0 ? 'bg-slate-200 text-slate-800 font-semibold' : 'text-slate-400 hover:bg-slate-50'}`}>Skip</button>
                            <button onClick={() => setCharge(k.id, c.chargeId, c.balance, c.balance)} className={`px-2.5 py-1.5 border-l border-slate-200 ${val >= c.balance ? 'bg-success-500 text-white font-semibold' : 'text-slate-400 hover:bg-slate-50'}`}>Full</button>
                          </div>
                          <div className="w-24"><Input type="number" value={val ? String(val) : ''} placeholder="0" onChange={(e) => setCharge(k.id, c.chargeId, Number(e.target.value) || 0, c.balance)} className="text-right tabular-nums py-1.5" /></div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <AddFeePanel kid={k} adding={adding} onAdd={(ft, amount, label, opKey, append, village) => addCharge(k.id, ft, amount, label, opKey, append, village)} />
                <ConcessionPanel kid={k} busy={concBusy === k.id} onSubmit={(items, reason) => addConcession(k.id, items, reason)} />
                {concMsg[k.id] && (
                  <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-info-50 border border-info-100 px-3 py-2 text-[12px] text-info-800">
                    <Icon name="BadgePercent" size={14} className="flex-shrink-0" />{concMsg[k.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* summary + amount received */}
        <aside className="lg:sticky lg:top-2 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">Amount received</div>
            <div className="p-4">
              <div className="flex items-center rounded-xl border-2 border-purple-100 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100 px-3">
                <span className="text-slate-400 font-bold text-lg">₹</span>
                <input inputMode="numeric" value={received} placeholder="0"
                  onChange={(e) => setReceived(e.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') autoAllocate(); }}
                  className="flex-1 min-w-0 bg-transparent py-2.5 text-right text-xl font-extrabold tabular-nums outline-none text-slate-900" />
              </div>
              <button onClick={() => autoAllocate()}
                className="w-full mt-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm py-2.5 flex items-center justify-center gap-2">
                <Icon name="Wand2" size={16} /> Auto-allocate by priority
              </button>
              <div className="flex gap-2 mt-2">
                <button onClick={fillAll} className="flex-1 text-[11.5px] font-semibold text-slate-500 border border-slate-200 rounded-lg py-1.5 hover:border-purple-200 hover:text-purple-700">Full amount</button>
                <button onClick={clearAll} className="flex-1 text-[11.5px] font-semibold text-slate-500 border border-slate-200 rounded-lg py-1.5 hover:border-purple-200 hover:text-purple-700">Clear</button>
              </div>
              {(() => {
                const recv = parseAmt(received);
                if (grand <= 0) return <p className="text-[12px] text-slate-400 mt-2.5">{recv > 0 ? <>Tap <b className="text-purple-600">Auto-allocate</b> to spread {feeMoney(recv)} — other fees for all children first, Tuition last.</> : 'Type what the parent gives, then tap Auto-allocate.'}</p>;
                const rtn = recv > totalOutstanding ? recv - totalOutstanding : 0;
                if (grand >= totalOutstanding) return <p className="text-[12px] text-success-700 font-semibold mt-2.5">Covers all fees{rtn > 0 ? ` · return ${feeMoney(rtn)} to parent` : ' 🎉'}</p>;
                return <p className="text-[12px] text-marigold-700 font-semibold mt-2.5">Collecting {feeMoney(grand)} · {feeMoney(totalOutstanding - grand)} stays as dues.</p>;
              })()}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">Summary</div>
            <div className="px-4 py-1">
              {orderedKids.map((k, i) => (
                <div key={k.id} className="flex items-center justify-between py-2 text-[13px] border-b border-slate-50 last:border-0">
                  <span className="flex items-center gap-2 text-slate-600"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: KID_COLORS[i % KID_COLORS.length] }} /><span className="text-slate-800 font-medium">{k.name.split(' ')[0]}</span></span>
                  <span className="font-semibold tabular-nums">{feeMoney(kidTotal(k))}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 bg-gradient-to-br from-purple-600 to-purple-700 text-white">
              <div className="text-[10.5px] uppercase tracking-wide opacity-80 font-semibold">Collecting now</div>
              <div className="text-2xl font-extrabold tabular-nums">{feeMoney(grand)}</div>
              <div className="text-[11.5px] opacity-90 mt-0.5">of {feeMoney(totalOutstanding)} · {dues > 0 ? `${feeMoney(dues)} left as dues` : 'all cleared'}</div>
            </div>
            <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none border-t border-slate-100">
              <input type="checkbox" checked={sendWa} onChange={(e) => setSendWa(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-purple-600" />
              <span className="text-[13px] text-slate-700 inline-flex items-center gap-1.5"><Icon name="MessageCircle" size={14} className="text-success-600" /> Send each receipt on WhatsApp</span>
            </label>
          </div>
        </aside>
      </div>
    </Drawer>
  );
}
