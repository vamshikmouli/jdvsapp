'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Icon } from '@/components/Icon';

// Blocks the app until a first-time user replaces the default (phone-number)
// password with their own PIN. Covers every signed-in surface (staff + parent).
export function PinGate() {
  const { data: session, status, update } = useSession();
  const mustSet = status === 'authenticated' && (session?.user as any)?.mustSetPin;

  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!mustSet) return null;

  const submit = async () => {
    setError('');
    if (!/^\d{4,6}$/.test(pin)) { setError('PIN must be 4 to 6 digits.'); return; }
    if (pin !== confirm) { setError('The two PINs do not match.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/set-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not set PIN');
      await update(); // refresh the session → mustSetPin clears → gate closes
    } catch (e: any) {
      setError(e?.message || 'Could not set PIN');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <div className="flex flex-col items-center text-center mb-4">
          <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-3">
            <Icon name="ShieldCheck" size={24} className="text-purple-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Set your PIN</h2>
          <p className="text-sm text-slate-500 mt-1">
            For your security, set a personal 4–6 digit PIN. You’ll use it to sign in from now on instead of your phone number.
          </p>
        </div>

        {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2 mb-3">{error}</div>}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">New PIN</label>
            <input type="password" inputMode="numeric" autoFocus value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-center tracking-[0.4em] text-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Confirm PIN</label>
            <input type="password" inputMode="numeric" value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-center tracking-[0.4em] text-lg" />
          </div>
          <button onClick={submit} disabled={busy}
            className="w-full rounded-lg bg-purple-600 text-white font-medium py-2.5 hover:bg-purple-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Set PIN & continue'}
          </button>
          <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full text-xs text-slate-400 hover:text-slate-600 py-1">
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
