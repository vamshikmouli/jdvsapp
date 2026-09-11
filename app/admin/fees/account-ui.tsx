'use client';

// Shared fee-account UI used by both the Collection drawer and the full-page
// student fee view (/admin/fees/student/[id]).

import React, { useState, useEffect, useMemo } from 'react';
import { Button, Input, Select, Field, Drawer, Modal, Skeleton, Avatar, Chip, EmptyState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { feeMoney, PAY_METHOD_LABEL, type AccountSummary } from '@/lib/fees';
import { VILLAGE_VAN_FEES } from '@/lib/feeStructure';
import { useBranding } from '@/components/useBranding';

const VILLAGE_FEE_MAP: Record<string, number> = Object.fromEntries(VILLAGE_VAN_FEES.map((v) => [v.village, v.fee]));

export function shortClass(name: string | null) {
  return name ? name.replace(/\s?STD$/, '') : '—';
}

// Read-only payment-history drawer (the "Eye" drawer) — used by the Collection
// list and the top-bar universal search.
export function PaymentTimeline({ studentId, name, onClose }: { studentId: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/fees/accounts/${studentId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [studentId]);
  const pays = (data?.payments || []) as any[];
  const s = data?.summary;
  const liveCount = pays.filter((p) => !p.voided).length;

  return (
    <Drawer open onClose={onClose} title="Payment history" subtitle={name} width={560}
      footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      {s && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Total fee</div><div className="text-lg font-bold tabular-nums text-slate-900">{feeMoney(s.totalCharged - s.concession)}</div></div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Paid</div><div className="text-lg font-bold tabular-nums text-success-700">{feeMoney(s.totalPaid)}</div></div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Balance</div><div className={`text-lg font-bold tabular-nums ${s.totalBalance > 0 ? 'text-danger-700' : 'text-success-700'}`}>{feeMoney(s.totalBalance)}</div></div>
        </div>
      )}

      <div className="text-sm font-semibold text-slate-900 mb-3">{liveCount} receipt{liveCount === 1 ? '' : 's'}</div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={80} />)}</div>
      ) : pays.length === 0 ? (
        <EmptyState icon="ReceiptText" title="No payments yet" body="Receipts will appear here, newest first, once fees are collected." />
      ) : (
        <div className="relative pl-7">
          <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-slate-200" />
          {pays.map((p) => (
            <div key={p.id} className="relative mb-4 last:mb-0">
              <div className={`absolute -left-[26px] top-3 w-4 h-4 rounded-full ring-4 flex items-center justify-center ${p.voided ? 'bg-slate-300 ring-slate-100' : 'bg-purple-500 ring-purple-100'}`}>
                <Icon name={p.voided ? 'X' : 'Check'} size={9} className="text-white" />
              </div>
              <div className={`rounded-xl border p-3.5 ${p.voided ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`text-lg font-bold tabular-nums leading-none ${p.voided ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{feeMoney(p.total)}</div>
                    <div className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{PAY_METHOD_LABEL[p.method as keyof typeof PAY_METHOD_LABEL] || p.method}</span>
                      <span className="font-mono text-slate-500">{p.receiptNo}</span>
                      {p.voided && <span className="text-danger-600 font-medium">· cancelled</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-slate-700 tabular-nums">{new Date(p.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  </div>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1">
                  {p.allocations.map((a: any, i: number) => (
                    <div key={i} className="flex justify-between gap-3 text-sm">
                      <span className="text-slate-600 truncate">{a.label}</span>
                      <span className="tabular-nums text-slate-500 flex-shrink-0">{feeMoney(a.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
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

export function CollectDrawer({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [opts, setOpts] = useState<any>(null);
  const [years, setYears] = useState<{ id: string; label: string; isActive: boolean }[]>([]);

  // Collection
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [tendered, setTendered] = useState(0);
  const [addOpen, setAddOpen] = useState(true); // left "Add a fee" panel expanded?
  const [addKind, setAddKind] = useState<'van' | 'uniform' | 'idcard' | 'oldfee'>('van'); // active add-fee chip
  const [method, setMethod] = useState(''); // no default — operator must pick
  const [note, setNote] = useState('');
  const [sendWa, setSendWa] = useState(false); // WhatsApp receipt to parent — opt-in, off by default
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  // Add-fee inputs
  const [vanVillage, setVanVillage] = useState('');
  const [vanAmt, setVanAmt] = useState('');
  const [oldYear, setOldYear] = useState('');
  const [oldAmt, setOldAmt] = useState('');
  const [uniItem, setUniItem] = useState('');
  const [uniOther, setUniOther] = useState('');
  const [uniAmt, setUniAmt] = useState('');
  const [idAmt, setIdAmt] = useState('');
  const [allocPriority, setAllocPriority] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<{ receiptNo: string; id: string } | null>(null);
  const brand = useBranding();

  const reloadAccount = async (): Promise<Account | null> => {
    const r = await fetch(`/api/fees/accounts/${studentId}`);
    if (r.ok) { const a = await r.json(); setAccount(a); return a; }
    return null;
  };

  useEffect(() => {
    reloadAccount();
    fetch(`/api/fees/accounts/${studentId}/assignment`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setOpts(d); if (d.student?.village) setVanVillage(d.student.village); if (d.van?.suggestedFee && !d.van.active) setVanAmt(String(d.van.suggestedFee)); if (d.idCard?.fee) setIdAmt(String(d.idCard.fee)); } }).catch(() => {});
    fetch('/api/years').then((r) => (r.ok ? r.json() : { years: [] })).then((d) => {
      const yl = d.years || []; setYears(yl);
      const past = yl.filter((y: any) => !y.isActive);
      setOldYear((past[0] || yl.find((y: any) => y.isActive) || yl[0])?.label || '');
    }).catch(() => {});
    // Collection preferences: auto-allocate priority + the default payment date.
    fetch('/api/settings/collection').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      if (Array.isArray(d.feeAllocPriority)) setAllocPriority(d.feeAllocPriority);
      const mode = d.collectDateMode || 'today';
      if (mode === 'empty') setDate('');
      else if (mode === 'fixed' && d.collectDateFixed) setDate(d.collectDateFixed);
      else setDate(new Date().toISOString().slice(0, 10));
    }).catch(() => {});
  }, [studentId]);

  const headsOut = useMemo(() => (account ? account.summary.heads
    .map((h) => ({ key: h.key, name: h.name, balance: h.balance, items: h.charges.filter((c) => c.balance > 0) }))
    .filter((h) => h.items.length > 0) : []), [account]);
  const allOut = useMemo(() => headsOut.flatMap((h) => h.items), [headsOut]);

  const total = Object.values(amounts).reduce((t, v) => t + (v || 0), 0);
  const toAllocate = tendered - total;
  const remainingBal = Math.max(0, (account?.summary.totalBalance || 0) - total);
  const receipts = (account?.payments || []);

  const setAmt = (id: string, max: number, v: string | number) =>
    setAmounts((a) => ({ ...a, [id]: Math.max(0, Math.min(max, Math.round(Number(v) || 0))) }));
  const fill = (items: { id: string; balance: number }[]) =>
    setAmounts((a) => ({ ...a, ...Object.fromEntries(items.map((c) => [c.id, c.balance])) }));
  const clearAll = () => setAmounts({});
  const putRest = (id: string, balance: number) =>
    setAmounts((a) => ({ ...a, [id]: Math.max(0, Math.min(balance, (a[id] || 0) + (tendered - total))) }));
  // Head priority for auto-allocate. If an order is configured in Settings →
  // Collection, use it (first key = filled first); otherwise the built-in default
  // Old fee → Uniform → Software → Van → other → Tuition (last).
  const headRank = (key: string) => {
    const k = (key || '').toLowerCase();
    if (allocPriority.length) {
      const idx = allocPriority.findIndex((p) => { const pk = (p || '').toLowerCase(); return !!pk && (k === pk || k.startsWith(pk) || k.includes(pk)); });
      return idx === -1 ? allocPriority.length : idx;
    }
    if (k.startsWith('old')) return 0;          // old fee / arrears
    if (k.includes('uniform')) return 1;
    if (k.includes('software')) return 2;
    if (k.includes('van')) return 3;
    if (k.includes('tuition')) return 5;        // always last
    return 4;                                   // ID card, tie/belt, etc.
  };
  const autoAllocateReceived = () => {
    let left = tendered - total;
    if (left <= 0) return;
    const ordered = [...allOut].sort((a, b) => {
      const ra = headRank((a as any).feeTypeKey), rb = headRank((b as any).feeTypeKey);
      if (ra !== rb) return ra - rb;
      const ia = (a as any).installmentNo ?? 0, ib = (b as any).installmentNo ?? 0;
      if (ia !== ib) return ia - ib;
      const ad = (a as any).dueDate || '9999-12-31', bd = (b as any).dueDate || '9999-12-31';
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
    const next = { ...amounts };
    for (const c of ordered) {
      if (left <= 0) break;
      const room = c.balance - (next[c.id] || 0);
      if (room <= 0) continue;
      const take = Math.min(room, left);
      next[c.id] = (next[c.id] || 0) + take;
      left -= take;
    }
    setAmounts(next);
  };

  const addCharge = async (feeTypeId: string | null | undefined, amount: number, label: string | undefined, opKey: string, append = false, village?: string) => {
    if (!feeTypeId) { setError('That fee head isn’t set up in Fee setup.'); return; }
    if (amount <= 0) { setError('Enter an amount greater than 0.'); return; }
    setAdding(opKey); setError(''); setMsg('');
    try {
      const r = await fetch(`/api/fees/accounts/${studentId}/charge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeTypeId, amount, label, append, village }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not add');
      await reloadAccount();
      setMsg('Saved to this student. It now shows under Outstanding fees — collect it now, or Close and collect later.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
    finally { setAdding(''); }
  };
  const addVan = async () => { await addCharge(opts?.van?.feeTypeId, Number(vanAmt) || 0, undefined, 'van', false, vanVillage.trim() || undefined); setVanAmt(''); };
  const addOld = async () => { if (!oldYear) { setError('Pick the year the dues are from.'); return; } await addCharge(opts?.oldFeeTypeId, Number(oldAmt) || 0, `Old dues (${oldYear})`, 'old'); setOldAmt(''); };
  const addUniform = async () => {
    const name = (uniItem === '__other__' ? uniOther : uniItem).trim();
    if (!name) { setError('Choose a uniform item.'); return; }
    // append: allow the same item again (e.g. a second pair of socks) as its own line.
    await addCharge(opts?.uniform?.feeTypeId, Number(uniAmt) || 0, `Uniform — ${name}`, 'uni', true);
    setUniItem(''); setUniOther(''); setUniAmt('');
  };
  const addIdCard = async () => { await addCharge(opts?.idCard?.feeTypeId, Number(idAmt) || 0, 'ID Card', 'id'); };
  const removeCharge = async (chargeId: string, label: string) => {
    if (!window.confirm(`Remove "${label}" from this student? (Only if nothing is paid on it.)`)) return;
    setError(''); setMsg('');
    try {
      const r = await fetch(`/api/fees/accounts/${studentId}/charge?chargeId=${encodeURIComponent(chargeId)}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not remove');
      await reloadAccount();
      setMsg(`Removed "${label}".`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove'); }
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const allocations = allOut.filter((c) => (amounts[c.id] || 0) > 0).map((c) => ({ chargeId: c.id, amount: amounts[c.id] }));
      if (allocations.length === 0) throw new Error('Enter an amount to collect against at least one fee.');
      if (!method) throw new Error('Select a payment mode.');
      if (!date) throw new Error('Select a payment date.');
      const res = await fetch('/api/fees/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, method, note, date, allocations, sendWhatsApp: sendWa }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      // Reload so this new payment is in the account — the confirmation popup's
      // "Print receipts" button prints it on demand (no auto-print).
      await reloadAccount();
      setDone({ receiptNo: data.receiptNo, id: data.id });
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to record payment'); }
    finally { setBusy(false); }
  };

  // Print the receipt for ONE payment (this transaction only) — a Fee receipt (with
  // school name) and/or a Uniform receipt (student details, no school name, short codes).
  // Each is its own print job so a thermal auto-cutter cuts them apart. Reprintable any time.
  const printReceipt = (pay: any) => {
    if (!pay || !account) return;
    const esc = (t: string) => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rup = (n: number) => '₹' + feeMoney(n).slice(1);
    const shortName = (label: string) => {
      const t = label.replace(/^\s*uniform\s*[—\-:]\s*/i, '').trim();
      const words = t.split(/\s+/).filter(Boolean);
      return words.length > 1 ? words.map((w) => w[0]).join('').toUpperCase() : t.slice(0, 4).toUpperCase();
    };
    const method = PAY_METHOD_LABEL[pay.method as keyof typeof PAY_METHOD_LABEL] || pay.method;
    const dt = (pay.paidAt || '').slice(0, 10);
    const stu = `<b>${esc(account.student.name)}</b> · ${esc(shortClass(account.student.className) || '—')}<br>${esc(pay.receiptNo)} · ${dt} · ${esc(method)}`;
    const allocs = ((pay.allocations || []) as { amount: number; label: string }[]).filter((a) => a.amount > 0);
    const feeAl = allocs.filter((a) => !/uniform/i.test(a.label));
    const uniAl = allocs.filter((a) => /uniform/i.test(a.label));
    const body = (arr: { amount: number; label: string }[], map: (l: string) => string) =>
      arr.map((a) => `<tr><td>${esc(map(a.label))}</td><td class="r b">${rup(a.amount)}</td></tr>`).join('');
    const sum = (arr: { amount: number }[]) => arr.reduce((t, a) => t + a.amount, 0);

    const feeSlip = feeAl.length ? `
      <div class="slip">
        <div class="sch">${esc(brand.schoolName)}</div>
        <div class="ttl">Fee Receipt</div>
        <div class="meta">${stu}</div>
        <table>
          <thead><tr><th>Item</th><th class="r">Amount Paid</th></tr></thead>
          <tbody>${body(feeAl, (l) => l)}</tbody>
          <tfoot><tr><td>Total paid</td><td class="r">${rup(sum(feeAl))}</td></tr></tfoot>
        </table>
        <div class="foot">Thank you.</div>
      </div>` : '';

    const uniSlip = uniAl.length ? `
      <div class="slip">
        <div class="ttl big">Uniform Receipt</div>
        <div class="meta">${stu}</div>
        <table>
          <thead><tr><th>Item</th><th class="r">Amount Paid</th></tr></thead>
          <tbody>${body(uniAl, shortName)}</tbody>
          <tfoot><tr><td>Total paid</td><td class="r">${rup(sum(uniAl))}</td></tr></tfoot>
        </table>
        <div class="foot">Thank you.</div>
      </div>` : '';

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>
      @page{ size:80mm auto; margin:5mm } *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;width:72mm}
      .slip{ padding-bottom:6px }
      .sch{text-align:center;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.3px}
      .ttl{text-align:center;font-size:10px;color:#555;margin:1px 0 6px;text-transform:uppercase;letter-spacing:1px}
      .ttl.big{font-size:13px;font-weight:700;color:#111}
      .meta{font-size:11px;line-height:1.5;border-top:1px dashed #999;border-bottom:1px dashed #999;padding:5px 0;margin-bottom:5px}
      .meta b{font-weight:700}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.3px;color:#666;border-bottom:1px solid #000;padding:2px 0}
      td{padding:3px 0;border-bottom:1px dotted #ccc;vertical-align:top}
      td.r,th.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:6px}
      td.b{font-weight:700}
      tfoot td{border-top:1px solid #000;border-bottom:none;font-weight:700;padding-top:5px}
      .foot{margin-top:8px;font-size:10px;text-align:center;color:#555}
    </style></head><body>
      <div class="stage"></div>
      <script>
        // Print each receipt as its OWN job so a thermal auto-cutter cuts between
        // them — the school-fee receipt and the uniform receipt come out separately.
        var SLIPS = ${JSON.stringify([feeSlip, uniSlip].filter(Boolean))};
        var stage = document.querySelector('.stage');
        var i = 0;
        function step() {
          if (i >= SLIPS.length) { setTimeout(function(){ try{ window.close(); }catch(e){} }, 300); return; }
          stage.innerHTML = SLIPS[i]; i++;
          window.focus(); window.print();
        }
        window.onafterprint = function(){ setTimeout(step, 500); };
        window.onload = function(){ if (SLIPS.length) step(); else { stage.innerHTML = '<div class="foot">No fees to show.</div>'; } };
      </script>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { setError('Please allow pop-ups to print the slip.'); return; }
    w.document.write(html); w.document.close();
  };

  const voidReceipt = async (id: string, receiptNo: string) => {
    if (!window.confirm(`Cancel receipt ${receiptNo}? This reverses its payment.`)) return;
    setError(''); setMsg('');
    try {
      const r = await fetch(`/api/fees/payments/${id}/void`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Cancelled from Collect payment' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not cancel');
      await reloadAccount();
      setMsg(`Receipt ${receiptNo} cancelled.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel'); }
  };

  if (done) {
    return (
      <Modal open onClose={onDone} title="Payment recorded" width={440}
        footer={<div className="flex justify-end gap-2">
          <Button onClick={onDone}>Done</Button>
          <Button kind="primary" icon="Printer" onClick={() => { const p = account?.payments.find((x) => x.id === done.id); if (p) printReceipt(p); }}>Print receipts</Button>
        </div>}>
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={26} /></div>
          <p className="text-sm text-slate-600">Collected <span className="font-semibold text-slate-900">{feeMoney(total)}</span> from {account?.student.name}.</p>
          <p className="text-xs text-slate-500 mt-1">Receipt <span className="font-mono">{done.receiptNo}</span> recorded.{sendWa ? ' Sent to parent on WhatsApp.' : ''} Tap <b>Print receipts</b> to print the fee &amp; uniform slips.</p>
        </div>
      </Modal>
    );
  }

  if (!account) {
    return (
      <Drawer open onClose={onClose} title="Collect payment" width={1240}>
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={48} />)}</div>
      </Drawer>
    );
  }

  const sec = 'rounded-xl border border-slate-200 bg-white';
  const secHead = 'px-5 py-3.5 border-b border-slate-100 text-[15px] font-bold font-display text-slate-900 flex items-center gap-2';
  const subHead = 'text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2';
  const s = account.summary;
  const vanOk = Number(vanAmt) > 0, oldOk = Number(oldAmt) > 0;
  const uniName = uniItem === '__other__' ? uniOther.trim() : uniItem;
  const uniOk = !!uniName && Number(uniAmt) > 0;
  const idOk = Number(idAmt) > 0;
  // Van village dropdown — driven by the rates set in Fee setup; falls back to the
  // built-in village list only if none are configured yet.
  const vanRates: { village: string; fee: number }[] = (opts?.van?.rates?.length ? opts.van.rates : VILLAGE_VAN_FEES);
  const vanFeeMap: Record<string, number> = Object.fromEntries(vanRates.map((v) => [v.village, v.fee]));
  // Uniform picker options: the Fee-setup uniform catalogue (priced by matrix for
  // this student) provided by the server, plus "Other" for anything one-off.
  const uniOptions = (opts?.uniform?.items || []) as { key: string; name: string; price: number }[];

  return (
    <Drawer open onClose={onClose} title="Collect payment" subtitle={`${account.student.name} · ${account.student.id} · ${shortClass(account.student.className)}`} width={1240}
      headerRight={
        <div className="hidden md:flex items-center gap-2.5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-right min-w-[104px]">
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-slate-400 font-semibold">Owed</div>
            <div className="font-display text-[21px] font-extrabold tabular-nums text-slate-800 leading-tight">{feeMoney(s.totalCharged - s.concession)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-right min-w-[104px]">
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-slate-400 font-semibold">Paid</div>
            <div className="font-display text-[21px] font-extrabold tabular-nums text-success-600 leading-tight">{feeMoney(s.totalPaid)}</div>
          </div>
          <div className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-2 text-right min-w-[104px]">
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-slate-400 font-semibold">Balance</div>
            <div className={`font-display text-[21px] font-extrabold tabular-nums leading-tight ${s.totalBalance > 0 ? 'text-danger-600' : 'text-success-600'}`}>{feeMoney(s.totalBalance)}</div>
          </div>
        </div>
      }
      footer={
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="lg:mr-auto">
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-slate-400 font-semibold">Collecting now</div>
            <div className="font-display text-2xl font-extrabold tabular-nums text-purple-600 leading-none mt-0.5">{feeMoney(total)}</div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-slate-400 font-semibold mb-1">Payment mode <span className="text-danger-500">*</span></div>
            <div className="flex flex-wrap gap-1.5">
              {PAY_MODES.map((m) => (
                <button key={m.v} onClick={() => setMethod(m.v)} title={m.label}
                  className={`flex flex-col items-center gap-0.5 rounded-xl border px-2.5 py-1.5 text-[10px] font-semibold flex-1 lg:flex-none min-w-[52px] transition-colors ${method === m.v ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  <Icon name={m.icon as any} size={16} />{m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] uppercase tracking-[0.06em] text-slate-400 font-semibold">Date <span className="text-danger-500">*</span></label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full lg:w-40" />
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose} className="flex-1 lg:flex-none">Close</Button>
            <Button kind="primary" icon="Check" onClick={submit} disabled={busy || total <= 0} className="flex-1 lg:flex-none">{busy ? 'Saving…' : 'Record payment'}</Button>
          </div>
        </div>
      }>
      {error && <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700 flex items-start gap-2"><Icon name="AlertCircle" size={16} className="mt-0.5 flex-shrink-0" />{error}</div>}
      {msg && !error && <div className="mb-4 bg-success-50 border border-success-100 rounded-md p-3 text-sm text-success-700">{msg}</div>}


      <div className={addOpen ? 'grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start' : 'space-y-4'}>
        {/* LEFT — Add a fee (chip rail) */}
        {!addOpen ? (
          <button onClick={() => setAddOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 py-2.5 text-sm font-medium">
            <Icon name="Plus" size={16} /> Add a fee (van, uniform, ID card, old fee)
          </button>
        ) : (
        <div className={sec}>
          <div className={secHead + ' justify-between'}>
            <span className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-purple-50 text-purple-600 grid place-items-center"><Icon name="Plus" size={14} /></span> Add a fee</span>
            <button onClick={() => setAddOpen(false)} className="text-slate-400 hover:text-slate-700 inline-flex items-center gap-1 text-xs font-medium" title="Minimize to make Collect bigger">
              <Icon name="Minimize2" size={14} /> Minimize
            </button>
          </div>
          <div className="p-5">
            <p className="text-[13px] text-slate-500 mb-3.5">Give an item or add a due. It appears on the right — mark it <b>Paid</b> or leave it <b>Not received</b>.</p>
            <div className="flex flex-wrap gap-2">
              {([['van', 'Van', 'Bus'], ['uniform', 'Uniform', 'Shirt'], ['idcard', 'ID card', 'CreditCard'], ['oldfee', 'Old fee', 'History']] as const)
                .filter(([k]) => k === 'van' || k === 'oldfee' || (k === 'uniform' && opts?.uniform?.feeTypeId) || (k === 'idcard' && opts?.idCard?.feeTypeId))
                .map(([k, label, icon]) => (
                  <button key={k} onClick={() => setAddKind(k)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors ${addKind === k ? 'border-purple-500 bg-purple-50 text-purple-700 ring-2 ring-purple-100' : 'border-slate-200 text-slate-600 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700'}`}>
                    <Icon name={icon as any} size={15} />{label}
                  </button>
                ))}
            </div>
            <div className="mt-4 pt-4 border-t border-dashed border-slate-200 space-y-2.5">
              {addKind === 'van' && (<>
                <Field label="Village" hint="Picking a village fills the fee">
                  <Select value={vanVillage} onChange={(e) => { const v = e.target.value; setVanVillage(v); const fee = vanFeeMap[v] || 0; if (fee > 0) setVanAmt(String(fee)); }}>
                    <option value="">— Select village —</option>
                    {vanRates.map((vv) => <option key={vv.village} value={vv.village}>{vv.village} — {feeMoney(vv.fee)}/yr</option>)}
                    {vanVillage && !(vanVillage in vanFeeMap) && <option value={vanVillage}>{vanVillage}</option>}
                  </Select>
                </Field>
                <div className="flex items-end gap-2"><div className="flex-1"><Field label="Van fee (₹ / year)"><Input type="number" value={vanAmt} onChange={(e) => setVanAmt(e.target.value)} placeholder="0" className="text-right tabular-nums" /></Field></div><Button icon="Plus" onClick={addVan} disabled={adding === 'van' || !vanOk}>{adding === 'van' ? '…' : 'Add'}</Button></div>
              </>)}
              {addKind === 'oldfee' && (
                <div className="flex items-end gap-2">
                  <div className="flex-1"><Field label="From year"><Select value={oldYear} onChange={(e) => setOldYear(e.target.value)}>{years.length === 0 && <option value="">—</option>}{years.map((y) => <option key={y.id} value={y.label}>{y.label}{y.isActive ? ' (current)' : ''}</option>)}</Select></Field></div>
                  <div className="w-24"><Field label="Amount"><Input type="number" value={oldAmt} onChange={(e) => setOldAmt(e.target.value)} placeholder="0" className="text-right tabular-nums" /></Field></div>
                  <Button icon="Plus" onClick={addOld} disabled={adding === 'old' || !oldOk}>{adding === 'old' ? '…' : 'Add'}</Button>
                </div>
              )}
              {addKind === 'uniform' && opts?.uniform?.feeTypeId && (<>
                <div className="flex items-end gap-2">
                  <div className="flex-1"><Field label="Item">
                    <Select value={uniItem} onChange={(e) => { const v = e.target.value; setUniItem(v); if (v && v !== '__other__') { const it = uniOptions.find((u) => u.name === v); if (it && it.price > 0) setUniAmt(String(it.price)); } }}>
                      <option value="">— Select —</option>
                      {uniOptions.map((it) => <option key={it.key} value={it.name}>{it.name}{it.price ? ` — ${feeMoney(it.price)}` : ''}</option>)}
                      <option value="__other__">Other…</option>
                    </Select>
                  </Field></div>
                  <div className="w-24"><Field label="Amount"><Input type="number" value={uniAmt} onChange={(e) => setUniAmt(e.target.value)} placeholder="0" className="text-right tabular-nums" /></Field></div>
                  <Button icon="Plus" onClick={addUniform} disabled={adding === 'uni' || !uniOk}>{adding === 'uni' ? '…' : 'Add'}</Button>
                </div>
                {uniItem === '__other__' && <Field label="Item name"><Input value={uniOther} onChange={(e) => setUniOther(e.target.value)} placeholder="e.g. Track Suit" /></Field>}
              </>)}
              {addKind === 'idcard' && opts?.idCard?.feeTypeId && (
                <div className="flex items-end gap-2">
                  <div className="flex-1"><Field label="ID card fee (₹)"><Input type="number" value={idAmt} onChange={(e) => setIdAmt(e.target.value)} placeholder="0" className="text-right tabular-nums" /></Field></div>
                  <Button icon="Plus" onClick={addIdCard} disabled={adding === 'id' || !idOk}>{adding === 'id' ? '…' : 'Add'}</Button>
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* RIGHT — Collect */}
        <div className={sec}>
          <div className={secHead + ' justify-between gap-2 flex-wrap'}>
            <span className="flex items-center gap-2 flex-shrink-0"><span className="w-6 h-6 rounded-lg bg-purple-50 text-purple-600 grid place-items-center"><Icon name="IndianRupee" size={14} /></span> Collect payment</span>
            <div className="flex items-center gap-2.5 ml-auto flex-wrap">
              <div className="flex items-center rounded-xl border-[1.5px] border-purple-200 bg-purple-50/50 pl-3 pr-2 py-1.5">
                <span className="text-[10px] uppercase tracking-[0.06em] text-purple-700/80 font-bold mr-2 whitespace-nowrap">Amount received</span>
                <span className="font-display text-base font-bold text-slate-400 mr-0.5">₹</span>
                <input type="number" value={tendered ? String(tendered) : ''} placeholder="0" onChange={(e) => setTendered(Math.max(0, Math.round(Number(e.target.value) || 0)))} className="w-24 bg-transparent outline-none font-display text-lg font-extrabold tabular-nums text-slate-800 text-right" />
              </div>
              {tendered > 0 && (
                <div className="text-right whitespace-nowrap">
                  <div className="text-[9px] uppercase tracking-[0.05em] text-slate-400 font-semibold">{toAllocate > 0 ? 'Left to allocate' : toAllocate === 0 ? 'All allocated' : 'Over by'}</div>
                  <div className={`font-display text-base font-extrabold tabular-nums leading-tight ${toAllocate === 0 ? 'text-success-600' : toAllocate > 0 ? 'text-marigold-700' : 'text-danger-600'}`}>{feeMoney(Math.abs(toAllocate))}</div>
                </div>
              )}
            </div>
          </div>
          <div className="p-5">
            {tendered > 0 && toAllocate > 0 && allOut.length > 0 && (
              <button onClick={autoAllocateReceived} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-purple-500 hover:bg-purple-600 rounded-lg px-3 py-1.5">
                <Icon name="Wand2" size={14} /> Auto-allocate by priority
              </button>
            )}

            <div className="flex items-center justify-between mb-2">
              <div className="text-[15px] font-bold text-slate-900 font-display">Outstanding fees</div>
              <div className="flex gap-3 text-xs">
                <button onClick={() => fill(allOut)} className="text-purple-600 hover:text-purple-700 font-medium">Pay all</button>
                <span className="text-slate-300">·</span>
                <button onClick={clearAll} className="text-slate-500 hover:text-slate-700">Clear</button>
              </div>
            </div>
            {headsOut.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-lg">No dues — add a fee on the left, or fully paid 🎉</p>
            ) : (
              <div className="space-y-2.5 max-h-[46rem] overflow-y-auto pr-1">
                {headsOut.map((h) => {
                  const hasOverdue = h.items.some((c: any) => c.status === 'overdue');
                  const isItems = /uniform|tie|belt|sock|id\s*card|track\s*suit/i.test(h.name);
                  return (
                  <div key={h.key} className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5">
                      <div className="text-[15px] font-bold text-slate-900 font-display">{h.name}</div>
                      {hasOverdue && <span className="text-[10px] font-bold uppercase tracking-[0.04em] px-2 py-0.5 rounded-full bg-danger-50 text-danger-600">Overdue</span>}
                      {isItems && !hasOverdue && <span className="text-[10px] font-bold uppercase tracking-[0.04em] px-2 py-0.5 rounded-full bg-marigold-50 text-marigold-700">Items given</span>}
                      <div className="ml-auto flex items-center gap-3.5"><span className="text-[13px] text-slate-500 tabular-nums font-semibold">{feeMoney(h.balance)}</span><button onClick={() => fill(h.items)} className="text-[13px] text-purple-600 hover:text-purple-700 font-semibold">Fill</button></div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {h.items.map((c) => {
                        const val = amounts[c.id] || 0;
                        const isPaid = val >= c.balance && c.balance > 0;
                        return (
                          <div key={c.id} className={`flex flex-wrap items-center gap-2 px-4 py-3 ${val > 0 ? 'bg-purple-50/40' : ''}`}>
                            <div className="flex-1 min-w-[130px]"><div className="text-[14.5px] text-slate-800 truncate">{c.label}</div><div className="text-[12px] text-slate-500 mt-0.5">Balance {feeMoney(c.balance)}{c.dueDate ? ` · due ${c.dueDate}` : ''}</div></div>
                            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                              {((c as any).paid || 0) === 0 && !/tuition|software|abacus|quick\s*math/i.test(h.name) && <button onClick={() => removeCharge(c.id, c.label)} className="text-slate-300 hover:text-danger-600 flex-shrink-0 p-1" title="Remove this fee (added by mistake)"><Icon name="Trash2" size={15} /></button>}
                              {/* Paid / Not received toggle — Paid collects the full balance now; Not received leaves it as a due. */}
                              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[12px] flex-shrink-0">
                                <button onClick={() => setAmt(c.id, c.balance, 0)} className={`px-2.5 py-2 ${val === 0 ? 'bg-slate-200 text-slate-800 font-semibold' : 'text-slate-400 hover:bg-slate-50'}`} title="Given but not paid — stays a due">Not received</button>
                                <button onClick={() => setAmt(c.id, c.balance, c.balance)} className={`px-2.5 py-2 border-l border-slate-200 ${isPaid ? 'bg-success-500 text-white font-semibold' : 'text-slate-400 hover:bg-slate-50'}`} title="Collect the full amount now">Paid</button>
                              </div>
                              {tendered > 0 && toAllocate > 0 && <button onClick={() => putRest(c.id, c.balance)} className="text-[12px] font-semibold text-purple-600 hover:text-purple-800" title="Put the remaining received amount here">Rest</button>}
                              <div className="w-20 flex-shrink-0"><Input type="number" value={val ? String(val) : ''} placeholder="0" onChange={(e) => setAmt(c.id, c.balance, e.target.value)} className="text-right tabular-nums py-2" title="Or type a partial amount" /></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}

            {/* One-click add for heads that apply to THIS student but aren't on the account yet */}
            {(() => {
              const sug: { key: string; label: string; amount: number; onAdd: () => void }[] = [];
              if (opts?.van?.feeTypeId && !opts.van.active && opts.van.villageHasRate && opts.van.suggestedFee > 0) {
                sug.push({ key: 'van', label: `Van${account.student.village ? ' — ' + account.student.village : ''}`, amount: opts.van.suggestedFee, onAdd: () => addCharge(opts.van.feeTypeId, opts.van.suggestedFee, undefined, 'van', false, account.student.village || undefined) });
              }
              if (opts?.idCard?.feeTypeId && !opts.idCard.active && opts.idCard.fee > 0) {
                sug.push({ key: 'id', label: 'ID Card', amount: opts.idCard.fee, onAdd: () => addCharge(opts.idCard.feeTypeId, opts.idCard.fee, 'ID Card', 'id') });
              }
              if (!sug.length) return null;
              return (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.06em] text-slate-400 font-semibold mb-2">Applies to this student — add if needed</div>
                  <div className="flex flex-wrap gap-2">
                    {sug.map((sg) => (
                      <button key={sg.key} onClick={sg.onAdd} disabled={adding === sg.key}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50">
                        <Icon name="Plus" size={14} /> {sg.label} {feeMoney(sg.amount)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="mt-3">
              <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cheque no / remark" /></Field>
              <label className="mt-3 flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={sendWa} onChange={(e) => setSendWa(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />
                <span className="text-sm text-slate-700 inline-flex items-center gap-1.5"><Icon name="MessageCircle" size={15} className="text-success-600" /> Send WhatsApp receipt to parent</span>
              </label>
              <p className="text-[11px] text-slate-400 mt-2">Choose the <b>payment mode</b> and <b>date</b> in the bar below, then Record.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Payment history — full width */}
      <div className={sec + ' mt-5'}>
        <div className={secHead}><Icon name="ReceiptText" size={16} className="text-purple-500" /> Payment history</div>
        <div className="p-2">
          {receipts.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No receipts yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {receipts.map((p) => (
                <div key={p.id} className={`px-3 py-3 ${p.voided ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-[12.5px] text-slate-500 min-w-0">
                      <span className="tabular-nums whitespace-nowrap">{p.paidAt.slice(0, 10)}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-slate-500 truncate">{p.receiptNo}</span>
                      {p.voided && <span className="text-danger-600 font-medium whitespace-nowrap">(cancelled)</span>}
                    </div>
                    <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                      <span className="font-semibold tabular-nums text-slate-900">{feeMoney(p.total)}</span>
                      {!p.voided && <button onClick={() => printReceipt(p)} className="text-slate-300 hover:text-purple-600 p-0.5" title="Print this receipt"><Icon name="Printer" size={15} /></button>}
                      {!p.voided && <button onClick={() => voidReceipt(p.id, p.receiptNo)} className="text-slate-300 hover:text-danger-600 p-0.5" title="Cancel receipt"><Icon name="X" size={15} /></button>}
                    </div>
                  </div>
                  {(() => {
                    const feeAl = p.allocations.filter((a) => !/uniform/i.test(a.label));
                    const uniAl = p.allocations.filter((a) => /uniform/i.test(a.label));
                    const line = (a: { amount: number; label: string }, i: number, label: string) => (
                      <div key={label + i} className="flex justify-between gap-4 text-[13px]">
                        <span className="text-slate-600 min-w-0 break-words">{label}</span>
                        <span className="tabular-nums text-slate-500 whitespace-nowrap">{feeMoney(a.amount)}</span>
                      </div>
                    );
                    return (
                      <div className="mt-1.5 space-y-1.5">
                        {feeAl.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.06em] text-slate-400 font-semibold mb-0.5">School fee</div>
                            <div className="space-y-0.5">{feeAl.map((a, i) => line(a, i, a.label))}</div>
                          </div>
                        )}
                        {uniAl.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.06em] text-marigold-700 font-semibold mb-0.5">Uniform</div>
                            <div className="space-y-0.5">{uniAl.map((a, i) => line(a, i, a.label.replace(/^\s*uniform\s*[—\-:]\s*/i, '')))}</div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Concessions — full width */}
      <div className={sec + ' mt-5'}>
        <div className="p-4">
          <ConcessionSection account={account} canRequest onChanged={reloadAccount} />
        </div>
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
  oldFees: { label: string; amount: number; locked: boolean }[];
}

const oldFeeLabel = (yearLabel: string) => `Old dues (${yearLabel.trim()})`;

export function AssignDrawer({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [opt, setOpt] = useState<AssignOptions | null>(null);
  const [village, setVillage] = useState('');
  const [vanOn, setVanOn] = useState(false);
  const [vanFee, setVanFee] = useState(0);
  const [uniformQty, setUniformQty] = useState<Record<string, number>>({});
  const [idCard, setIdCard] = useState(false);
  const [newAdm, setNewAdm] = useState(false);
  const [years, setYears] = useState<{ id: string; label: string; isActive: boolean }[]>([]);
  const [oldFeeYear, setOldFeeYear] = useState('');
  const [oldFeeAmount, setOldFeeAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const oldFeeLockedFor = (o: AssignOptions | null, yearLabel: string) =>
    !!o?.oldFees.find((f) => f.label === oldFeeLabel(yearLabel))?.locked;

  useEffect(() => {
    (async () => {
      const [res, yr] = await Promise.all([
        fetch(`/api/fees/accounts/${studentId}/assignment`),
        fetch('/api/years'),
      ]);
      if (!res.ok) { setError('Failed to load options'); return; }
      const o: AssignOptions = await res.json();
      setOpt(o);
      setVillage(o.student.village || '');
      setVanOn(o.van.active);
      setVanFee(o.van.active ? o.van.amount : o.van.suggestedFee);
      setUniformQty(Object.fromEntries(o.uniform.items.map((i) => [i.key, i.qty])));
      setIdCard(o.idCard.active);
      setNewAdm(o.newAdmission.active);

      const yl: { id: string; label: string; isActive: boolean }[] = yr.ok ? (await yr.json()).years || [] : [];
      setYears(yl);
      // Default to the most recent PAST year (dues are usually carried from last year).
      const active = yl.find((y) => y.isActive);
      const past = yl.filter((y) => !y.isActive);
      const defYear = (past[0] || active || yl[0])?.label || '';
      setOldFeeYear(defYear);
      setOldFeeAmount(o.oldFees.find((f) => f.label === oldFeeLabel(defYear))?.amount || 0);
    })();
  }, [studentId]);

  // When the year changes, show that year's existing old-fee amount.
  const pickOldFeeYear = (label: string) => {
    setOldFeeYear(label);
    setOldFeeAmount(opt?.oldFees.find((f) => f.label === oldFeeLabel(label))?.amount || 0);
  };

  const uniformTotal = useMemo(
    () => (opt ? opt.uniform.items.reduce((t, i) => t + i.price * (uniformQty[i.key] || 0), 0) : 0),
    [opt, uniformQty]
  );
  const planTotal = (vanOn ? vanFee : 0) + uniformTotal + (idCard && opt ? opt.idCard.fee : 0) + (newAdm && opt ? opt.newAdmission.fee : 0) + (oldFeeYear ? oldFeeAmount : 0);

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
          oldFee: oldFeeYear ? { yearLabel: oldFeeYear, amount: oldFeeAmount } : null,
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
            {opt.uniform.locked && <div className="text-xs text-warn-700 mb-3 bg-warn-50 rounded-md px-3 py-2">This uniform bundle is already paid, so it can&apos;t be edited here. To sell another item (e.g. a Track Suit), use <b>Quick entry</b> — each item is added as its own receipt.</div>}
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

          {/* Old fee / previous dues */}
          <SectionCard icon="History" title="Old fee / previous dues" badge="Carried forward from a past year">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="From year" hint="Which year these dues are from">
                <Select value={oldFeeYear} onChange={(e) => pickOldFeeYear(e.target.value)} disabled={oldFeeLockedFor(opt, oldFeeYear)}>
                  {years.length === 0 && <option value="">—</option>}
                  {years.map((y) => <option key={y.id} value={y.label}>{y.label}{y.isActive ? ' (current)' : ''}</option>)}
                </Select>
              </Field>
              <Field label="Old fee (₹)" hint={oldFeeLockedFor(opt, oldFeeYear) ? 'Has payments — locked' : 'Carried-forward balance'}>
                <Input type="number" value={String(oldFeeAmount)} disabled={oldFeeLockedFor(opt, oldFeeYear)}
                  onChange={(e) => setOldFeeAmount(Math.max(0, Math.round(Number(e.target.value) || 0)))} className="text-right tabular-nums" />
              </Field>
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Adds an “{oldFeeLabel(oldFeeYear || '…')}” charge. Enter each past year separately by switching the year. Set 0 to remove it. Collect it in the Quick entry or Collection tab.</p>
          </SectionCard>

          <p className="text-[11px] text-slate-400">Tuition and the Software / Marks-card fee are assigned automatically by class and aren’t edited here.</p>
        </div>
      )}
    </Drawer>
  );
}
