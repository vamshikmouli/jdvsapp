'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { feeMoney } from '@/lib/fees';
import { Icon } from '@/components/Icon';

interface Result {
  valid: boolean;
  receiptNo?: string;
  student?: string;
  className?: string | null;
  amount?: number;
  date?: string;
  voided?: boolean;
}

const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

function VerifyInner() {
  const sp = useSearchParams();
  const r = sp.get('r');
  const t = sp.get('t');
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState<{ schoolName: string; logoUrl: string | null }>({ schoolName: 'Jnana Deepika', logoUrl: null });

  useEffect(() => {
    fetch('/api/branding').then((x) => x.json()).then((d) => setBrand({ schoolName: d?.schoolName || 'Jnana Deepika', logoUrl: d?.logoUrl || null })).catch(() => {});
  }, []);

  useEffect(() => {
    if (!r || !t) { setRes({ valid: false }); setLoading(false); return; }
    fetch(`/api/verify/receipt?r=${encodeURIComponent(r)}&t=${encodeURIComponent(t)}`)
      .then((x) => x.json())
      .then((d) => setRes(d))
      .catch(() => setRes({ valid: false }))
      .finally(() => setLoading(false));
  }, [r, t]);

  const ok = res?.valid && !res?.voided;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          {brand.logoUrl ? <img src={brand.logoUrl} alt="" className="w-8 h-8 rounded object-contain" /> : <Icon name="School" size={20} className="text-purple-600" />}
          <div className="font-bold text-slate-900">{brand.schoolName}</div>
        </div>

        <div className="p-6 text-center">
          {loading ? (
            <div className="py-10 text-slate-400">Verifying…</div>
          ) : ok ? (
            <>
              <div className="w-16 h-16 rounded-full bg-success-50 text-success-600 grid place-items-center mx-auto mb-3"><Icon name="CheckCircle2" size={36} /></div>
              <div className="text-lg font-bold text-success-700">Genuine receipt</div>
              <p className="text-sm text-slate-500 mt-1">This fee receipt matches the school's records.</p>
              <div className="mt-5 text-left rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
                <Row label="Receipt no." value={res!.receiptNo!} mono />
                <Row label="Student" value={`${res!.student}${res!.className ? ` · ${res!.className.replace(/\s?STD$/i, '')}` : ''}`} />
                <Row label="Amount paid" value={feeMoney(res!.amount!)} strong />
                <Row label="Date" value={fmtDate(res!.date)} />
              </div>
            </>
          ) : res?.valid && res?.voided ? (
            <>
              <div className="w-16 h-16 rounded-full bg-marigold-50 text-marigold-600 grid place-items-center mx-auto mb-3"><Icon name="AlertTriangle" size={34} /></div>
              <div className="text-lg font-bold text-marigold-700">Cancelled receipt</div>
              <p className="text-sm text-slate-500 mt-1">This receipt exists but the payment was later cancelled/reversed. It is not valid proof of payment.</p>
              <div className="mt-5 text-left rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
                <Row label="Receipt no." value={res!.receiptNo!} mono />
                <Row label="Student" value={res!.student || ''} />
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-danger-50 text-danger-600 grid place-items-center mx-auto mb-3"><Icon name="XCircle" size={36} /></div>
              <div className="text-lg font-bold text-danger-700">Not verified</div>
              <p className="text-sm text-slate-500 mt-1">This receipt could not be verified against the school's records. It may be fake, edited, or the link is incomplete. Please check with the school office.</p>
            </>
          )}
        </div>
        <div className="px-5 py-3 bg-slate-50 text-[11px] text-slate-400 text-center border-t border-slate-100">Official receipt verification · {brand.schoolName}</div>
      </div>
    </div>
  );
}

function Row({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-slate-500">{label}</span>
      <span className={`text-slate-900 ${mono ? 'font-mono' : ''} ${strong ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  );
}

export default function VerifyPage() {
  return <Suspense fallback={<div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>}><VerifyInner /></Suspense>;
}
