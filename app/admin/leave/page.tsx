'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Chip, Field, Input, Select, EmptyState, Skeleton } from '@/components/Primitives';
import type { ChipTone } from '@/lib/staffAttendance/display';

interface Leave {
  id: string; type: string; fromDate: string; toDate: string; halfDay: boolean; halfSession: string | null;
  days: number; reason: string | null; status: string; decisionNote: string | null; decidedAt: string | null;
  staff?: { id: string; name: string; designation: string | null };
}

// Full label map (incl. retired CASUAL/OTHER) so old records still render.
const TYPE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid', OTHER: 'Other' };
// Types selectable when applying (CASUAL/OTHER retired).
const SELECTABLE_TYPES = ['EARNED', 'SICK', 'UNPAID'] as const;
function statusTone(s: string): ChipTone {
  return s === 'APPROVED' ? 'success' : s === 'PENDING' ? 'warn' : s === 'REJECTED' ? 'danger' : 'neutral';
}
function fmt(d: string) { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function halfLabel(s: string | null) { return s === 'AFTERNOON' ? 'afternoon' : s === 'MORNING' ? 'morning' : ''; }
function range(l: Leave) {
  const half = l.halfDay ? ` (half${halfLabel(l.halfSession) ? ` · ${halfLabel(l.halfSession)}` : ''})` : '';
  return l.fromDate === l.toDate ? fmt(l.fromDate) + half : `${fmt(l.fromDate)} – ${fmt(l.toDate)}`;
}
function statusLabel(s: string) { return s.charAt(0) + s.slice(1).toLowerCase(); }

// Build a WhatsApp share link so staff can forward a request to management.
// No number = WhatsApp lets them pick the recipient (app on mobile, web on desktop).
function waShareUrl(l: Leave, name: string) {
  const lines = [
    '*Leave Request*',
    `Name: ${name}`,
    `Type: ${TYPE_LABEL[l.type] ?? l.type}`,
    `Date: ${range(l)}`,
    `Days: ${l.days}`,
  ];
  if (l.reason) lines.push(`Reason: ${l.reason}`);
  lines.push(`Status: ${statusLabel(l.status)}`);
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
}

function WhatsAppIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.74-.86-2-.95-.27-.1-.47-.15-.66.15-.2.3-.76.95-.94 1.15-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.53.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.66-1.6-.9-2.18-.24-.57-.48-.5-.66-.5l-.56-.01c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.74-.71 1.98-1.4.24-.68.24-1.27.17-1.4-.07-.12-.27-.2-.56-.34zM12.02 21.5h-.01a9.44 9.44 0 0 1-4.8-1.32l-.35-.2-3.57.93.96-3.48-.23-.36a9.42 9.42 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.46-9.44a9.4 9.4 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.77 6.68c0 5.2-4.24 9.44-9.46 9.44zm8.05-17.5A11.32 11.32 0 0 0 12.01.5C5.74.5.64 5.6.64 11.86c0 2.09.55 4.13 1.6 5.93L.5 23.5l5.85-1.53a11.33 11.33 0 0 0 5.66 1.44h.01c6.27 0 11.37-5.1 11.37-11.36 0-3.04-1.18-5.9-3.32-8.05z" />
    </svg>
  );
}

const emptyForm = { type: 'EARNED', fromDate: '', toDate: '', halfDay: false, halfSession: 'MORNING', reason: '' };

