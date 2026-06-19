'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Button, Card, Chip, EmptyState, Skeleton, Field, Input, Select } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { STATUS_LABEL, statusTone, fmtTime, getPosition } from '@/lib/staffAttendance/display';
import { haversineMeters } from '@/lib/staffAttendance/geofence';
import { AttendanceCalendar, type CalDay } from '@/components/AttendanceCalendar';

interface MeData {
  enabled: boolean;
  configured: boolean;
  enrolled: boolean;
  hasPin: boolean;
  device: { deviceName: string | null; createdAt: string } | null;
  nextAction: 'IN' | 'OUT';
  today: { status: string; late: boolean; lateMinutes: number; firstIn: string | null; lastOut: string | null; workedMinutes: number; currentStreak: number } | null;
  punchesToday: { type: 'IN' | 'OUT'; at: string; source: string }[];
  todayKey: string;
  month: string;
  monthDays: CalDay[];
  geofence: { schoolLat: number; schoolLng: number; radiusM: number; accuracyMaxM: number } | null;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// PIN punch for staff whose phone can't enroll a biometric (e.g. older Android).
// Uses the same GPS geofence as the biometric path; the PIN is the one the office
// sets (same PIN used at the shared kiosk).
function PinPunch({ nextAction, hasPin, onDone }: { nextAction: 'IN' | 'OUT'; hasPin: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const submit = async () => {
    setError(''); setFlash(''); setBusy(true);
    try {
      const pos = await getPosition();
      const res = await fetch('/api/staff-attendance/punch/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }),
      });
      const v = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(v.error || 'Punch failed.');
      setFlash(`Punched ${v.type === 'IN' ? 'in' : 'out'} at ${fmtTime(v.at)}.`);
      setPin('');
      setOpen(false);
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Punch failed.');
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-info-600 hover:underline">
        Can’t use fingerprint? Punch with your PIN
      </button>
    );
  }

  return (
    <div className="w-full max-w-xs space-y-3">
      {!hasPin && (
        <div className="rounded-md bg-warn-50 text-warn-700 text-sm px-3 py-2">
          No PIN is set for you yet. Ask the office to set your attendance PIN.
        </div>
      )}
      {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2">{error}</div>}
      {flash && <div className="rounded-md bg-success-50 text-success-700 text-sm px-3 py-2">{flash}</div>}
      <Field label="Your PIN">
        <Input
          inputMode="numeric"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="••••"
          autoFocus
        />
      </Field>
      <div className="flex gap-2">
        <Button kind="primary" disabled={busy || pin.length < 4} onClick={submit}>
          {busy ? 'Please wait…' : `Punch ${nextAction === 'IN' ? 'IN' : 'OUT'}`}
        </Button>
        <Button kind="tertiary" onClick={() => { setOpen(false); setError(''); setPin(''); }}>Cancel</Button>
      </div>
      <p className="text-xs text-slate-500">Uses GPS — you must be at school.</p>
    </div>
  );
}

function RegularizationWidget() {
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [punchType, setPunchType] = useState<'IN' | 'OUT'>('IN');
  const [punchTime, setPunchTime] = useState('09:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async () => {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const res = await fetch('/api/staff-attendance/regularization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, punchType, punchTime, reason }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to submit request');

      setSuccess('Request submitted. Admin will review and add the punch.');
      setShowForm(false);
      setReason('');
    } catch (e: any) {
      setError(e?.message || 'Failed to submit');
    } finally {
      setBusy(false);
    }
  };

