'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, Input, Select, EmptyState, Skeleton, Chip } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

/* ---------- shared bits ---------- */
const CATEGORIES = ['FEES', 'STUDENTS', 'STAFF', 'PAYROLL', 'ROLES', 'CONFIG', 'MARKS'] as const;
const CAT_META: Record<string, { label: string; icon: string; chip: string }> = {
  FEES: { label: 'Fees', icon: 'CreditCard', chip: 'bg-success-100 text-success-700' },
  STUDENTS: { label: 'Students', icon: 'Users', chip: 'bg-purple-100 text-purple-700' },
  STAFF: { label: 'Staff', icon: 'UserCog', chip: 'bg-info-100 text-info-700' },
  PAYROLL: { label: 'Payroll', icon: 'Wallet', chip: 'bg-marigold-100 text-marigold-700' },
  ROLES: { label: 'Roles', icon: 'Lock', chip: 'bg-danger-100 text-danger-700' },
  CONFIG: { label: 'Setup', icon: 'Settings', chip: 'bg-slate-200 text-slate-700' },
  MARKS: { label: 'Marks', icon: 'ClipboardList', chip: 'bg-info-100 text-info-700' },
  OTHER: { label: 'Other', icon: 'Activity', chip: 'bg-slate-100 text-slate-600' },
};
const catMeta = (c: string) => CAT_META[c] || CAT_META.OTHER;

const fmtWhen = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || 'Browser';
}

