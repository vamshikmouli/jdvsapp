'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Chip, Field, Input, Select, EmptyState, Skeleton } from '@/components/Primitives';
import type { ChipTone } from '@/lib/staffAttendance/display';

interface Leave {
  id: string; type: string; fromDate: string; toDate: string; halfDay: boolean;
  days: number; reason: string | null; status: string; decisionNote: string | null; decidedAt: string | null;
  staff?: { id: string; name: string; designation: string | null };
}

const TYPE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid', OTHER: 'Other' };
function statusTone(s: string): ChipTone {
  return s === 'APPROVED' ? 'success' : s === 'PENDING' ? 'warn' : s === 'REJECTED' ? 'danger' : 'neutral';
}
function fmt(d: string) { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function range(l: Leave) { return l.fromDate === l.toDate ? fmt(l.fromDate) + (l.halfDay ? ' (half)' : '') : `${fmt(l.fromDate)} – ${fmt(l.toDate)}`; }

const emptyForm = { type: 'CASUAL', fromDate: '', toDate: '', halfDay: false, reason: '' };

export default function LeavePage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canApply = perms.includes('STAFF_ATTENDANCE_MARK');
  const canApprove = perms.includes('LEAVE_APPROVE');

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
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <div />
            <Field label="From"><Input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={form.toDate} min={form.fromDate} disabled={form.halfDay} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm mt-2">
            <input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked, toDate: e.target.checked ? form.fromDate : form.toDate })} className="w-4 h-4" />
            <span>Half day (single day)</span>
          </label>
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
                  <Chip tone={statusTone(l.status)}>{l.status.charAt(0) + l.status.slice(1).toLowerCase()}</Chip>
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
