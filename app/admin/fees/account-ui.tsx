'use client';

// Shared fee-account UI used by both the Collection drawer and the full-page
// student fee view (/admin/fees/student/[id]).

import React, { useState, useEffect, useMemo } from 'react';
import { Button, Input, Select, Field, Drawer, Modal, Skeleton, Avatar, Chip } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { feeMoney, PAY_METHOD_LABEL, type AccountSummary } from '@/lib/fees';
import { VILLAGE_VAN_FEES } from '@/lib/feeStructure';

const VILLAGE_FEE_MAP: Record<string, number> = Object.fromEntries(VILLAGE_VAN_FEES.map((v) => [v.village, v.fee]));

export function shortClass(name: string | null) {
  return name ? name.replace(/\s?STD$/, '') : '—';
}

export function MiniToggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-purple-500' : 'bg-slate-300'}`}>
      <span className={`inline-block h-4.5 w-4.5 h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export interface Account {
  student: { id: string; name: string; className: string | null; section: string | null; guardianName: string; guardianPhone: string; village: string | null };
  assignment: { oldDue: number; concession: number; concessionReason: string | null } | null;
  summary: AccountSummary;
  payments: { id: string; receiptNo: string; method: string; total: number; note: string | null; paidAt: string; voided?: boolean; voidReason?: string | null; allocations: { amount: number; label: string }[] }[];
  concessions: { id: string; feeTypeId: string; feeTypeName: string; amount: number; reason: string; status: string; decisionNote: string | null; decidedAt: string | null; createdAt: string }[];
}

function concessionTone(s: string): 'success' | 'warn' | 'danger' | 'neutral' {
  return s === 'APPROVED' ? 'success' : s === 'PENDING' ? 'warn' : s === 'REJECTED' ? 'danger' : 'neutral';
}

/** The ledger body: student header, grand totals, fee-head table, payment history. */
export function AccountView({ account, canRequestConcession, canVoid, canNotify, onChanged }: { account: Account; canRequestConcession?: boolean; canVoid?: boolean; canNotify?: boolean; onChanged?: () => void }) {
  const s = account.summary;
  const [notifyOpen, setNotifyOpen] = useState(false);

  const cancelPayment = async (id: string, receiptNo: string) => {
    const reason = window.prompt(`Cancel receipt ${receiptNo}? This reverses the payment and restores the balance.\n\nReason (optional):`, '');
    if (reason === null) return; // user dismissed
    const res = await fetch(`/api/fees/payments/${id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Failed to cancel'); return; }
    onChanged?.();
  };
  const totals = [
    { label: 'Total fee', value: s.totalCharged, tone: 'text-slate-900' },
    ...(s.concession > 0 ? [{ label: 'Concession', value: s.concession, tone: 'text-info-700' }] : []),
    { label: 'Paid', value: s.totalPaid, tone: 'text-success-700' },
    { label: 'Balance', value: s.totalBalance, tone: 'text-danger-700' },
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
        <Avatar name={account.student.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900">{account.student.name}</div>
          <div className="text-xs text-slate-500">{account.student.guardianName} · {account.student.guardianPhone}{account.student.village ? ` · ${account.student.village}` : ''}</div>
        </div>
        {canNotify && s.totalBalance > 0 && (
          <Button size="sm" icon="Bell" onClick={() => setNotifyOpen(true)}>Notify parent</Button>
        )}
      </div>
      {notifyOpen && <NotifyParentModal account={account} onClose={() => setNotifyOpen(false)} />}

      <div className={`grid gap-3 ${totals.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        {totals.map((b) => (
          <div key={b.label} className="rounded-lg border border-slate-200 px-3 py-2.5 text-center">
            <div className={`text-base font-bold tabular-nums ${b.tone}`}>{feeMoney(b.value)}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{b.label}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-900 mb-2">Fee heads</div>
        <div className="rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="text-left font-semibold px-3 py-2">Head</th>
                <th className="text-right font-semibold px-3 py-2">Total</th>
                <th className="text-right font-semibold px-3 py-2">Paid</th>
                <th className="text-right font-semibold px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {s.heads.map((h) => (
                <React.Fragment key={h.key}>
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{h.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{feeMoney(h.charged)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-success-700">{feeMoney(h.paid)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{feeMoney(h.balance)}</td>
                  </tr>
                  {h.charges.length > 1 &&
                    h.charges.map((c) => (
                      <tr key={c.id} className="text-xs text-slate-500">
                        <td className="pl-6 pr-3 py-1">
                          {c.label.replace(h.name, '').replace(/^[\s—-]+/, '') || c.label}
                          {c.dueDate && <span className="ml-1 text-slate-400">· due {c.dueDate}</span>}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">{feeMoney(c.amount)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{feeMoney(c.paid)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{feeMoney(c.balance)}</td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-900 mb-2">Payment history</div>
        {account.payments.length === 0 ? (
          <p className="text-sm text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">No payments yet.</p>
        ) : (
          <div className="space-y-2">
            {account.payments.map((p) => (
              <div key={p.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${p.voided ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium font-mono flex items-center gap-2">
                    <span className={p.voided ? 'text-slate-400 line-through' : 'text-slate-900'}>{p.receiptNo}</span>
                    {p.voided && <span className="text-[10px] font-semibold text-danger-700 bg-danger-50 rounded px-1.5 py-0.5">CANCELLED</span>}
                  </div>
                  <div className="text-xs text-slate-500">{new Date(p.paidAt).toLocaleDateString('en-IN')} · {PAY_METHOD_LABEL[p.method as keyof typeof PAY_METHOD_LABEL] || p.method} · {p.voided ? (p.voidReason || 'Reversed') : p.allocations.map((a) => a.label).join(', ')}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-sm font-semibold tabular-nums ${p.voided ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{feeMoney(p.total)}</span>
                  <a href={`/admin/fees/receipt/${p.id}`} target="_blank" className="text-slate-400 hover:text-purple-600 p-1" title="Print receipt">
                    <Icon name="Printer" size={16} />
                  </a>
                  {canVoid && !p.voided && (
                    <button onClick={() => cancelPayment(p.id, p.receiptNo)} className="text-slate-300 hover:text-danger-600 p-1" title="Cancel this payment">
                      <Icon name="Ban" size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConcessionSection account={account} canRequest={!!canRequestConcession} onChanged={onChanged} />
    </div>
  );
}

/* ---------- Notify one parent of their child's balance ---------- */

function defaultReminder(account: Account) {
  const s = account.summary;
  const cls = shortClass(account.student.className);
  const lines = [
    `Dear Parent,`,
    ``,
    `This is a gentle reminder that the pending fee for ${account.student.name} (Class ${cls}) is ${feeMoney(s.totalBalance)}.`,
  ];
  // Per-head breakdown of what is still due.
  const due = s.heads.filter((h) => h.balance > 0);
  if (due.length > 1) {
    lines.push(``, `Breakup:`, ...due.map((h) => `• ${h.name}: ${feeMoney(h.balance)}`));
  }
  lines.push(``, `Kindly clear the dues at the school office at your earliest convenience. Thank you.`);
  return lines.join('\n');
}

export function NotifyParentModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const [title, setTitle] = useState('Fee payment reminder');
  const [body, setBody] = useState(() => defaultReminder(account));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const send = async () => {
    setBusy(true); setError('');
    try {
      if (!title.trim() || !body.trim()) throw new Error('Title and message are required');
      const res = await fetch('/api/circulars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'FEE_REMINDER', feeScope: 'students', studentIds: [account.student.id], title: title.trim(), body: body.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Modal open onClose={onClose} title="Reminder sent" width={440}
        footer={<div className="flex justify-end"><Button kind="primary" onClick={onClose}>Done</Button></div>}>
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={26} /></div>
          <p className="text-sm text-slate-600">Fee reminder delivered to <span className="font-semibold text-slate-900">{account.student.guardianName || account.student.name}</span> in the parent app.</p>
          <p className="text-xs text-slate-400 mt-1">{account.student.guardianPhone || ''}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Notify parent" subtitle={`${account.student.name} · balance ${feeMoney(account.summary.totalBalance)}`} width={560}
      footer={<div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" icon="Send" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send reminder'}</Button>
      </div>}>
      <div className="space-y-4">
        {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}
        <div className="flex items-center gap-2.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
          <Avatar name={account.student.name} size="sm" />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-slate-900">To: {account.student.guardianName || '—'}</div>
            <div className="text-xs text-slate-500">{account.student.guardianPhone || 'no phone on file'} · delivered in the parent app</div>
          </div>
        </div>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Message" hint="The balance is filled in for you — edit freely">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none resize-y" />
        </Field>
        <p className="text-[11px] text-slate-400">Goes only to this student’s parent. SMS delivery can be added later — for now it appears in the parent app’s Circulars.</p>
      </div>
    </Modal>
  );
}

/* ---------- Concession section (list + request) ---------- */

function ConcessionSection({ account, canRequest, onChanged }: { account: Account; canRequest: boolean; onChanged?: () => void }) {
  const heads = account.summary.heads;
  const [open, setOpen] = useState(false);
  const [feeTypeKey, setFeeTypeKey] = useState(heads[0]?.key || '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!feeTypeKey) throw new Error('Pick a fee head');
      if (!(Number(amount) > 0)) throw new Error('Enter an amount');
      if (!reason.trim()) throw new Error('Enter a reason');
      const res = await fetch('/api/fees/concessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: account.student.id, feeTypeKey, amount: Math.round(Number(amount)), reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setOpen(false); setAmount(''); setReason('');
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    await fetch(`/api/fees/concessions/${id}`, { method: 'DELETE' });
    onChanged?.();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-900">Concessions</div>
        {canRequest && !open && <button onClick={() => setOpen(true)} className="text-xs font-medium text-purple-600 hover:text-purple-700 inline-flex items-center gap-1"><Icon name="Plus" size={14} /> Request concession</button>}
      </div>

      {open && (
        <div className="rounded-lg border border-slate-200 p-3 mb-3 space-y-3">
          {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-2 text-xs text-danger-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fee head">
              <Select value={feeTypeKey} onChange={(e) => setFeeTypeKey(e.target.value)}>
                {heads.map((h) => <option key={h.key} value={h.key}>{h.name} · bal {feeMoney(h.balance)}</option>)}
              </Select>
            </Field>
            <Field label="Concession amount (₹)">
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="text-right tabular-nums" />
            </Field>
          </div>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sibling discount / staff ward / hardship…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" kind="primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</Button>
          </div>
          <p className="text-[11px] text-slate-400">Concessions need admin approval before they reduce the balance.</p>
        </div>
      )}

      {account.concessions.length === 0 ? (
        <p className="text-sm text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">No concessions.</p>
      ) : (
        <div className="space-y-2">
          {account.concessions.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">{c.feeTypeName} · {feeMoney(c.amount)}</div>
                <div className="text-xs text-slate-500 truncate">{c.reason}{c.decisionNote ? ` · ${c.decisionNote}` : ''}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Chip tone={concessionTone(c.status)}>{c.status[0] + c.status.slice(1).toLowerCase()}</Chip>
                {canRequest && c.status === 'PENDING' && (
                  <button onClick={() => cancel(c.id)} className="text-slate-300 hover:text-danger-600 p-1" title="Cancel request"><Icon name="Trash2" size={15} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- small shared bits ---------- */

function MiniStat({ label, value, tone = 'text-slate-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}

function SectionCard({ icon, title, badge, right, children }: { icon: string; title: string; badge?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center"><Icon name={icon as any} size={17} /></div>
          <div>
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            {badge && <div className="text-[11px] text-slate-500">{badge}</div>}
          </div>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/* ---------- Collect payment drawer ---------- */

const PAY_MODES = [
  { v: 'CASH', label: 'Cash', icon: 'Banknote' },
  { v: 'UPI', label: 'UPI', icon: 'Smartphone' },
  { v: 'CARD', label: 'Card', icon: 'CreditCard' },
  { v: 'BANK', label: 'Bank', icon: 'Building2' },
  { v: 'CHEQUE', label: 'Cheque', icon: 'ScrollText' },
] as const;

export function CollectDrawer({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const headsOut = useMemo(
    () =>
      account.summary.heads
        .map((h) => ({ key: h.key, name: h.name, balance: h.balance, items: h.charges.filter((c) => c.balance > 0) }))
        .filter((h) => h.items.length > 0),
    [account]
  );
  const allOut = useMemo(() => headsOut.flatMap((h) => h.items), [headsOut]);

  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [method, setMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ receiptNo: string; id: string } | null>(null);

  const total = Object.values(amounts).reduce((t, v) => t + (v || 0), 0);
  const remaining = Math.max(0, account.summary.totalBalance - total);

  const setAmt = (id: string, max: number, v: string | number) =>
    setAmounts((a) => ({ ...a, [id]: Math.max(0, Math.min(max, Math.round(Number(v) || 0))) }));
  const fill = (items: { id: string; balance: number }[]) =>
    setAmounts((a) => ({ ...a, ...Object.fromEntries(items.map((c) => [c.id, c.balance])) }));
  const clearAll = () => setAmounts({});

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const allocations = allOut.filter((c) => (amounts[c.id] || 0) > 0).map((c) => ({ chargeId: c.id, amount: amounts[c.id] }));
      if (allocations.length === 0) throw new Error('Enter an amount to collect');
      const res = await fetch('/api/fees/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: account.student.id, method, note, allocations }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setDone({ receiptNo: data.receiptNo, id: data.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal open onClose={onDone} title="Payment recorded" width={440}
        footer={<div className="flex justify-end gap-2">
          <Button onClick={onDone}>Done</Button>
          <a href={`/admin/fees/receipt/${done.id}`} target="_blank"><Button kind="primary" icon="Printer">Print receipt</Button></a>
        </div>}>
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3">
            <Icon name="Check" size={26} />
          </div>
          <p className="text-sm text-slate-600">Collected <span className="font-semibold text-slate-900">{feeMoney(total)}</span> from {account.student.name}.</p>
          <p className="text-xs text-slate-500 mt-1">Receipt <span className="font-mono">{done.receiptNo}</span></p>
        </div>
      </Modal>
    );
  }

  return (
    <Drawer open onClose={onClose} title="Collect payment" subtitle={`${account.student.name} · ${account.student.id} · ${shortClass(account.student.className)}`} width={720}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Collecting</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{feeMoney(total)}</div>
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button kind="primary" icon="Check" onClick={submit} disabled={busy || total <= 0}>{busy ? 'Saving…' : 'Record payment'}</Button>
          </div>
        </div>
      }>
      {error && <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}

      <div className="grid grid-cols-3 gap-3 mb-5">
        <MiniStat label="Outstanding" value={feeMoney(account.summary.totalBalance)} tone="text-danger-700" />
        <MiniStat label="Collecting now" value={feeMoney(total)} tone="text-purple-700" />
        <MiniStat label="Remaining" value={feeMoney(remaining)} />
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-900">Outstanding fees</div>
        <div className="flex gap-3 text-xs">
          <button onClick={() => fill(allOut)} className="text-purple-600 hover:text-purple-700 font-medium">Pay all dues</button>
          <span className="text-slate-300">·</span>
          <button onClick={clearAll} className="text-slate-500 hover:text-slate-700">Clear</button>
        </div>
      </div>

      {headsOut.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8 border border-dashed border-slate-200 rounded-lg">No outstanding fees — fully paid 🎉</p>
      ) : (
        <div className="space-y-3">
          {headsOut.map((h) => (
            <div key={h.key} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                <div className="text-sm font-medium text-slate-900">{h.name}</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 tabular-nums">Balance {feeMoney(h.balance)}</span>
                  <button onClick={() => fill(h.items)} className="text-xs text-purple-600 hover:text-purple-700 font-medium">Fill</button>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {h.items.map((c) => {
                  const val = amounts[c.id] || 0;
                  const active = val > 0;
                  return (
                    <div key={c.id} className={`flex items-center gap-3 px-4 py-2.5 ${active ? 'bg-purple-50/40' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-800 truncate">{c.label}</div>
                        <div className="text-[11px] text-slate-500">Balance {feeMoney(c.balance)}{c.dueDate ? ` · due ${c.dueDate}` : ''}</div>
                      </div>
                      <button onClick={() => setAmt(c.id, c.balance, c.balance)} className="text-[11px] font-medium text-slate-400 hover:text-purple-600">Full</button>
                      <div className="w-36 flex-shrink-0">
                        <Input type="number" value={val ? String(val) : ''} placeholder="0" onChange={(e) => setAmt(c.id, c.balance, e.target.value)} className="text-right tabular-nums py-2" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <div className="text-sm font-semibold text-slate-900 mb-2">Payment mode</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {PAY_MODES.map((m) => (
            <button key={m.v} onClick={() => setMethod(m.v)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-colors ${method === m.v ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <Icon name={m.icon as any} size={18} />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference / cheque no / remark" />
        </Field>
      </div>
    </Drawer>
  );
}

/* ---------- Assign fee plan drawer (van toggle, uniform, extras) ---------- */

interface AssignOptions {
  student: { id: string; name: string; className: string | null; gender: string; village: string | null };
  van: { suggestedFee: number; villageHasRate: boolean; active: boolean; amount: number; locked: boolean };
  uniform: { items: { key: string; name: string; price: number; qty: number }[]; active: boolean; amount: number; locked: boolean };
  idCard: { fee: number; active: boolean; locked: boolean };
  newAdmission: { fee: number; active: boolean; locked: boolean };
}

export function AssignDrawer({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [opt, setOpt] = useState<AssignOptions | null>(null);
  const [village, setVillage] = useState('');
  const [vanOn, setVanOn] = useState(false);
  const [vanFee, setVanFee] = useState(0);
  const [uniformQty, setUniformQty] = useState<Record<string, number>>({});
  const [idCard, setIdCard] = useState(false);
  const [newAdm, setNewAdm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/fees/accounts/${studentId}/assignment`);
      if (!res.ok) { setError('Failed to load options'); return; }
      const o: AssignOptions = await res.json();
      setOpt(o);
      setVillage(o.student.village || '');
      setVanOn(o.van.active);
      setVanFee(o.van.active ? o.van.amount : o.van.suggestedFee);
      setUniformQty(Object.fromEntries(o.uniform.items.map((i) => [i.key, i.qty])));
      setIdCard(o.idCard.active);
      setNewAdm(o.newAdmission.active);
    })();
  }, [studentId]);

  const uniformTotal = useMemo(
    () => (opt ? opt.uniform.items.reduce((t, i) => t + i.price * (uniformQty[i.key] || 0), 0) : 0),
    [opt, uniformQty]
  );
  const planTotal = (vanOn ? vanFee : 0) + uniformTotal + (idCard && opt ? opt.idCard.fee : 0) + (newAdm && opt ? opt.newAdmission.fee : 0);

  const setQty = (key: string, q: number) => setUniformQty((s) => ({ ...s, [key]: Math.max(0, q) }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/fees/accounts/${studentId}/assignment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          village,
          van: { enabled: vanOn, fee: vanFee },
          uniform: Object.entries(uniformQty).map(([key, qty]) => ({ key, qty })),
          idCard,
          newAdmission: newAdm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title="Edit fee plan" subtitle={opt ? `${opt.student.name} · ${shortClass(opt.student.className)} · ${opt.student.gender === 'F' ? 'Girl' : 'Boy'}` : ''} width={720}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Optional charges</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{feeMoney(planTotal)}</div>
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button kind="primary" icon="Check" onClick={save} disabled={busy || !opt}>{busy ? 'Saving…' : 'Save plan'}</Button>
          </div>
        </div>
      }>
      {!opt ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={64} />)}</div>
      ) : (
        <div className="space-y-5">
          {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}

          {/* Van */}
          <SectionCard icon="Bus" title="Van / transport" badge={vanOn ? 'Charged this student' : 'Not using the van'} right={<MiniToggle on={vanOn} disabled={opt.van.locked} onChange={setVanOn} />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Village" hint="Selecting a village fills the fee">
                <Select value={village} disabled={opt.van.locked}
                  onChange={(e) => {
                    const v = e.target.value;
                    setVillage(v);
                    const fee = VILLAGE_FEE_MAP[v] || 0;
                    if (fee > 0) { setVanFee(fee); setVanOn(true); }
                  }}>
                  <option value="">— No village —</option>
                  {VILLAGE_VAN_FEES.map((v) => (
                    <option key={v.village} value={v.village}>{v.village} — {feeMoney(v.fee)}/yr</option>
                  ))}
                  {village && !(village in VILLAGE_FEE_MAP) && <option value={village}>{village} (no rate)</option>}
                </Select>
              </Field>
              <Field label="Van fee (₹ / year)" hint={opt.van.locked ? 'Paid — locked' : 'Editable'}>
                <Input type="number" value={String(vanFee)} disabled={opt.van.locked || !vanOn} onChange={(e) => setVanFee(Math.max(0, Math.round(Number(e.target.value) || 0)))} className="text-right tabular-nums" />
              </Field>
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Turn the toggle off for children who don’t use the van — the village is still saved for records.</p>
          </SectionCard>

          {/* Uniform */}
          <SectionCard icon="Shirt" title="Uniform items" badge="Priced by class & gender" right={<span className="text-sm font-bold tabular-nums text-slate-900">{feeMoney(uniformTotal)}</span>}>
            {opt.uniform.locked && <div className="text-xs text-warn-700 mb-3 bg-warn-50 rounded-md px-3 py-2">Uniform already has a payment — items are locked.</div>}
            {opt.uniform.items.length === 0 ? (
              <p className="text-xs text-slate-400">No uniform items apply to this class.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {opt.uniform.items.map((it) => {
                  const qty = uniformQty[it.key] || 0;
                  const on = qty > 0;
                  return (
                    <div key={it.key} className={`rounded-lg border p-3 transition-colors ${on ? 'border-purple-400 bg-purple-50/60' : 'border-slate-200'}`}>
                      <label className="flex items-center justify-between gap-2 cursor-pointer">
                        <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                          <input type="checkbox" checked={on} disabled={opt.uniform.locked} onChange={(e) => setQty(it.key, e.target.checked ? 1 : 0)} className="rounded border-slate-300 text-purple-500 focus:ring-purple-500/20" />
                          {it.name}
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums">{feeMoney(it.price)}</span>
                      </label>
                      {on && (
                        <div className="flex items-center justify-between mt-2.5">
                          <div className="inline-flex items-center rounded-md border border-slate-200 overflow-hidden">
                            <button disabled={opt.uniform.locked} onClick={() => setQty(it.key, qty - 1)} className="px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40">−</button>
                            <span className="px-3 text-sm tabular-nums min-w-[2rem] text-center">{qty}</span>
                            <button disabled={opt.uniform.locked} onClick={() => setQty(it.key, qty + 1)} className="px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40">+</button>
                          </div>
                          <span className="text-xs font-semibold tabular-nums text-slate-700">{feeMoney(it.price * qty)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Extras */}
          <SectionCard icon="Plus" title="Other charges">
            <div className="space-y-2">
              {[
                { on: idCard, set: setIdCard, label: 'ID Card', sub: '', fee: opt.idCard.fee, locked: opt.idCard.locked },
                { on: newAdm, set: setNewAdm, label: 'New Admission fee', sub: 'tie + belt + socks', fee: opt.newAdmission.fee, locked: opt.newAdmission.locked },
              ].map((row) => (
                <div key={row.label} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${row.on ? 'border-purple-400 bg-purple-50/60' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-2">
                    <MiniToggle on={row.on} disabled={row.locked} onChange={row.set} />
                    <span className="text-sm font-medium text-slate-900">{row.label}{row.sub && <span className="ml-1 text-xs text-slate-400">{row.sub}</span>}</span>
                  </div>
                  <span className="text-sm tabular-nums text-slate-600">{feeMoney(row.fee)}{row.locked ? ' · locked' : ''}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <p className="text-[11px] text-slate-400">Tuition and the Software / Marks-card fee are assigned automatically by class and aren’t edited here.</p>
        </div>
      )}
    </Drawer>
  );
}