export default function ActivityPage() {
  const [tab, setTab] = useState<'activity' | 'logins'>('activity');
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold font-display text-slate-900 flex items-center gap-2"><Icon name="ScrollText" size={20} className="text-purple-600" /> Activity log</h1>
        <p className="text-sm text-slate-500 mt-0.5">Who signed in and what they did in the system.</p>
      </div>
      <div className="flex gap-1.5 mb-4">
        {([['activity', 'Activity', 'Activity'], ['logins', 'Logins & devices', 'LogIn']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${tab === id ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <Icon name={icon as any} size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === 'activity' ? <ActivityTab /> : <LoginsTab />}
    </div>
  );
}

/* ---------- Activity ---------- */
interface ActivityItem { id: string; userId: string | null; userName: string; roleKey: string | null; category: string; action: string; summary: string; ip: string | null; createdAt: string }

function ActivityTab() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [actors, setActors] = useState<{ userId: string; userName: string }[]>([]);
  const [cat, setCat] = useState('');
  const [user, setUser] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = React.useCallback(() => {
    setItems(null); setError('');
    const p = new URLSearchParams();
    if (cat) p.set('category', cat);
    if (user) p.set('userId', user);
    if (q.trim()) p.set('q', q.trim());
    fetch(`/api/admin/activity?${p}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d) => { setItems(d.items || []); setActors(d.actors || []); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [cat, user, q]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setCat('')} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${!cat ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(cat === c ? '' : c)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${cat === c ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <Icon name={catMeta(c).icon as any} size={12} /> {catMeta(c).label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Select value={user} onChange={(e) => setUser(e.target.value)} className="w-40">
            <option value="">All users</option>
            {actors.map((a) => <option key={a.userId} value={a.userId}>{a.userName}</option>)}
          </Select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-44" />
        </div>
      </div>

      {items === null && !error && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={54} rounded="lg" />)}</div>}
      {error && <Card><EmptyState icon="AlertCircle" title="Couldn't load" body={error} /></Card>}
      {items && items.length === 0 && <Card><EmptyState icon="Activity" title="No activity yet" body="Actions people take (payments, edits, fee changes…) will appear here." /></Card>}
      {items && items.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs divide-y divide-slate-100 overflow-hidden">
          {items.map((it) => {
            const m = catMeta(it.category);
            return (
              <div key={it.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60 transition-colors">
                <span className={`mt-0.5 w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${m.chip}`}><Icon name={m.icon as any} size={15} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800">{it.summary}</div>
                  <div className="text-[11.5px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium text-slate-600">{it.userName}</span>
                    {it.roleKey && <span className="text-slate-400">· {it.roleKey}</span>}
                    <span className="text-slate-300">·</span>
                    <span>{fmtWhen(it.createdAt)}</span>
                    {it.ip && <><span className="text-slate-300">·</span><span className="font-mono text-[10.5px]">{it.ip}</span></>}
                  </div>
                </div>
                <div className="flex-shrink-0"><Chip tone="neutral">{m.label}</Chip></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Logins & devices ---------- */
interface Audit { id: string; type: string; at: string; ip: string | null; userAgent: string | null; detail: string | null; name: string; role: string | null; email: string | null }
interface Sess { id: string; name: string; role: string | null; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string }
const AUDIT_META: Record<string, { label: string; tone: 'success' | 'danger' | 'neutral' | 'warn'; icon: string }> = {
  LOGIN: { label: 'Signed in', tone: 'success', icon: 'LogIn' },
  LOGOUT: { label: 'Signed out', tone: 'neutral', icon: 'LogOut' },
  LOGIN_FAILED: { label: 'Failed login', tone: 'danger', icon: 'ShieldAlert' },
  PASSWORD_RESET: { label: 'PIN reset', tone: 'warn', icon: 'KeyRound' },
  PASSWORD_CHANGED: { label: 'PIN changed', tone: 'neutral', icon: 'KeyRound' },
  ROLE_REASSIGNED: { label: 'Role changed', tone: 'warn', icon: 'Lock' },
  ROLE_PERMISSIONS_CHANGED: { label: 'Permissions changed', tone: 'warn', icon: 'Lock' },
  SESSION_REVOKED: { label: 'Device signed out', tone: 'neutral', icon: 'Smartphone' },
};

function LoginsTab() {
  const [data, setData] = useState<{ audits: Audit[]; sessions: Sess[] } | null>(null);
  const [type, setType] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    const p = new URLSearchParams(); if (type) p.set('type', type);
    fetch(`/api/admin/logins?${p}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [type]);

  return (
    <div className="space-y-5">
      {/* Active devices */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg grid place-items-center bg-success-100 text-success-700"><Icon name="MonitorSmartphone" size={15} /></span>
          <span className="text-sm font-bold text-slate-900">Currently signed in</span>
          <span className="ml-auto text-xs text-slate-400">{data ? `${data.sessions.length} device${data.sessions.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        {!data && !error && <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>}
        {data && data.sessions.length === 0 && <div className="px-5 py-6 text-center text-sm text-slate-400">Nobody is signed in right now.</div>}
        {data && data.sessions.length > 0 && (
          <div className="divide-y divide-slate-100">
            {data.sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Icon name="Circle" size={9} className="text-success-500 fill-success-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-800">{s.name}</span>
                  {s.role && <span className="text-slate-400 text-xs"> · {s.role}</span>}
                  <div className="text-[11.5px] text-slate-500">{deviceLabel(s.userAgent)}{s.ip ? ` · ${s.ip}` : ''}</div>
                </div>
                <span className="text-[11.5px] text-slate-400 flex-shrink-0">active {fmtWhen(s.lastSeenAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Login history */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-slate-900">Sign-in history</span>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="ml-auto w-40">
            <option value="">All events</option>
            <option value="LOGIN">Sign-ins</option>
            <option value="LOGIN_FAILED">Failed logins</option>
            <option value="LOGOUT">Sign-outs</option>
            <option value="PASSWORD_RESET">PIN resets</option>
            <option value="ROLE_REASSIGNED">Role changes</option>
          </Select>
        </div>
        {!data && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={48} />)}</div>}
        {error && <Card><EmptyState icon="AlertCircle" title="Couldn't load" body={error} /></Card>}
        {data && data.audits.length === 0 && <Card><EmptyState icon="LogIn" title="Nothing here yet" body="Sign-in events will appear here." /></Card>}
        {data && data.audits.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs divide-y divide-slate-100 overflow-hidden">
            {data.audits.map((a) => {
              const m = AUDIT_META[a.type] || { label: a.type, tone: 'neutral' as const, icon: 'Activity' };
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${m.tone === 'danger' ? 'bg-danger-100 text-danger-700' : m.tone === 'success' ? 'bg-success-100 text-success-700' : m.tone === 'warn' ? 'bg-marigold-100 text-marigold-700' : 'bg-slate-100 text-slate-600'}`}><Icon name={m.icon as any} size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800"><span className="font-medium">{a.name}</span> <span className="text-slate-500">— {m.label}</span></div>
                    <div className="text-[11.5px] text-slate-500 flex flex-wrap items-center gap-x-2">
                      {a.role && <span>{a.role}</span>}
                      <span>{fmtWhen(a.at)}</span>
                      <span className="text-slate-300">·</span>
                      <span>{deviceLabel(a.userAgent)}</span>
                      {a.ip && <><span className="text-slate-300">·</span><span className="font-mono text-[10.5px]">{a.ip}</span></>}
                      {a.detail && <><span className="text-slate-300">·</span><span>{a.detail}</span></>}
                    </div>
                  </div>
                  <Chip tone={m.tone}>{m.label}</Chip>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
