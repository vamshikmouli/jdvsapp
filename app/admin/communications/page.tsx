'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Card, Drawer, Field, Input, Select, Chip, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { feeMoney } from '@/lib/fees';

interface CircularItem {
  id: string; title: string; body: string; category: string | null; kind: 'CIRCULAR' | 'FEE_REMINDER';
  audience: string; pinned: boolean; archived?: boolean; publishedAt: string; recipients: string; classNames: string[];
}
interface ClassOpt { id: string; name: string }

export default function CommunicationsPage() {
  const [tab, setTab] = useState<'circulars' | 'reminders' | 'devices'>('circulars');
  const [items, setItems] = useState<CircularItem[] | null>(null);
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [composeCircular, setComposeCircular] = useState(false);
  const [composeReminder, setComposeReminder] = useState(false);
  const [editing, setEditing] = useState<CircularItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/circulars${showArchived ? '?archived=1' : ''}`);
    if (r.ok) setItems((await r.json()).items); else setItems([]);
  }, [showArchived]);
  useEffect(() => { load(); (async () => { const r = await fetch('/api/classes'); if (r.ok) setClasses(await r.json()); })(); }, [load]);

  const del = async (id: string) => {
    if (!confirm('Archive this notice? It will be hidden from parents but kept and restorable.')) return;
    await fetch(`/api/circulars?id=${id}`, { method: 'DELETE' });
    load();
  };
  const restore = async (id: string) => {
    await fetch(`/api/circulars?id=${id}&restore=1`, { method: 'DELETE' });
    load();
  };

  const shown = (items || []).filter((c) => (tab === 'reminders' ? c.kind === 'FEE_REMINDER' : c.kind === 'CIRCULAR'));

  return (
    <>
      <PageHeader eyebrow="Administration" title="Communications" meta="Send circulars and fee reminders to parents (shown in the Parent app)."
        actions={tab === 'circulars'
          ? <Button kind="primary" icon="Plus" onClick={() => setComposeCircular(true)}>New circular</Button>
          : tab === 'reminders'
          ? <Button kind="primary" icon="Send" onClick={() => setComposeReminder(true)}>Send fee reminder</Button>
          : undefined}
      />

      <div className="flex items-center gap-1 mt-6 border-b border-slate-200">
        {([['circulars', 'Circulars', 'Megaphone'], ['reminders', 'Fee reminders', 'IndianRupee'], ['devices', 'Installed devices', 'Smartphone']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <Icon name={icon as any} size={16} />{label}
          </button>
        ))}
      </div>

      {tab === 'devices' && <DevicesPanel />}

      {tab !== 'devices' && (
      <div className="mt-5 space-y-3 max-w-3xl">
        <label className="flex items-center justify-end gap-2 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />
          Show archived
        </label>
        {items === null && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={72} rounded="lg" />)}
        {items !== null && shown.length === 0 && (
          <Card><EmptyState icon={tab === 'reminders' ? 'IndianRupee' : 'Megaphone'} title={tab === 'reminders' ? 'No fee reminders sent yet' : 'No circulars yet'} body="Use the button above to create one." /></Card>
        )}
        {shown.map((c) => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {c.category && <Chip tone={c.kind === 'FEE_REMINDER' ? 'danger' : 'info'}>{c.category}</Chip>}
                  {c.pinned && <span className="text-[11px] text-purple-600 inline-flex items-center gap-1"><Icon name="Pin" size={12} />Pinned</span>}
                  <span className="text-[11px] text-slate-400">{new Date(c.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </div>
                <div className="font-semibold text-slate-900">{c.title}</div>
                <p className="text-sm text-slate-600 mt-0.5 line-clamp-2 whitespace-pre-line">{c.body}</p>
                <div className="text-xs text-slate-500 mt-1.5 inline-flex items-center gap-1">
                  <Icon name="Users" size={13} /> {c.recipients}{c.classNames.length ? `: ${c.classNames.join(', ')}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {!c.archived && <button onClick={() => setEditing(c)} className="text-slate-300 hover:text-purple-600 p-1.5" title="Edit"><Icon name="Pencil" size={16} /></button>}
                {c.archived ? (
                  <button onClick={() => restore(c.id)} className="text-slate-300 hover:text-success-600 p-1.5" title="Restore"><Icon name="ArchiveRestore" size={16} /></button>
                ) : (
                  <button onClick={() => del(c.id)} className="text-slate-300 hover:text-amber-600 p-1.5" title="Archive"><Icon name="Archive" size={16} /></button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {composeCircular && <CircularDrawer classes={classes} onClose={() => setComposeCircular(false)} onSent={() => { setComposeCircular(false); load(); }} />}
      {composeReminder && <ReminderDrawer classes={classes} onClose={() => setComposeReminder(false)} onSent={() => { setComposeReminder(false); load(); }} />}
      {editing && <EditDrawer item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

/* ---------- Installed devices (who turned on phone notifications) ---------- */
interface DeviceUser {
  userId: string; name: string; phone: string; children: string[];
  devices: { id: string; device: string; os: string; browser: string; label: string; enabledAt: string; lastUsedAt: string }[];
}
function DevicesPanel() {
  const [data, setData] = useState<{ totalDevices: number; totalUsers: number; users: DeviceUser[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const r = await fetch('/api/push/devices');
    if (r.ok) setData(await r.json()); else { setFailed(true); setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="mt-5 max-w-3xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">
          {data ? <>{data.totalUsers} {data.totalUsers === 1 ? 'parent has' : 'parents have'} turned on phone notifications · {data.totalDevices} {data.totalDevices === 1 ? 'device' : 'devices'}</> : 'Parents who enabled push notifications on their phone.'}
        </p>
        <Button size="sm" icon="RefreshCw" onClick={load}>Refresh</Button>
      </div>

      {data === null && !failed && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={64} rounded="lg" />)}
      {failed && <Card><EmptyState icon="AlertCircle" title="Couldn't load devices" body="Please try again." /></Card>}
      {data && data.users.length === 0 && (
        <Card><EmptyState icon="Smartphone" title="No devices yet" body="When a parent opens the app and taps “Turn on” for notifications, their device shows up here." /></Card>
      )}

      <div className="space-y-3">
        {data?.users.map((u) => (
          <div key={u.userId} className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{u.name}</div>
                <div className="text-xs text-slate-500">{u.phone}{u.children.length ? ` · ${u.children.join(', ')}` : ''}</div>
              </div>
              <Chip tone="success">{u.devices.length} {u.devices.length === 1 ? 'device' : 'devices'}</Chip>
            </div>
            <div className="mt-3 space-y-2">
              {u.devices.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0">
                    <Icon name={/iphone|ipad|android|phone|tablet/i.test(d.device) ? 'Smartphone' : 'Monitor'} size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800">{d.device} <span className="text-slate-400">·</span> {d.browser}</div>
                    <div className="text-[11px] text-slate-500">{d.os || 'Unknown OS'} · enabled {fmtDate(d.enabledAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Circular compose ---------- */
function CircularDrawer({ classes, onClose, onSent }: { classes: ClassOpt[]; onClose: () => void; onSent: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('Notice');
  const [pinned, setPinned] = useState(false);
  const [audience, setAudience] = useState<'SCHOOL' | 'CLASS' | 'STUDENT'>('SCHOOL');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<{ id: string; name: string; className: string | null }[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (audience !== 'STUDENT' || !studentQuery.trim()) { setStudentResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/students?q=${encodeURIComponent(studentQuery)}`);
      if (r.ok) { const d = await r.json(); setStudentResults(d.slice(0, 8).map((s: any) => ({ id: s.id, name: s.name, className: s.class?.name || null }))); }
    }, 250);
    return () => clearTimeout(t);
  }, [studentQuery, audience]);

  const toggleClass = (id: string) => setClassIds((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
  const addStudent = (s: { id: string; name: string }) => { if (!students.find((x) => x.id === s.id)) setStudents((l) => [...l, s]); setStudentQuery(''); setStudentResults([]); };

  const send = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/circulars', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'CIRCULAR', title, body, category, pinned, audience, classIds, studentIds: students.map((s) => s.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      onSent();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Drawer open onClose={onClose} title="New circular" subtitle="Shown in the Parent app" width={560}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" icon="Send" onClick={send} disabled={busy || !title.trim() || !body.trim()}>{busy ? 'Sending…' : 'Send circular'}</Button></div>}>
      <div className="space-y-4">
        {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual Day 2026" /></Field>
        <Field label="Message"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Write the notice…" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{['Notice', 'Event', 'Holiday', 'Exam'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Pin to top"><Select value={pinned ? 'y' : 'n'} onChange={(e) => setPinned(e.target.value === 'y')}><option value="n">No</option><option value="y">Yes</option></Select></Field>
        </div>

        <Field label="Send to">
          <div className="grid grid-cols-3 gap-2">
            {([['SCHOOL', 'Whole school'], ['CLASS', 'Classes'], ['STUDENT', 'Students']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setAudience(v)} className={`py-2 text-xs font-medium rounded-lg border transition-colors ${audience === v ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
        </Field>

        {audience === 'CLASS' && (
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c) => (
              <button key={c.id} onClick={() => toggleClass(c.id)} className={`px-2.5 py-1 rounded-pill text-xs font-medium ${classIds.includes(c.id) ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>{c.name.replace(/\s?STD$/, '')}</button>
            ))}
          </div>
        )}

        {audience === 'STUDENT' && (
          <div>
            <Input icon="Search" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} placeholder="Search student to add…" />
            {studentResults.length > 0 && (
              <div className="mt-1 rounded-lg border border-slate-200 divide-y divide-slate-100">
                {studentResults.map((s) => <button key={s.id} onClick={() => addStudent(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{s.name} <span className="text-xs text-slate-400">{s.className}</span></button>)}
              </div>
            )}
            {students.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {students.map((s) => <span key={s.id} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-2 py-1 text-xs">{s.name}<button onClick={() => setStudents((l) => l.filter((x) => x.id !== s.id))}><Icon name="X" size={12} /></button></span>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ---------- Edit (content only) ---------- */
function EditDrawer({ item, onClose, onSaved }: { item: CircularItem; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [category, setCategory] = useState(item.category || (item.kind === 'FEE_REMINDER' ? 'Fees' : 'Notice'));
  const [pinned, setPinned] = useState(item.pinned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/circulars', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, title, body, category, pinned }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Drawer open onClose={onClose} title={item.kind === 'FEE_REMINDER' ? 'Edit fee reminder' : 'Edit circular'} subtitle="Recipients can't be changed here" width={560}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" onClick={save} disabled={busy || !title.trim() || !body.trim()}>{busy ? 'Saving…' : 'Save changes'}</Button></div>}>
      <div className="space-y-4">
        {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}
        <div className="text-xs text-slate-500 bg-slate-50 rounded-md px-3 py-2 inline-flex items-center gap-1"><Icon name="Users" size={13} /> {item.recipients}{item.classNames.length ? `: ${item.classNames.join(', ')}` : ''} — to change recipients, delete and recreate.</div>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Message"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" /></Field>
        <div className="grid grid-cols-2 gap-4">
          {item.kind !== 'FEE_REMINDER' && <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{['Notice', 'Event', 'Holiday', 'Exam'].map((c) => <option key={c}>{c}</option>)}</Select></Field>}
          <Field label="Pin to top"><Select value={pinned ? 'y' : 'n'} onChange={(e) => setPinned(e.target.value === 'y')}><option value="n">No</option><option value="y">Yes</option></Select></Field>
        </div>
      </div>
    </Drawer>
  );
}

/* ---------- Fee reminder compose ---------- */
function ReminderDrawer({ classes, onClose, onSent }: { classes: ClassOpt[]; onClose: () => void; onSent: () => void }) {
  const [recipients, setRecipients] = useState<'school' | 'dues'>('dues');
  const [mode, setMode] = useState<'all' | 'overdue' | 'above'>('all');
  const [minBalance, setMinBalance] = useState('');
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('Fee payment reminder');
  const [body, setBody] = useState('This is a reminder that fees are pending for your child. Kindly clear the dues at the school office. You can see the balance in the Fees tab.');
  const [preview, setPreview] = useState<{ count: number; totalDue: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (recipients !== 'dues') { setPreview(null); return; }
    const t = setTimeout(async () => {
      const sp = new URLSearchParams({ mode, minBalance: minBalance || '0', ...(classId ? { classId } : {}) });
      const r = await fetch(`/api/circulars/fee-preview?${sp}`);
      if (r.ok) setPreview(await r.json());
    }, 300);
    return () => clearTimeout(t);
  }, [recipients, mode, minBalance, classId]);

  const send = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/circulars', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'FEE_REMINDER', title, body, pinned: true, feeScope: recipients === 'school' ? 'school' : mode, minBalance: Number(minBalance) || 0, classId: classId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      onSent();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Drawer open onClose={onClose} title="Send fee reminder" subtitle="Shown in the Parent app" width={560}
      footer={<div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{recipients === 'school' ? 'Whole school' : preview ? `${preview.count} students · ${feeMoney(preview.totalDue)} due` : '…'}</span>
        <div className="flex gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" icon="Send" onClick={send} disabled={busy || !title.trim() || (recipients === 'dues' && preview?.count === 0)}>{busy ? 'Sending…' : 'Send'}</Button></div>
      </div>}>
      <div className="space-y-4">
        {error && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{error}</div>}
        <Field label="Recipients">
          <div className="grid grid-cols-2 gap-2">
            {([['school', 'Whole school'], ['dues', 'Students with dues']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setRecipients(v)} className={`py-2 text-xs font-medium rounded-lg border ${recipients === v ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
        </Field>

        {recipients === 'dues' && (
          <div className="rounded-lg border border-slate-200 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Who"><Select value={mode} onChange={(e) => setMode(e.target.value as any)}>
                <option value="all">Anyone with a balance</option>
                <option value="overdue">Past due date only</option>
                <option value="above">Balance above ₹…</option>
              </Select></Field>
              {mode === 'above' && <Field label="Min balance (₹)"><Input type="number" value={minBalance} onChange={(e) => setMinBalance(e.target.value)} placeholder="5000" /></Field>}
              <Field label="Class (optional)"><Select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            </div>
            <div className="text-sm text-slate-600 bg-slate-50 rounded-md px-3 py-2">
              {preview ? <><b className="text-slate-900">{preview.count}</b> students will be reminded · <b className="text-danger-700">{feeMoney(preview.totalDue)}</b> total due</> : 'Calculating…'}
            </div>
          </div>
        )}

        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Message"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" /></Field>
      </div>
    </Drawer>
  );
}