  if (!showForm) {
    return (
      <Card title="Request missed punch">
        <p className="text-sm text-slate-600 mb-4">If you forgot to punch in or out, submit a request for admin to add it.</p>
        <Button icon="Clock" onClick={() => setShowForm(true)} kind="primary">Request punch</Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-slate-700"><Icon name="ChevronLeft" size={18} /></button>
        <h3 className="font-medium">Request missed punch</h3>
      </div>

      {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2 mb-3">{error}</div>}
      {success && <div className="rounded-md bg-success-50 text-success-700 text-sm px-3 py-2 mb-3">{success}</div>}

      <div className="space-y-3">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Direction"><Select value={punchType} onChange={(e) => setPunchType(e.target.value as any)}><option value="IN">Punch in</option><option value="OUT">Punch out</option></Select></Field>
        <Field label="Time"><Input type="time" value={punchTime} onChange={(e) => setPunchTime(e.target.value)} /></Field>
        <Field label="Reason (optional)"><Input placeholder="Why you're requesting this correction" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>

        <div className="flex gap-2 pt-2">
          <Button kind="primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit request'}</Button>
          <Button kind="tertiary" onClick={() => setShowForm(false)}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

// Turn a raw WebAuthn ceremony error into something a teacher can act on.
function webauthnMessage(e: any, ctx: 'enroll' | 'punch'): string {
  const name = e?.name || e?.cause?.name || '';
  const msg = String(e?.message || '');
  if (name === 'InvalidStateError') return 'This phone is already registered for attendance.';
  if (name === 'SecurityError') return 'Biometrics need a secure (https) connection. Open the site over https and try again.';
  if (name === 'NotAllowedError' || /not allowed|timed out|timeout/i.test(msg)) {
    return ctx === 'punch'
      ? 'Couldn’t verify on this phone. If this isn’t the phone you registered, use your registered phone — or ask the office to reset your device so you can set up this one. If it is your phone, tap Punch IN again and approve the fingerprint / Face ID prompt (don’t cancel).'
      : 'Setup was cancelled or timed out. Tap “Set up biometric” again and approve the fingerprint / Face ID prompt.';
  }
  return msg || 'Something went wrong. Please try again.';
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
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy: number; distance: number | null; inRange: boolean } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locErr, setLocErr] = useState('');

  const checkLocation = async () => {
    setLocBusy(true); setLocErr(''); setLoc(null);
    try {
      const pos = await getPosition();
      const g = data?.geofence;
      const distance = g ? haversineMeters({ lat: pos.lat, lng: pos.lng }, { lat: g.schoolLat, lng: g.schoolLng }) : null;
      const inRange = !!g && distance != null && pos.accuracy <= g.accuracyMaxM &&
        distance - Math.min(pos.accuracy, g.accuracyMaxM) <= g.radiusM;
      setLoc({ ...pos, distance, inRange });
    } catch (e: any) {
      setLocErr(e?.message || 'Could not get your location.');
    } finally { setLocBusy(false); }
  };

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
      let att;
      try { att = await startRegistration({ optionsJSON }); }
      catch (we) { throw new Error(webauthnMessage(we, 'enroll')); }
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
      if (optRes.status === 409) throw new Error('This phone is not set up yet. Tap “Set up biometric” first.');
      if (!optRes.ok) throw new Error(optionsJSON.error || 'Could not start punch.');
      let assertion;
      try { assertion = await startAuthentication({ optionsJSON }); }
      catch (we) { throw new Error(webauthnMessage(we, 'punch')); }
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
          <div className="border-t border-slate-100 mt-4 pt-4">
            <p className="text-sm text-slate-600 mb-2">
              Phone has no fingerprint / Face ID and can’t set up? Punch with your PIN instead.
            </p>
            <PinPunch nextAction={data.nextAction} hasPin={data.hasPin} onDone={load} />
          </div>
        </Card>
      )}

      {data?.enabled && data.configured && data.enrolled && (
        <Card>
          <div className="flex flex-col items-center text-center py-4">
            <div className="mb-2">
              {data.today ? (
                <>
                  <Chip tone={statusTone(data.today.status)}>{STATUS_LABEL[data.today.status] ?? data.today.status}{data.today.late ? ' · Late' : ''}</Chip>
                  {data.today.currentStreak > 0 && (
                    <div className="mt-2 flex items-center justify-center gap-1">
                      <Icon name="Flame" size={18} className="text-orange-500" />
                      <span className="text-lg font-semibold text-orange-600">{data.today.currentStreak} day{data.today.currentStreak === 1 ? '' : 's'} streak</span>
                    </div>
                  )}
                </>
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
            <div className="mt-3">
              <PinPunch nextAction={data.nextAction} hasPin={data.hasPin} onDone={load} />
            </div>
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

      {data?.enabled && data.configured && (
        <Card title="Location check">
          <p className="text-sm text-slate-600 mb-3">See your current location against the school’s assigned location.</p>
          <Button icon="MapPin" onClick={checkLocation} disabled={locBusy}>{locBusy ? 'Locating…' : 'Check my location'}</Button>
          {locErr && <div className="mt-3 rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2">{locErr}</div>}
          {loc && data.geofence && (
            <div className="mt-3 space-y-2">
              <div className={`rounded-md px-3 py-2 text-sm font-medium ${loc.inRange ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>
                {loc.inRange ? '✓ You are within the school area — you can punch.' : '✗ You are outside the allowed school area.'}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-slate-100 px-3 py-2">
                  <div className="text-xs text-slate-400">Distance from school</div>
                  <div className="font-semibold text-slate-900">{loc.distance != null ? `${Math.round(loc.distance)} m` : '—'}</div>
                  <div className="text-[11px] text-slate-400">allowed: {data.geofence.radiusM} m</div>
                </div>
                <div className="rounded-lg border border-slate-100 px-3 py-2">
                  <div className="text-xs text-slate-400">Your GPS accuracy</div>
                  <div className={`font-semibold ${loc.accuracy <= data.geofence.accuracyMaxM ? 'text-slate-900' : 'text-danger-700'}`}>±{Math.round(loc.accuracy)} m</div>
                  <div className="text-[11px] text-slate-400">max: {data.geofence.accuracyMaxM} m</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <a className="text-info-600 hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}>📍 Your location</a>
                <a className="text-info-600 hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${data.geofence.schoolLat},${data.geofence.schoolLng}`}>🏫 School location</a>
              </div>
              {!loc.inRange && loc.accuracy > data.geofence.accuracyMaxM && (
                <p className="text-xs text-slate-500">Your GPS is weak. Turn on precise location and move near a window or outdoors, then check again.</p>
              )}
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

      {data?.enrolled && data.configured && (
        <RegularizationWidget />
      )}
    </div>
  );
}