export default function LeavePage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canApply = perms.includes('STAFF_ATTENDANCE_MARK');
  const canApprove = perms.includes('LEAVE_APPROVE');
  const myName = session?.user?.name || 'Staff';

  const [mine, setMine] = useState<Leave[]>([]);
  const [pending, setPending] = useState<Leave[]>([]);
  const [balance, setBalance] = useState<{ year: string; balances: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    const [m, b] = await Promise.all([
      fetch('/api/leave').then((r) => r.json()),
      fetch('/api/leave/balance').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setMine(Array.isArray(m) ? m : []);
    setBalance(b && b.balances ? b : null);
    if (canApprove) {
      const p = await fetch('/api/leave?all=1&status=PENDING').then((r) => r.json());
      setPending(Array.isArray(p) ? p : []);
    }
    setLoading(false);
  }, [canApprove]);
  useEffect(() => { load(); }, [load]);

  const apply = async () => {
    setError(''); setFlash(''); setBusy(true);
    try {
      if (!form.fromDate) throw new Error('Pick a start date.');
      const res = await fetch('/api/leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, toDate: form.toDate || form.fromDate }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not apply.');
      setFlash('Leave request submitted.');
      setForm(emptyForm);
      await load();
    } catch (e: any) { setError(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  const decide = async (id: string, action: 'approve' | 'reject' | 'cancel', force = false) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/leave/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, force }),
      });
      const j = await res.json();
      if (res.status === 409 && action === 'approve' && !force) {
        // Over the quota — let the approver override.
        if (typeof window !== 'undefined' && window.confirm(`${j.error}\n\nApprove anyway (over balance)?`)) {
          return decide(id, 'approve', true);
        }
        return;
      }
      if (!res.ok) throw new Error(j.error || 'Failed');
      await load();
    } catch (e: any) { setError(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  if (!canApply && !canApprove) return <EmptyState icon="Lock" title="Not available" body="Your role can’t use leave." />;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Leave</h1>
        <p className="text-sm text-slate-500">Apply for leave and track approvals.</p>
      </div>

      {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2">{error}</div>}
      {flash && <div className="rounded-md bg-success-50 text-success-700 text-sm px-3 py-2">{flash}</div>}

      {balance && balance.balances.some((b) => !b.unlimited) && (
        <Card title={`My balance · ${balance.year}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {balance.balances.filter((b) => !b.unlimited).map((b) => (
              <div key={b.type} className="rounded-lg border border-slate-100 px-3 py-2">
                <div className="text-xs text-slate-500">{TYPE_LABEL[b.type]}</div>
                <div className="text-lg font-semibold text-slate-900">{b.remaining}<span className="text-sm font-normal text-slate-400"> / {b.entitlement}</span></div>
                <div className="text-[11px] text-slate-400">{b.used} used{b.pending ? ` · ${b.pending} pending` : ''}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {canApprove && (
        <Card title={`Pending approvals${pending.length ? ` (${pending.length})` : ''}`} padded={false}>
          {loading ? <div className="p-4"><Skeleton height={48} /></div> : pending.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400 text-center">No requests waiting.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {pending.map((l) => (
                <div key={l.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{l.staff?.name} <span className="text-xs text-slate-400">· {TYPE_LABEL[l.type]} · {l.days}d</span></div>
                    <div className="text-sm text-slate-500">{range(l)}{l.reason ? ` — ${l.reason}` : ''}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" kind="primary" disabled={busy} onClick={() => decide(l.id, 'approve')}>Approve</Button>
                    <Button size="sm" kind="danger" disabled={busy} onClick={() => decide(l.id, 'reject')}>Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {canApply && (
        <Card title="Apply for leave">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{SELECTABLE_TYPES.map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}</Select></Field>
            <div />
            <Field label="From"><Input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={form.toDate} min={form.fromDate} disabled={form.halfDay} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm mt-2">
            <input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked, toDate: e.target.checked ? form.fromDate : form.toDate })} className="w-4 h-4" />
            <span>Half day (single day)</span>
          </label>
          {form.halfDay && (
            <div className="mt-2">
              <div className="text-sm text-slate-600 mb-1.5">Which session is off?</div>
              <div className="flex gap-2">
                {([['MORNING', 'Morning'], ['AFTERNOON', 'Afternoon']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setForm({ ...form, halfSession: val })}
                    className={`px-3 py-1.5 rounded-md text-sm border ${form.halfSession === val ? 'bg-purple-100 border-purple-300 text-purple-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Reason (optional)"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. medical" /></Field>
          <div className="mt-3"><Button kind="primary" icon="Send" disabled={busy} onClick={apply}>Submit request</Button></div>
        </Card>
      )}

      <Card title="My requests" padded={false}>
        {loading ? <div className="p-4 space-y-2"><Skeleton height={40} /><Skeleton height={40} /></div> : mine.length === 0 ? (
          <EmptyState icon="CalendarOff" title="No leave yet" body="Your leave requests will appear here." />
        ) : (
          <div className="divide-y divide-slate-50">
            {mine.map((l) => (
              <div key={l.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{TYPE_LABEL[l.type]} <span className="text-xs text-slate-400">· {l.days}d</span></div>
                  <div className="text-sm text-slate-500">{range(l)}{l.reason ? ` — ${l.reason}` : ''}{l.decisionNote ? ` · note: ${l.decisionNote}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Chip tone={statusTone(l.status)}>{statusLabel(l.status)}</Chip>
                  <a
                    href={waShareUrl(l, myName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white hover:brightness-95"
                    title="Share this request on WhatsApp"
                  >
                    <WhatsAppIcon /> Share
                  </a>
                  {(l.status === 'PENDING' || l.status === 'APPROVED') && (
                    <Button size="sm" kind="tertiary" disabled={busy} onClick={() => decide(l.id, 'cancel')}>Cancel</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
