'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Skeleton, EmptyState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { feeMoney, PAY_METHOD_LABEL } from '@/lib/fees';

interface Receipt {
  receiptNo: string;
  paidAt: string;
  method: string;
  total: number;
  note: string | null;
  voided?: boolean;
  voidReason?: string | null;
  year: string;
  totalCharged: number | null;
  concession: number | null;
  totalPaid: number | null;
  balance: number | null;
  school: { name: string; address: string | null; phone: string | null };
  student: { id: string; name: string; className: string | null; section: string | null; guardianName: string };
  lines: { label: string; head: string; amount: number }[];
}

export default function ReceiptPage() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const [r, setR] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/fees/receipts/${paymentId}`);
      if (res.ok) setR(await res.json());
      setLoading(false);
    })();
  }, [paymentId]);

  if (loading) return <div className="max-w-lg mx-auto mt-8 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={32} />)}</div>;
  if (!r) return <div className="mt-12"><EmptyState icon="FileX" title="Receipt not found" /></div>;

  return (
    <div className="max-w-lg mx-auto">
      {/* print isolation: hide everything but #receipt when printing */}
      <style>{`@media print {
        body { visibility: hidden; }
        #receipt, #receipt * { visibility: visible; }
        #receipt { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
        .no-print { display: none !important; }
      }`}</style>

      <div className="no-print flex items-center justify-between py-4">
        <a href="#" onClick={(e) => { e.preventDefault(); history.back(); }} className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
          <Icon name="ArrowLeft" size={16} /> Back
        </a>
        <Button kind="primary" icon="Printer" onClick={() => window.print()}>Print receipt</Button>
      </div>

      {r.voided && (
        <div className="mb-3 rounded-lg bg-danger-50 border border-danger-200 px-4 py-2 text-sm text-danger-700 font-semibold text-center">
          ⛔ This receipt was CANCELLED{r.voidReason ? ` — ${r.voidReason}` : ''}. The payment has been reversed.
        </div>
      )}
      <div id="receipt" className={`bg-white border border-slate-200 rounded-xl p-6 shadow-xs ${r.voided ? 'opacity-70' : ''}`}>
        {/* header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200">
          <div>
            <div className="text-lg font-bold text-slate-900">{r.school.name}</div>
            {r.school.address && <div className="text-xs text-slate-500 mt-0.5">{r.school.address}</div>}
            {r.school.phone && <div className="text-xs text-slate-500">{r.school.phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Fee Receipt</div>
            <div className="text-sm font-mono font-semibold text-slate-900 mt-0.5">{r.receiptNo}</div>
            <div className="text-xs text-slate-500 mt-0.5">{new Date(r.paidAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
        </div>

        {/* student */}
        <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 py-4 text-sm border-b border-slate-200">
          <Detail label="Student" value={r.student.name} />
          <Detail label="Admission no" value={r.student.id} />
          <Detail label="Class" value={`${r.student.className || '—'}${r.student.section ? ' ' + r.student.section : ''}`} />
          <Detail label="Guardian" value={r.student.guardianName} />
          <Detail label="Academic year" value={r.year} />
          <Detail label="Mode" value={PAY_METHOD_LABEL[r.method as keyof typeof PAY_METHOD_LABEL] || r.method} />
        </div>

        {/* lines */}
        <table className="w-full text-sm my-4">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="text-left font-semibold py-2">Fee head</th>
              <th className="text-right font-semibold py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 text-slate-700">{l.label}</td>
                <td className="py-2 text-right tabular-nums text-slate-900">{feeMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-2.5 text-right font-semibold text-slate-900">Paid in this receipt</td>
              <td className="py-2.5 text-right font-bold text-slate-900 tabular-nums">{feeMoney(r.total)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Year fee position */}
        {r.balance != null && (
          <div className="rounded-lg border border-slate-200 overflow-hidden mb-3 text-sm">
            <div className="flex items-center justify-between px-4 py-1.5 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <span>Fee summary · {r.year}</span>
            </div>
            {r.totalCharged != null && (
              <div className="flex items-center justify-between px-4 py-1.5 border-t border-slate-100">
                <span className="text-slate-600">Total fee</span>
                <span className="tabular-nums text-slate-800">{feeMoney(r.totalCharged - (r.concession || 0))}</span>
              </div>
            )}
            {r.totalPaid != null && (
              <div className="flex items-center justify-between px-4 py-1.5 border-t border-slate-100">
                <span className="text-slate-600">Paid (total)</span>
                <span className="tabular-nums text-success-700">{feeMoney(r.totalPaid)}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-slate-50/60">
              <span className="font-semibold text-slate-900">Balance due</span>
              <span className={`font-bold tabular-nums ${r.balance > 0 ? 'text-danger-700' : 'text-success-700'}`}>{feeMoney(r.balance)}</span>
            </div>
          </div>
        )}

        {r.note && <div className="text-xs text-slate-500 mb-3">Note: {r.note}</div>}

        <div className="flex items-end justify-between pt-8 mt-2 border-t border-slate-200 text-xs text-slate-500">
          <div>This is a computer-generated receipt.</div>
          <div className="text-center">
            <div className="border-t border-slate-300 w-32 pt-1">Authorised signatory</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-slate-500">{label}: </span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
