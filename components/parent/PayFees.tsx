'use client';

import { useEffect, useRef, useState } from 'react';
import { feeMoney } from '@/lib/fees';

export interface OutstandingItem {
  chargeId: string;
  label: string;
  headName: string;
  balance: number;
}

type Step = 'choose' | 'pay' | 'done' | 'failed';

/**
 * Parent-facing "Pay fees online" flow. Parent picks full balance (default) or specific
 * line items, we create an order, open the provider's hosted UPI page, and poll until it
 * confirms. No UTR, no typing — the parent just approves in their UPI app.
 */
export default function PayFees({
  studentId,
  studentName,
  balance,
  outstanding,
  onPaid,
}: {
  studentId: string;
  studentName: string;
  balance: number;
  outstanding: OutstandingItem[];
  onPaid?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [mode, setMode] = useState<'full' | 'charges'>('full');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{ id: string; amount: number; redirectUrl: string | null; intentUrl: string | null; qrDataUrl: string | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  const pickedTotal = outstanding.filter((o) => picked[o.chargeId]).reduce((t, o) => t + o.balance, 0);
  const payAmount = mode === 'full' ? balance : pickedTotal;

  function reset() {
    setStep('choose'); setMode('full'); setPicked({}); setError(null); setOrder(null); setBusy(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  function close() { reset(); setOpen(false); }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function start() {
    setError(null);
    if (mode === 'charges' && pickedIds.length === 0) { setError('Select at least one item to pay.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/payments/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, mode, chargeIds: mode === 'charges' ? pickedIds : undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Could not start payment');
      setOrder({ id: d.id, amount: d.amount, redirectUrl: d.redirectUrl, intentUrl: d.intentUrl, qrDataUrl: d.qrDataUrl });
      setStep('pay');
      // Open the provider's page / UPI app for the parent to approve.
      const url = d.intentUrl || d.redirectUrl;
      if (url) {
        const w = window.open(url, '_blank');
        if (!w) window.location.href = url; // popup blocked → navigate (webhook still posts it)
      }
      beginPolling(d.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment');
    } finally {
      setBusy(false);
    }
  }

  function beginPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/orders/${id}`);
        if (!res.ok) return;
        const d = await res.json();
        if (d.paid) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setStep('done');
          onPaid?.();
        } else if (d.failed) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setStep('failed');
        }
      } catch { /* keep polling */ }
    }, 4000);
  }

  if (balance <= 0) return null;

  return (
    <>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="mt-3 w-full py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold shadow-sm active:scale-[0.99] transition-transform"
      >
        Pay {feeMoney(balance)} online
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={close}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white">
              <div className="font-bold text-slate-900">Pay fees · {studentName}</div>
              <button onClick={close} className="text-slate-400 text-xl leading-none px-2">×</button>
            </div>

            <div className="p-4">
              {step === 'choose' && (
                <>
                  <div className="space-y-2">
                    <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer ${mode === 'full' ? 'border-purple-400 bg-purple-50' : 'border-slate-200'}`}>
                      <span className="flex items-center gap-2">
                        <input type="radio" checked={mode === 'full'} onChange={() => setMode('full')} />
                        <span className="text-sm font-medium text-slate-800">Pay full balance</span>
                      </span>
                      <span className="font-bold tabular-nums text-slate-900">{feeMoney(balance)}</span>
                    </label>
                    <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer ${mode === 'charges' ? 'border-purple-400 bg-purple-50' : 'border-slate-200'}`}>
                      <input type="radio" checked={mode === 'charges'} onChange={() => setMode('charges')} />
                      <span className="text-sm font-medium text-slate-800">Choose what to pay</span>
                    </label>
                  </div>

                  {mode === 'charges' && (
                    <div className="mt-2 space-y-1.5 border border-slate-100 rounded-xl p-2">
                      {outstanding.map((o) => (
                        <label key={o.chargeId} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                          <span className="flex items-center gap-2 min-w-0">
                            <input type="checkbox" checked={!!picked[o.chargeId]} onChange={(e) => setPicked((p) => ({ ...p, [o.chargeId]: e.target.checked }))} />
                            <span className="text-sm text-slate-700 truncate">{o.label}</span>
                          </span>
                          <span className="text-sm tabular-nums text-danger-700 font-medium whitespace-nowrap">{feeMoney(o.balance)}</span>
                        </label>
                      ))}
                      {outstanding.length === 0 && <div className="text-xs text-slate-400 text-center py-2">Nothing outstanding.</div>}
                    </div>
                  )}

                  {error && <div className="mt-3 text-xs text-danger-700">{error}</div>}

                  <button
                    disabled={busy || payAmount <= 0}
                    onClick={start}
                    className="mt-4 w-full py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {busy ? 'Starting…' : `Pay ${feeMoney(payAmount)}`}
                  </button>
                  <p className="mt-2 text-[11px] text-slate-400 text-center">You'll approve the payment in your own GPay / PhonePe app.</p>
                </>
              )}

              {step === 'pay' && order && (
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-900 tabular-nums">{feeMoney(order.amount)}</div>
                  <div className="text-sm text-slate-500 mt-1">Approve the payment in your UPI app.</div>
                  {order.qrDataUrl && (
                    <div className="mt-4">
                      <div className="text-[11px] text-slate-400 mb-1">On a computer? Scan to pay:</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={order.qrDataUrl} alt="Payment QR" className="mx-auto w-44 h-44 rounded-lg border border-slate-200" />
                    </div>
                  )}
                  {(order.intentUrl || order.redirectUrl) && (
                    <a
                      href={order.intentUrl || order.redirectUrl || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-block w-full py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold"
                    >
                      Open payment page
                    </a>
                  )}
                  <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
                    <span className="w-3 h-3 border-2 border-slate-300 border-t-purple-500 rounded-full animate-spin" />
                    Waiting for confirmation…
                  </div>
                </div>
              )}

              {step === 'done' && (
                <div className="text-center py-4">
                  <div className="w-12 h-12 mx-auto rounded-full bg-success-100 text-success-700 flex items-center justify-center text-2xl">✓</div>
                  <div className="mt-3 font-bold text-slate-900">Payment received</div>
                  <div className="text-sm text-slate-500 mt-1">Your receipt has been generated. Thank you!</div>
                  <button onClick={close} className="mt-4 w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold">Done</button>
                </div>
              )}

              {step === 'failed' && (
                <div className="text-center py-4">
                  <div className="w-12 h-12 mx-auto rounded-full bg-danger-100 text-danger-700 flex items-center justify-center text-2xl">!</div>
                  <div className="mt-3 font-bold text-slate-900">Payment not completed</div>
                  <div className="text-sm text-slate-500 mt-1">No money was deducted, or it couldn't be confirmed. Please try again.</div>
                  <button onClick={() => reset()} className="mt-4 w-full py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold">Try again</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
