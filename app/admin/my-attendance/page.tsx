'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Button, Card, Chip, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { STATUS_LABEL, statusTone, fmtTime, getPosition } from '@/lib/staffAttendance/display';
import { AttendanceCalendar, type CalDay } from '@/components/AttendanceCalendar';

interface MeData {
  enabled: boolean;
  configured: boolean;
  enrolled: boolean;
  device: { deviceName: string | null; createdAt: string } | null;
  nextAction: 'IN' | 'OUT';
  today: { status: string; late: boolean; lateMinutes: number; firstIn: string | null; lastOut: string | null; workedMinutes: number } | null;
  punchesToday: { type: 'IN' | 'OUT'; at: string; source: string }[];
  todayKey: string;
  month: string;
  monthDays: CalDay[];
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MyAttendancePage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canPunch = perms.includes('STAFF_ATTENDANCE_MARK');

  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [calLoading, setCalLoading] = useState(false);
  const [busy, setBusy] = useState<'enroll' | 'punch' | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async (m: string = month) => {
    setCalLoading(true);
    const res = await fetch(`/api/staff-attendance/me?month=${m}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
    setCalLoading(false);
  }, [month]);

  useEffect(() => { load(month); }, [month, load]);

  const enroll = async () => {
    setError(''); setFlash(''); setBusy('enroll');
    try {
      if (!browserSupportsWebAuthn()) throw new Error('This phone does not support biometric sign-in.');
      const optRes = await fetch('/api/staff-attendance/enroll/options', { method: 'POST' });
      const optionsJSON = await optRes.json();
      if (!optRes.ok) throw new Error(optionsJSON.error || 'Could not start setup.');
      const att = await startRegistration({ optionsJSON });
      const vRes = await fetch('/api/staff-attendance/enroll/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(att),
      });
      const v = await vRes.json();
      if (!vRes.ok) throw new Error(v.error || 'Could not register this device.');
      setFlash('This phone is now set up for attendance.');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Setup failed.');
    } finally { setBusy(null); }
  };

  const punch = async () => {
    setError(''); setFlash(''); setBusy('punch');
    try {
      const pos = await getPosition();
      const optRes = await fetch('/api/staff-attendance/punch/options', { method: 'POST' });
      const optionsJSON = await optRes.json();
      if (optRes.status === 409) throw new Error('This phone is not set up yet.');
      if (!optRes.ok) throw new Error(optionsJSON.error || 'Could not start punch.');
      const assertion = await startAuthentication({ optionsJSON });
      const vRes = await fetch('/api/staff-attendance/punch/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assertion, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }),
      });
      const v = await vRes.json();
      if (!vRes.ok) throw new Error(v.error || 'Punch failed.');
      setFlash(`Punched ${v.type === 'IN' ? 'in' : 'out'} at ${fmtTime(v.at)}.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Punch failed.');
    } finally { setBusy(null); }
  };

  if (!canPunch) {
    return <EmptyState icon="Lock" title="Not available" body="Your role can't record staff attendance." />;
  }
  if (loading) return <div className="max-w-md mx-auto p-4 space-y-3"><Skeleton height={160} /><Skeleton height={80} /></div>;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">My attendance</h1>
        <p className="text-sm text-slate-500">Punch in and out from school using your fingerprint or Face ID.</p>
      </div>

      {!data?.enabled && (
        <Card><div className="text-sm text-slate-600">Staff attendance is not turned on yet. Please check with the office.</div></Card>
      )}

      {data?.enabled && !data.configured && (
        <Card><div className="text-sm text-slate-600">The school location hasn’t been set up yet, so punching is disabled. Ask the office to configure it.</div></Card>
      )}

      {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2">{error}</div>}
      {flash && <div className="rounded-md bg-success-50 text-success-700 text-sm px-3 py-2">{flash}</div>}

      {data?.enabled && data.configured && !data.enrolled && (
        <Card title="Set up this phone">
          <p className="text-sm text-slate-600 mb-3">
            Register this phone once. Your fingerprint / Face ID stays on the device — we never see it.
          </p>
          <Button kind="primary" icon="Fingerprint" onClick={enroll} disabled={busy === 'enroll'}>
            {busy === 'enroll' ? 'Setting up…' : 'Set up biometric'}
          </Button>
        </Card>
      )}

      {data?.enabled && data.configured && data.enrolled && (
        <Card>
          <div className="flex flex-col items-center text-center py-4">
            <div className="mb-2">
              {data.today ? (
                <Chip tone={statusTone(data.today.status)}>{STATUS_LABEL[data.today.status] ?? data.today.status}{data.today.late ? ' · Late' : ''}</Chip>
              ) : (
                <Chip tone="neutral">Not punched in yet</Chip>
              )}
            </div>
            <button
              onClick={punch}
              disabled={busy === 'punch'}
              className={`w-40 h-40 rounded-full flex flex-col items-center justify-center text-white font-semibold shadow-lg transition-transform active:scale-95 disabled:opacity-60 ${
                data.nextAction === 'IN' ? 'bg-success-500 hover:bg-success-600' : 'bg-danger-500 hover:bg-danger-600'
              }`}
            >
              <Icon name="Fingerprint" size={40} />
              <span className="mt-2 text-lg">{busy === 'punch' ? 'Please wait…' : data.nextAction === 'IN' ? 'Punch IN' : 'Punch OUT'}</span>
            </button>
            <p className="mt-4 text-xs text-slate-500">You must be at school. This uses your phone’s biometric + GPS.</p>
          </div>

          {data.punchesToday.length > 0 && (
            <div className="border-t border-slate-100 pt-3 mt-1">
              <div className="text-xs font-medium text-slate-500 mb-2">Today</div>
              <div className="space-y-1">
                {data.punchesToday.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className={p.type === 'IN' ? 'text-success-700' : 'text-danger-700'}>{p.type === 'IN' ? 'In' : 'Out'}</span>
                    <span className="text-slate-500">{fmtTime(p.at)}{p.source !== 'BIOMETRIC' ? ` · ${p.source.toLowerCase()}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {data?.enrolled && data.device && (
        <div className="text-center text-xs text-slate-400">
          Registered device: {data.device.deviceName || 'this phone'}
        </div>
      )}

      {data && (
        <Card title="My attendance calendar">
          <AttendanceCalendar
            month={data.month}
            days={data.monthDays}
            todayKey={data.todayKey}
            loading={calLoading}
            onMonthChange={setMonth}
          />
        </Card>
      )}
    </div>
  );
}
