'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Button, Card, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { fmtTime } from '@/lib/staffAttendance/display';

interface Row { staffId: string; name: string; designation: string | null; hasPin: boolean; }

export default function KioskPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canRun = perms.includes('STAFF_ATTENDANCE_KIOSK') || perms.includes('STAFF_ATTENDANCE_MANAGE');

  const [staff, setStaff] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Row | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/staff-attendance/kiosk/staff');
    if (res.ok) { const b = await res.json(); setStaff(b as Row[]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setSelected(null); setPin(''); setResult(null); };

  const submit = async () => {
    if (!selected) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/api/staff-attendance/kiosk/punch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: selected.staffId, pin }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Punch failed');
      setResult({ ok: true, msg: `${j.staffName}: punched ${j.type === 'IN' ? 'IN' : 'OUT'} at ${fmtTime(j.at)}` });
      setTimeout(reset, 2500);
    } catch (e: any) {
      setResult({ ok: false, msg: e?.message || 'Punch failed' });
      setPin('');
    } finally { setBusy(false); }
  };

  if (!canRun) return <EmptyState icon="Lock" title="Not available" body="You can’t run the attendance kiosk." />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-md mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Attendance kiosk</h1>
          {/* No link back to the admin board — the kiosk is locked. Leaving = sign out. */}
          <button onClick={() => signOut({ callbackUrl: '/' })} className="text-sm text-slate-500 hover:text-slate-700">Sign out</button>
        </div>

        {result && (
          <div className={`rounded-md px-3 py-3 text-sm text-center ${result.ok ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>{result.msg}</div>
        )}

        {!selected ? (
          loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={56} />)}</div>
          ) : staff.length === 0 ? (
            <EmptyState icon="KeyRound" title="No kiosk staff" body="Set an Attendance PIN for staff (in Manage) to let them punch here." />
          ) : (
            <Card title="Select your name" padded={false}>
              <div className="divide-y divide-slate-100">
                {staff.map((s) => (
                  <button key={s.staffId} onClick={() => { setSelected(s); setResult(null); }} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                    <span><span className="font-medium text-slate-900">{s.name}</span>{s.designation && <span className="block text-xs text-slate-400">{s.designation}</span>}</span>
                    <Icon name="ChevronRight" size={18} className="text-slate-300" />
                  </button>
                ))}
              </div>
            </Card>
          )
        ) : (
          <Card>
            <div className="text-center mb-3">
              <div className="font-semibold text-slate-900">{selected.name}</div>
              <div className="text-xs text-slate-400">Enter your PIN</div>
            </div>
            <div className="flex justify-center gap-2 mb-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? 'bg-purple-500' : 'bg-slate-200'}`} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'].map((k) => (
                <button
                  key={k}
                  disabled={busy}
                  onClick={() => {
                    if (k === 'back') setPin((p) => p.slice(0, -1));
                    else if (k === 'ok') submit();
                    else setPin((p) => (p.length < 6 ? p + k : p));
                  }}
                  className={`h-14 rounded-lg text-lg font-medium disabled:opacity-50 ${
                    k === 'ok' ? 'bg-purple-500 text-white hover:bg-purple-600' : k === 'back' ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-white border border-slate-200 text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {k === 'back' ? '⌫' : k === 'ok' ? '✓' : k}
                </button>
              ))}
            </div>
            <button onClick={reset} className="w-full mt-3 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          </Card>
        )}
      </div>
    </div>
  );
}
