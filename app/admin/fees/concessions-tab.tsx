'use client';

import { toast } from '@/lib/toast';
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

export function ConcessionsTab() {
  const [status, setStatus] = useState('PENDING');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Cached + de-duped by React Query: switching status tabs and back is instant.
  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: ['fees', 'concessions', status],
    queryFn: () => jsonFetcher<{ items: ConcessionRow[] }>(`/api/fees/concessions?status=${status}`),
  });
  const rows = data?.items ?? [];

  const decide = async (id: string, action: 'approve' | 'reject' | 'cancel') => {
    if (action === 'cancel' && !confirm('Cancel this approved concession? The waived amount becomes payable again for the student.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/fees/concessions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed'); }
      await refetch();
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
