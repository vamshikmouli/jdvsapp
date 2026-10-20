'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { PageHeader, Button, Card, Chip, EmptyState, Skeleton } from '@/components/Primitives';
import { toast } from '@/lib/toast';
import { feeMoney } from '@/lib/fees';

interface Order {
  id: string;
  ref: string;
  amount: number;
  status: 'CREATED' | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  provider: string;
  utr: string | null;
  studentName: string | null;
  className: string | null;
  paymentId: string | null;
  failReason: string | null;
  createdAt: string;
}

const TONE: Record<Order['status'], 'success' | 'warn' | 'danger' | 'neutral'> = {
  PAID: 'success', PENDING: 'warn', CREATED: 'warn', FAILED: 'danger', EXPIRED: 'neutral',
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function OnlinePaymentsPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/payments/orders', { cache: 'no-store' });
      if (r.status === 403) { setOrders([]); toast.error('You do not have access to online payments.'); return; }
      const d = await r.json();
      setOrders(d.orders || []);
    } catch { setOrders([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: 'verify' | 'reject') {
    if (action === 'reject' && !window.confirm('Mark this payment as failed? The parent will be asked to retry.')) return;
    setBusyId(id);
    try {
      const body = action === 'reject' ? JSON.stringify({ reason: 'Could not match the credit' }) : undefined;
      const r = await fetch(`/api/payments/orders/${id}/${action}`, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Action failed');
      toast.success(action === 'verify' ? 'Payment posted to the fee account.' : 'Payment marked failed.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  const needsAttention = (orders || []).filter((o) => o.status === 'PENDING' || o.status === 'CREATED' || (o.status === 'PAID' && !o.paymentId));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Fees"
        title="Online payments"
        meta="Parents' UPI payments confirm automatically. This screen is for monitoring and for the rare payment that needs a manual check."
        actions={<Button kind="secondary" icon="RefreshCw" onClick={load}>Refresh</Button>}
      />

      {orders === null ? (
        <Card><Skeleton height={160} /></Card>
      ) : orders.length === 0 ? (
        <EmptyState icon="Smartphone" title="No online payments yet" body="Once parents start paying from the app, their payments appear here." />
      ) : (
        <>
          {needsAttention.length > 0 && (
            <Card title={`Needs attention (${needsAttention.length})`}>
              <div className="divide-y divide-slate-100">
                {needsAttention.map((o) => (
                  <Row key={o.id} o={o} busy={busyId === o.id} onAct={act} />
                ))}
              </div>
            </Card>
          )}
          <Card title="Recent online payments">
            <div className="divide-y divide-slate-100">
              {orders.map((o) => (
                <Row key={o.id} o={o} busy={busyId === o.id} onAct={act} compact />
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ o, busy, onAct, compact }: { o: Order; busy: boolean; onAct: (id: string, a: 'verify' | 'reject') => void; compact?: boolean }) {
  const canResolve = o.status === 'PENDING' || o.status === 'CREATED' || (o.status === 'PAID' && !o.paymentId);
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900 truncate">{o.studentName || '—'}</span>
          {o.className && <span className="text-xs text-slate-400">{o.className}</span>}
          <Chip tone={TONE[o.status]}>{o.status === 'PAID' && !o.paymentId ? 'PAID — unposted' : o.status}</Chip>
        </div>
        <div className="text-xs text-slate-400 mt-0.5 truncate">
          {fmtWhen(o.createdAt)} · {o.provider} · {o.ref}
          {o.utr ? ` · UPI ${o.utr}` : ''}
          {o.failReason ? ` · ${o.failReason}` : ''}
        </div>
      </div>
      <div className="font-bold tabular-nums text-slate-900 whitespace-nowrap">{feeMoney(o.amount)}</div>
      {!compact && canResolve && (
        <div className="flex gap-1.5">
          <Button kind="primary" size="sm" disabled={busy} onClick={() => onAct(o.id, 'verify')}>Verify</Button>
          <Button kind="danger" size="sm" disabled={busy} onClick={() => onAct(o.id, 'reject')}>Reject</Button>
        </div>
      )}
    </div>
  );
}
