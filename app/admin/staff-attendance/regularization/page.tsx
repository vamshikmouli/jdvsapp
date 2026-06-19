'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button, Card, Chip, Modal, Field, Input, Select, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface RegularizationRequest {
  id: string;
  staffId: string;
  staff: { name: string };
  date: string;
  type: 'PUNCH' | 'STATUS';
  punchType?: 'IN' | 'OUT';
  punchTime?: string;
  statusValue?: string;
  reason?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

export default function RegularizationPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('STAFF_ATTENDANCE_MANAGE');

  const [requests, setRequests] = useState<RegularizationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [active, setActive] = useState<RegularizationRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/staff-attendance/regularization?status=${filter}`);
    if (res.ok) setRequests(await res.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  if (!canManage) {
    return <EmptyState icon="Lock" title="Not available" body="You don't have permission to manage regularization requests." />;
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Attendance regularization</h1>
        <p className="text-sm text-slate-500">Staff requests for punch corrections and status changes.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((st) => (
          <button
            key={st}
            onClick={() => setFilter(st)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === st ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {st} {requests.filter((r) => r.status === st).length > 0 && `(${requests.filter((r) => r.status === st).length})`}
          </button>
        ))}
      </div>

      <Card padded={false}>
        {loading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={60} />)}</div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon="CheckCircle2"
            title={filter === 'PENDING' ? 'No pending requests' : `No ${filter.toLowerCase()} requests`}
            body="All set!"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((req) => (
              <div key={req.id} className="p-4 flex items-start justify-between gap-4 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{req.staff.name}</div>
                  <div className="text-sm text-slate-500 mt-1">
                    {new Date(req.date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {req.type === 'PUNCH' && (
                      <Chip tone="info">
                        {req.punchType} at {req.punchTime}
                      </Chip>
                    )}
                    {req.type === 'STATUS' && (
                      <Chip tone="info">{req.statusValue}</Chip>
                    )}
                    <Chip tone={
                      req.status === 'PENDING' ? 'warn' :
                      req.status === 'APPROVED' ? 'success' :
                      'danger'
                    }>
                      {req.status}
                    </Chip>
                  </div>
                  {req.reason && <div className="text-sm text-slate-600 mt-2">"{req.reason}"</div>}
                </div>
                {req.status === 'PENDING' && (
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" kind="primary" onClick={() => setActive(req)}>Review</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {active && (
        <ReviewModal
          request={active}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ReviewModal({
  request,
  onClose,
  onDone,
}: {
  request: RegularizationRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const call = async (action: 'approve' | 'reject') => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `/api/staff-attendance/regularization/${request.id}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisionNote: note }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Review request" subtitle={request.staff.name}>
      <div className="space-y-3 mb-4">
        <div>
          <div className="text-xs text-slate-500">Date</div>
          <div className="font-medium">
            {new Date(request.date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Request type</div>
          <div className="font-medium">
            {request.type === 'PUNCH' ? `${request.punchType} punch at ${request.punchTime}` : request.statusValue}
          </div>
        </div>
        {request.reason && (
          <div>
            <div className="text-xs text-slate-500">Reason</div>
            <div className="text-sm text-slate-700">"{request.reason}"</div>
          </div>
        )}
      </div>

      {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2 mb-3">{error}</div>}

      <Field label="Decision note (optional)">
        <Input placeholder="E.g., Approved, verified with staff" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="flex gap-2 pt-3">
        <Button kind="primary" disabled={busy} onClick={() => call('approve')}>
          {busy ? 'Processing…' : 'Approve'}
        </Button>
        <Button kind="danger" disabled={busy} onClick={() => call('reject')}>
          Reject
        </Button>
        <Button kind="tertiary" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
