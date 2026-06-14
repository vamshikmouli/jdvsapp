'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Field, Input, Select, Chip, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface SessionDef {
  key: string;
  label: string;
  open: string;
  close: string;
}

interface Settings {
  schoolName: string;
  principalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  academicYear: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  sessions: SessionDef[];
  autoLock: boolean;
  notifyAbsence: boolean;
}

interface DeviceSession {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

type Tab = 'school' | 'attendance' | 'account';

// Small toggle switch
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-purple-500' : 'bg-slate-300'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function deviceLabel(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'school', label: 'School profile', icon: 'Building2' },
  { id: 'attendance', label: 'Attendance', icon: 'Calendar' },
  { id: 'account', label: 'My account', icon: 'UserCircle' },
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('SETTINGS_MANAGE');

  const [tab, setTab] = useState<Tab>('school');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setSettings(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const set = (patch: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  // --- session list editing ---
  const updateSessions = (fn: (list: SessionDef[]) => SessionDef[]) =>
    setSettings((s) => (s ? { ...s, sessions: fn(s.sessions || []) } : s));
  const addSession = () =>
    updateSessions((list) => [...list, { key: '', label: `Session ${list.length + 1}`, open: '', close: '' }]);
  const editSession = (i: number, patch: Partial<SessionDef>) =>
    updateSessions((list) => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeSession = (i: number) => updateSessions((list) => list.filter((_, idx) => idx !== i));
  const moveSession = (i: number, dir: -1 | 1) =>
    updateSessions((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed (${res.status})`);
      }
      setSettings(await res.json());
      setNotice('Settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings" meta="Manage your school configuration and account." />

      {/* Tabs */}
      <div className="flex items-center gap-1 mt-6 border-b border-slate-200 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setNotice(''); setError(''); }}
            className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex-shrink-0 transition-colors ${
              tab === t.id
                ? 'border-purple-500 text-purple-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon name={t.icon as any} size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mt-4 px-4 py-2.5 bg-success-50 text-success-700 rounded-md text-sm flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')}><Icon name="X" size={16} /></button>
        </div>
      )}
      {error && (
        <div className="mt-4 px-4 py-2.5 bg-danger-50 text-danger-700 rounded-md text-sm">{error}</div>
      )}

      {/* SCHOOL + ATTENDANCE need settings loaded */}
      {(tab === 'school' || tab === 'attendance') && (
        <div className="mt-6 max-w-3xl">
          {loading || !settings ? (
            <Card>
              <Skeleton height={16} width="30%" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={38} />)}
              </div>
            </Card>
          ) : tab === 'school' ? (
            <Card title="School profile">
              {!canManage && (
                <div className="mb-4 text-xs text-slate-500 bg-slate-50 rounded-md p-3 inline-flex items-center gap-2">
                  <Icon name="Lock" size={14} /> You can view these settings but only an admin can change them.
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="School name">
                  <Input value={settings.schoolName} disabled={!canManage} onChange={(e) => set({ schoolName: e.target.value })} />
                </Field>
                <Field label="Principal name">
                  <Input value={settings.principalName || ''} disabled={!canManage} onChange={(e) => set({ principalName: e.target.value })} placeholder="—" />
                </Field>
                <Field label="Academic year">
                  <Input value={settings.academicYear} disabled={!canManage} onChange={(e) => set({ academicYear: e.target.value })} placeholder="2025-26" />
                </Field>
                <Field label="Phone">
                  <Input value={settings.phone || ''} disabled={!canManage} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 ..." />
                </Field>
                <Field label="Email">
                  <Input value={settings.email || ''} disabled={!canManage} onChange={(e) => set({ email: e.target.value })} placeholder="office@school.edu" />
                </Field>
                <Field label="Currency">
                  <Select value={settings.currency} disabled={!canManage} onChange={(e) => set({ currency: e.target.value })}>
                    <option value="INR">₹ INR — Indian Rupee</option>
                    <option value="USD">$ USD — US Dollar</option>
                    <option value="EUR">€ EUR — Euro</option>
                  </Select>
                </Field>
                <Field label="Timezone">
                  <Select value={settings.timezone} disabled={!canManage} onChange={(e) => set({ timezone: e.target.value })}>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="Asia/Dubai">Asia/Dubai</option>
                    <option value="UTC">UTC</option>
                  </Select>
                </Field>
                <Field label="Date format">
                  <Select value={settings.dateFormat} disabled={!canManage} onChange={(e) => set({ dateFormat: e.target.value })}>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </Select>
                </Field>
                <div className="col-span-2">
                  <Field label="Address">
                    <textarea
                      value={settings.address || ''}
                      disabled={!canManage}
                      onChange={(e) => set({ address: e.target.value })}
                      placeholder="School address"
                      rows={2}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </Field>
                </div>
              </div>
              {canManage && (
                <div className="flex justify-end mt-6">
                  <Button kind="primary" onClick={saveSettings} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
                </div>
              )}
            </Card>
          ) : (
            // ATTENDANCE
            <Card title="Attendance">
              {!canManage && (
                <div className="mb-4 text-xs text-slate-500 bg-slate-50 rounded-md p-3 inline-flex items-center gap-2">
                  <Icon name="Lock" size={14} /> View only — ask an admin to change attendance settings.
                </div>
              )}
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-slate-900">Attendance sessions</div>
                    {canManage && (
                      <Button size="sm" icon="Plus" onClick={addSession}>Add session</Button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    Add one session, or as many as you need. Each is a separate roll-call (name + time window).
                  </p>

                  {(settings.sessions || []).length === 0 && (
                    <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                      No sessions yet — add at least one.
                    </p>
                  )}

                  <div className="space-y-2">
                    {(settings.sessions || []).map((s, i) => (
                      <div key={i} className="flex items-end gap-2 p-3 border border-slate-200 rounded-lg">
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => moveSession(i, -1)}
                            disabled={!canManage || i === 0}
                            className="text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move up"
                          >
                            <Icon name="ChevronUp" size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSession(i, 1)}
                            disabled={!canManage || i === settings.sessions.length - 1}
                            className="text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move down"
                          >
                            <Icon name="ChevronDown" size={14} />
                          </button>
                        </div>
                        <div className="flex-1">
                          <label className="block text-[11px] text-slate-400 mb-1">Session name</label>
                          <Input value={s.label} disabled={!canManage} onChange={(e) => editSession(i, { label: e.target.value })} placeholder="e.g. Morning" />
                        </div>
                        <div className="w-28">
                          <label className="block text-[11px] text-slate-400 mb-1">Opens</label>
                          <Input type="time" value={s.open} disabled={!canManage} onChange={(e) => editSession(i, { open: e.target.value })} />
                        </div>
                        <div className="w-28">
                          <label className="block text-[11px] text-slate-400 mb-1">Closes</label>
                          <Input type="time" value={s.close} disabled={!canManage} onChange={(e) => editSession(i, { close: e.target.value })} />
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => removeSession(i)}
                            className="text-slate-400 hover:text-danger-600 p-2 mb-0.5"
                            title="Remove session"
                          >
                            <Icon name="Trash2" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-900">Auto-lock sessions</div>
                      <p className="text-xs text-slate-500 mt-0.5">Automatically lock a session after its window closes.</p>
                    </div>
                    <Toggle checked={settings.autoLock} disabled={!canManage} onChange={(v) => set({ autoLock: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-900">Notify parents on absence</div>
                      <p className="text-xs text-slate-500 mt-0.5">Send an alert to the guardian when a student is marked absent.</p>
                    </div>
                    <Toggle checked={settings.notifyAbsence} disabled={!canManage} onChange={(v) => set({ notifyAbsence: v })} />
                  </div>
                </div>
              </div>
              {canManage && (
                <div className="flex justify-end mt-6">
                  <Button kind="primary" onClick={saveSettings} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === 'account' && <AccountTab session={session} />}
    </>
  );
}

// ---------- My Account tab ----------
function AccountTab({ session }: { session: any }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [devLoading, setDevLoading] = useState(true);

  const roleName = (session?.user as any)?.roleName || '—';
  const perms = ((session?.user as any)?.perms as string[]) || [];

  const loadDevices = useCallback(async () => {
    setDevLoading(true);
    try {
      const res = await fetch('/api/auth/sessions');
      if (res.ok) setDevices(await res.json());
    } finally {
      setDevLoading(false);
    }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const changePassword = async () => {
    setPwMsg(null);
    if (next !== confirm) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return; }
    setPwBusy(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      setPwMsg({ ok: true, text: 'Password changed. Other devices were signed out.' });
      setCur(''); setNext(''); setConfirm('');
      loadDevices();
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setPwBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch('/api/auth/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    loadDevices();
  };
  const signOutOthers = async () => {
    await fetch('/api/auth/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'others' }) });
    loadDevices();
  };

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      {/* Identity */}
      <Card title="Your account">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500">Name</div>
            <div className="text-slate-900 font-medium mt-0.5">{session?.user?.name || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Login</div>
            <div className="text-slate-900 font-medium mt-0.5">{session?.user?.email || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Role</div>
            <div className="mt-0.5"><Chip tone="info">{roleName}</Chip></div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Permissions</div>
            <div className="text-slate-900 font-medium mt-0.5">{perms.length}</div>
          </div>
        </div>
      </Card>

      {/* Change password */}
      <Card title="Change password">
        {pwMsg && (
          <div className={`mb-4 px-3 py-2 rounded-md text-sm ${pwMsg.ok ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>
            {pwMsg.text}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="New password"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Confirm new"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end mt-4">
          <Button kind="primary" onClick={changePassword} disabled={pwBusy || !cur || !next}>{pwBusy ? 'Updating…' : 'Update password'}</Button>
        </div>
      </Card>

      {/* Devices */}
      <Card
        title="Active devices"
        action={devices.length > 1 ? <button onClick={signOutOthers} className="text-sm text-danger-600 hover:text-danger-700">Sign out everywhere else</button> : undefined}
        padded={false}
      >
        {devLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} height={48} />)}</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Icon name="Monitor" size={18} className="text-slate-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900 flex items-center gap-2">
                      {deviceLabel(d.userAgent)}
                      {d.isCurrent && <Chip tone="success">This device</Chip>}
                    </div>
                    <div className="text-xs text-slate-500">{d.ip || 'unknown IP'} · active {relativeTime(d.lastSeenAt)}</div>
                  </div>
                </div>
                {!d.isCurrent && (
                  <button onClick={() => revoke(d.id)} className="text-sm text-slate-400 hover:text-danger-600">Sign out</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
