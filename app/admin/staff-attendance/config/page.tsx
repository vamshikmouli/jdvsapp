'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button, Card, Field, Input, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { getPosition, fmtMins } from '@/lib/staffAttendance/display';

interface Cfg {
  staffAttEnabled: boolean;
  schoolLat: number | null; schoolLng: number | null;
  geofenceRadiusM: number; gpsAccuracyMaxM: number;
  shiftStart: string; shiftEnd: string; afternoonStart: string;
  lateGraceMins: number; halfDayMins: number; fullDayMins: number;
  weeklyOffDays: number[];
  leaveQuotas: Record<string, number>;
  leaveYearStartMonth: number;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEAVE_TYPES: [string, string][] = [['EARNED', 'Earned'], ['SICK', 'Sick'], ['UNPAID', 'Unpaid']];

export default function StaffAttendanceConfigPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    fetch('/api/staff-attendance/config').then(async (r) => {
      if (r.status === 403) { setLoading(false); return; }
      if (r.ok) setCfg(await r.json());
      setLoading(false);
    });
  }, []);

  const set = (patch: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...patch } : c));

  const useMyLocation = async () => {
    setLocating(true); setError('');
    try { const p = await getPosition(); set({ schoolLat: +p.lat.toFixed(6), schoolLng: +p.lng.toFixed(6) }); }
    catch (e: any) { setError(e?.message || 'Could not get location'); } finally { setLocating(false); }
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setMsg(''); setError('');
    try {
      const res = await fetch('/api/staff-attendance/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Save failed');
      setMsg('Saved.');
    } catch (e: any) { setError(e?.message || 'Save failed'); } finally { setSaving(false); }
  };

  if (loading) return <div className="max-w-2xl mx-auto p-6 space-y-3"><Skeleton height={120} /><Skeleton height={200} /></div>;
  if (!cfg) return <EmptyState icon="Lock" title="Not available" body="You can’t configure staff attendance." />;

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Attendance settings</h1>
          <p className="text-sm text-slate-500">Geofence and work-schedule rules.</p>
        </div>
        <Link href="/admin/staff-attendance" className="text-sm text-slate-500 hover:text-slate-700">Back</Link>
      </div>

      {msg && <div className="rounded-md bg-success-50 text-success-700 text-sm px-3 py-2">{msg}</div>}
      {error && <div className="rounded-md bg-danger-50 text-danger-700 text-sm px-3 py-2">{error}</div>}

      <Card title="Status">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={cfg.staffAttEnabled} onChange={(e) => set({ staffAttEnabled: e.target.checked })} className="w-4 h-4" />
          <span>Enable staff attendance (staff can punch in/out)</span>
        </label>
      </Card>

      <Card title="School location (geofence)">
        <p className="text-sm text-slate-600 mb-3">Stand at the school and tap “Use my current location”. Punches are only allowed within the radius below.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude"><Input type="number" step="any" value={cfg.schoolLat ?? ''} onChange={(e) => set({ schoolLat: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Longitude"><Input type="number" step="any" value={cfg.schoolLng ?? ''} onChange={(e) => set({ schoolLng: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-2"><Button icon="MapPin" onClick={useMyLocation} disabled={locating}>{locating ? 'Locating…' : 'Use my current location'}</Button></div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Allowed radius (m)"><Input type="number" value={cfg.geofenceRadiusM} onChange={(e) => set({ geofenceRadiusM: Number(e.target.value) })} /></Field>
          <Field label="Max GPS error (m)" hint="Reject weaker fixes"><Input type="number" value={cfg.gpsAccuracyMaxM} onChange={(e) => set({ gpsAccuracyMaxM: Number(e.target.value) })} /></Field>
        </div>
      </Card>

      <Card title="Work schedule">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shift start"><Input type="time" value={cfg.shiftStart} onChange={(e) => set({ shiftStart: e.target.value })} /></Field>
          <Field label="Shift end"><Input type="time" value={cfg.shiftEnd} onChange={(e) => set({ shiftEnd: e.target.value })} /></Field>
          <Field label="Afternoon start" hint="Late reference for afternoon half-day staff"><Input type="time" value={cfg.afternoonStart} onChange={(e) => set({ afternoonStart: e.target.value })} /></Field>
          <div />
          <Field label="Late grace (mins)" hint="In after start + grace = late"><Input type="number" value={cfg.lateGraceMins} onChange={(e) => set({ lateGraceMins: Number(e.target.value) })} /></Field>
          <div />
          <Field label="Half-day after (mins)" hint={fmtMins(cfg.halfDayMins)}><Input type="number" value={cfg.halfDayMins} onChange={(e) => set({ halfDayMins: Number(e.target.value) })} /></Field>
          <Field label="Full-day after (mins)" hint={fmtMins(cfg.fullDayMins)}><Input type="number" value={cfg.fullDayMins} onChange={(e) => set({ fullDayMins: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-sm font-medium text-slate-700">Weekly off days</div>
            <button
              type="button"
              onClick={() => set({ weeklyOffDays: cfg.weeklyOffDays.length ? [] : [0] })}
              className="text-xs text-purple-600 hover:text-purple-700"
            >
              {cfg.weeklyOffDays.length ? 'Clear all' : 'Reset to Sunday'}
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 max-w-md">
            {DAYS.map((d, i) => {
              const on = cfg.weeklyOffDays.includes(i);
              const weekend = i === 0 || i === 6;
              return (
                <button
                  key={d}
                  type="button"
                  title={DAY_FULL[i]}
                  aria-pressed={on}
                  onClick={() => set({ weeklyOffDays: (on ? cfg.weeklyOffDays.filter((x) => x !== i) : [...cfg.weeklyOffDays, i]).sort((a, b) => a - b) })}
                  className={`group relative flex flex-col items-center gap-1 rounded-xl py-2.5 transition-all ${
                    on
                      ? 'bg-purple-500 text-white shadow-sm ring-2 ring-purple-200'
                      : `bg-slate-50 text-slate-600 hover:bg-slate-100 ${weekend ? 'text-slate-400' : ''}`
                  }`}
                >
                  <span className="text-[11px] font-medium uppercase tracking-wide">{d}</span>
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${on ? 'bg-white/25' : 'bg-white'}`}>
                    {on ? <Icon name="Check" size={14} /> : d[0]}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-xs text-slate-500">
            {cfg.weeklyOffDays.length === 0
              ? 'No weekly off — staff are expected every day.'
              : `${cfg.weeklyOffDays.length} day${cfg.weeklyOffDays.length > 1 ? 's' : ''} off each week: ${cfg.weeklyOffDays.map((i) => DAY_FULL[i]).join(', ')}. These show as “Weekly off”, not absent.`}
          </p>
        </div>
      </Card>

      <Card title="Leave quotas">
        <p className="text-sm text-slate-600 mb-3">Annual entitlement per leave type (0 = no limit). Per-staff overrides can be set on each staff member’s attendance page.</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {LEAVE_TYPES.map(([k, label]) => (
            <Field key={k} label={label}>
              <Input type="number" min={0} value={cfg.leaveQuotas?.[k] ?? 0}
                onChange={(e) => set({ leaveQuotas: { ...cfg.leaveQuotas, [k]: Number(e.target.value) } })} />
            </Field>
          ))}
        </div>
        <div className="mt-3 max-w-xs">
          <Field label="Leave year starts" hint="Quotas reset on the 1st of this month">
            <select className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" value={cfg.leaveYearStartMonth} onChange={(e) => set({ leaveYearStartMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <HolidaysCard />

      <div className="flex justify-end"><Button kind="primary" icon="Check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button></div>
    </div>
  );
}

interface Holiday { id: string; date: string; name: string; }

function HolidaysCard() {
  const [list, setList] = useState<Holiday[]>([]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch('/api/staff-attendance/holidays');
    if (r.ok) setList(await r.json());
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!date || !name.trim()) return;
    setBusy(true);
    await fetch('/api/staff-attendance/holidays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, name }) });
    setDate(''); setName(''); setBusy(false); load();
  };
  const remove = async (d: string) => {
    await fetch(`/api/staff-attendance/holidays?date=${d.slice(0, 10)}`, { method: 'DELETE' });
    load();
  };

  return (
    <Card title="Holidays">
      <p className="text-sm text-slate-600 mb-3">Declare any date a holiday for all staff. Staff with no punch that day show “Holiday”, not absent.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="flex-1 min-w-[160px]"><Field label="Name"><Input value={name} placeholder="e.g. Founder’s Day" onChange={(e) => setName(e.target.value)} /></Field></div>
        <Button icon="Plus" onClick={add} disabled={busy || !date || !name.trim()}>Add</Button>
      </div>
      {list.length > 0 && (
        <div className="mt-3 divide-y divide-slate-100">
          {list.map((h) => (
            <div key={h.id} className="flex items-center justify-between py-2 text-sm">
              <span><span className="font-medium text-slate-700">{new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span> <span className="text-slate-500">— {h.name}</span></span>
              <button onClick={() => remove(h.date)} className="text-xs text-danger-600 hover:text-danger-700">Remove</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
