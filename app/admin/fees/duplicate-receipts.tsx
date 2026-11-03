'use client';

import React, { useState } from 'react';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { Button, Card, Drawer, Skeleton, EmptyState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { feeMoney, PAY_METHOD_LABEL } from '@/lib/fees';
import { fmtDate } from '@/lib/dateFormat';
import { toast } from '@/lib/toast';
import { shortClass } from './_shared';

interface DupReceipt { id: string; receiptNo: string; method: string; total: number; seq: number; imported: boolean; heads: { name: string; amount: number }[]; suspect: 'exact' | 'likely' | null; repeats: string | null }
interface DupGroup { studentId: string; studentName: string; className: string | null; date: string; receipts: DupReceipt[]; suspectTotal: number }
interface DupResult { year: string; groups: DupGroup[]; suspects: number; suspectTotal: number }

const REASON = 'Duplicate — fee sheet uploaded twice';

// Fees → Reports: find receipts duplicated by repeated fee-sheet uploads (an old bug, now
// fixed) and cancel them after review. Nothing is cancelled automatically.
export function DuplicateReceiptsCard() {
  const { can } = usePermissions();
  const canVoid = can('FEES_VOID');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/fees/duplicate-receipts');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not check');
      setData(d);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not check'); }
    setLoading(false);
  };
  const check = () => { setOpen(true); load(); };

  const cancel = async (g: DupGroup, r: DupReceipt) => {
    if (!confirm(`Cancel receipt ${r.receiptNo} (${feeMoney(r.total)}) for ${g.studentName}?\n\nIt repeats ${r.repeats}. The amount goes back to the student's balance. This can't be undone.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/fees/payments/${r.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: REASON }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not cancel');
      toast.success(`Cancelled ${r.receiptNo}`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not cancel'); }
    setBusyId('');
  };

  return (
    <>
      <Card padded={false} title={<div className="flex items-center justify-between w-full gap-3">
        <span className="inline-flex items-center gap-2"><Icon name="CopyX" size={16} className="text-marigold-600" /> Duplicate receipts check</span>
        <Button size="sm" icon="Search" onClick={check}>Check now</Button>
      </div>}>
        <div className="px-6 py-3 text-xs text-slate-500">
          Finds receipts that were created twice when the same fee sheet was uploaded more than once
          (same student, same date, same fee heads). Review each one and cancel the extra copy — nothing is cancelled automatically.
        </div>
      </Card>

      {open && (
        <Drawer open onClose={() => setOpen(false)} title="Duplicate receipts check" width={640}
          subtitle={data ? (data.suspects ? `${data.suspects} likely duplicate receipt${data.suspects === 1 ? '' : 's'} · ${feeMoney(data.suspectTotal)} · ${data.year}` : `No duplicates found · ${data.year}`) : 'Checking…'}
          footer={<div className="flex justify-between items-center gap-2">
            <span className="text-[11px] text-slate-400">Keep the first receipt of each pair; cancel the one marked in red.</span>
            <div className="flex gap-2"><Button icon="RefreshCw" onClick={load} disabled={loading}>Check again</Button><Button onClick={() => setOpen(false)}>Close</Button></div>
          </div>}>
          {error && <div className="mb-3 bg-danger-50 border border-danger-100 rounded-md p-2.5 text-sm text-danger-700">{error}</div>}
          {loading && !data && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={90} />)}</div>}
          {data && data.groups.length === 0 && <EmptyState icon="CheckCircle2" title="No duplicate receipts" body="Every student has at most one uploaded receipt per date for the same fee heads." />}
          {data && data.groups.length > 0 && (
            <div className="space-y-3">
              {data.groups.map((g) => (
                <div key={`${g.studentId}|${g.date}`} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2 border-b border-slate-100">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{g.studentName}</div>
                      <div className="text-[11px] text-slate-500">{shortClass(g.className)} · {g.studentId} · paid on <b>{fmtDate(g.date)}</b></div>
                    </div>
                    <span className="text-xs font-bold text-danger-700 tabular-nums whitespace-nowrap">{feeMoney(g.suspectTotal)} extra</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {g.receipts.map((r) => (
                      <div key={r.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${r.suspect ? 'bg-danger-50/50' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                            <span className="font-mono text-slate-700">{r.receiptNo}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-600">{PAY_METHOD_LABEL[r.method as keyof typeof PAY_METHOD_LABEL] || r.method}</span>
                            {r.imported && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">from fee sheet</span>}
                            {r.suspect === 'exact' && <span className="rounded bg-danger-100 px-1.5 py-0.5 text-[10px] font-bold text-danger-700">EXACT DUPLICATE of {r.repeats}</span>}
                            {r.suspect === 'likely' && <span className="rounded bg-marigold-50 px-1.5 py-0.5 text-[10px] font-bold text-marigold-700">LIKELY DUPLICATE of {r.repeats}</span>}
                            {!r.suspect && <span className="rounded bg-success-50 px-1.5 py-0.5 text-[10px] font-bold text-success-700">KEEP</span>}
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-slate-500">{r.heads.map((h) => `${h.name} ${feeMoney(h.amount)}`).join(' · ') || '—'}</div>
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                          <span className="text-sm font-bold tabular-nums text-slate-900">{feeMoney(r.total)}</span>
                          {r.suspect && canVoid && (
                            <Button size="sm" kind="danger" icon="XCircle" onClick={() => cancel(g, r)} disabled={!!busyId}>{busyId === r.id ? 'Cancelling…' : 'Cancel this receipt'}</Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!canVoid && <p className="text-xs text-slate-500">You can review these, but cancelling a receipt needs the &quot;Cancel payments&quot; permission — ask an admin.</p>}
            </div>
          )}
        </Drawer>
      )}
    </>
  );
}
