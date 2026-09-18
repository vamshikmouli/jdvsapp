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
  const [tab, setTab] = useState<'circulars' | 'reminders' | 'monthly' | 'replies' | 'devices' | 'analytics'>('circulars');
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
  // Deep-link: /admin/communications?tab=replies opens a specific tab (used by the
  // "new parent reply" push notification).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && ['circulars', 'reminders', 'monthly', 'replies', 'analytics', 'devices'].includes(t)) setTab(t as typeof tab);
  }, []);

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

      <div className="flex flex-nowrap items-center gap-1 mt-6 border-b border-slate-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {([['circulars', 'Circulars', 'Megaphone'], ['reminders', 'Fee reminders', 'IndianRupee'], ['monthly', 'Monthly attendance', 'CalendarCheck'], ['replies', 'Replies', 'MessageSquare'], ['analytics', 'Analytics', 'BarChart3'], ['devices', 'Installed devices', 'Smartphone']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex flex-shrink-0 whitespace-nowrap items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <Icon name={icon as any} size={16} />{label}
          </button>
        ))}
      </div>

      {tab === 'devices' && <DevicesPanel />}
      {tab === 'analytics' && <AnalyticsPanel />}
      {tab === 'replies' && <RepliesPanel />}
      {tab === 'monthly' && <MonthlyAttendancePanel classes={classes} />}

      {tab !== 'devices' && tab !== 'analytics' && tab !== 'replies' && tab !== 'monthly' && (
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

/* ---------- Monthly attendance: appreciation/improvement image + message ---------- */
type Tier = 'perfect' | 'great' | 'good' | 'low';
interface MonthStudent { student: string; className: string | null; tier: Tier; pct: number; status: string; to?: string; error?: string }
interface MonthResult { monthLabel: string; total: number; sent: number; failed: number; skipped: number; tiers: Record<Tier, number>; details: MonthStudent[]; waConfigured?: boolean }
const TIER_META: Record<Tier, { label: string; chip: string; dot: string }> = {
  perfect: { label: 'All present', chip: 'bg-success-50 text-success-700 border-success-100', dot: 'bg-success-500' },
  great: { label: '90%+', chip: 'bg-info-50 text-info-700 border-info-100', dot: 'bg-info-500' },
  good: { label: '75–90%', chip: 'bg-marigold-50 text-marigold-700 border-marigold-100', dot: 'bg-marigold-500' },
  low: { label: 'Below 75%', chip: 'bg-danger-50 text-danger-700 border-danger-100', dot: 'bg-danger-500' },
};
function prevMonthStr(): string {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function MonthlyAttendancePanel({ classes }: { classes: ClassOpt[] }) {
  const [month, setMonth] = useState(prevMonthStr());
  const [classId, setClassId] = useState('');
  const [preview, setPreview] = useState<MonthResult | null>(null);
  const [result, setResult] = useState<MonthResult | null>(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'' | 'preview' | 'send' | 'test'>('');
  const [err, setErr] = useState('');

  const runPreview = async () => {
    setBusy('preview'); setErr(''); setResult(null);
    try {
      const sp = new URLSearchParams({ month }); if (classId) sp.set('classId', classId);
      const r = await fetch(`/api/attendance/monthly-report?${sp}`);
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Preview failed');
      setPreview(d);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Preview failed'); }
    finally { setBusy(''); }
  };

  const send = async (test = false) => {
    if (!test && !confirm(`Send monthly attendance for ${preview?.monthLabel || month} to ${preview?.total ?? 'all'} students' parents on WhatsApp?`)) return;
    setBusy(test ? 'test' : 'send'); setErr('');
    try {
      const body: any = { month }; if (classId) body.classId = classId; if (test) body.to = testTo.trim();
      const r = await fetch('/api/attendance/monthly-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Send failed');
      setResult(d);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Send failed'); }
    finally { setBusy(''); }
  };

  const view = result || preview;
  return (
    <div className="mt-5 max-w-4xl space-y-4">
      <p className="text-sm text-slate-500">Send each student's monthly attendance calendar as a WhatsApp image, with a personalised message — praise for good attendance, encouragement to improve where it's low. Leaves are shown but don't count against the student.</p>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-3 items-end">
          <Field label="Month"><Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPreview(null); setResult(null); }} /></Field>
          <Field label="Class"><Select value={classId} onChange={(e) => { setClassId(e.target.value); setPreview(null); setResult(null); }}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select></Field>
          <Button icon="Eye" onClick={runPreview} disabled={busy === 'preview'}>{busy === 'preview' ? 'Checking…' : 'Preview'}</Button>
        </div>
        {err && <div className="mt-3 bg-danger-50 border border-danger-100 rounded-lg p-2.5 text-sm text-danger-700">{err}</div>}
      </Card>

      {view && (
        <Card>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">{view.monthLabel}</div>
              <div className="text-[13px] text-slate-500">{result ? <>Sent {result.sent} · failed {result.failed} · skipped {result.skipped}</> : <>{view.total} student{view.total === 1 ? '' : 's'} with attendance data</>}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['perfect', 'great', 'good', 'low'] as Tier[]).map((t) => (
                <span key={t} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${TIER_META[t].chip}`}>
                  <span className={`w-2 h-2 rounded-full ${TIER_META[t].dot}`} />{TIER_META[t].label}: {view.tiers[t]}
                </span>
              ))}
            </div>
          </div>

          {view.waConfigured === false && <div className="mt-3 bg-marigold-50 border border-marigold-100 rounded-lg p-2.5 text-[13px] text-marigold-700">WhatsApp isn't configured on the server, so nothing can be sent yet.</div>}

          {!result && view.total > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <label className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Test to a number first (optional)</label>
                  <div className="flex gap-2 mt-1">
                    <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="9XXXXXXXXX" className="max-w-[180px]" />
                    <Button icon="Send" onClick={() => send(true)} disabled={busy === 'test' || !testTo.trim()}>{busy === 'test' ? 'Sending…' : 'Send test'}</Button>
                  </div>
                </div>
                <Button kind="primary" icon="Send" onClick={() => send(false)} disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : `Send to ${view.total} student(s)`}</Button>
              </div>
            </div>
          )}

          <div className="mt-4 max-h-[46vh] overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
            {view.details.map((d, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <div className="min-w-0"><span className="font-medium text-slate-800">{d.student}</span> <span className="text-slate-400">{d.className || ''}</span></div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TIER_META[d.tier].chip}`}><span className={`w-1.5 h-1.5 rounded-full ${TIER_META[d.tier].dot}`} />{d.pct}%</span>
                  {d.status === 'sent' && <span className="text-success-600 text-[11.5px] inline-flex items-center gap-0.5"><Icon name="Check" size={13} />sent</span>}
                  {d.status === 'failed' && <span className="text-danger-600 text-[11.5px]" title={d.error || ''}>failed</span>}
                  {d.status === 'skipped' && <span className="text-slate-400 text-[11.5px]" title={d.error || ''}>no number</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- Replies: two-way WhatsApp inbox (parent replies + office reply) ---------- */
interface ReplyThread {
  phone: string; studentId: string | null; studentName: string | null; contactName: string | null;
  lastText: string | null; lastAt: string; lastDirection: string; unread: number; canReply: boolean; windowEndsAt: string | null;
}
interface ThreadMsg { id: string; direction: string; text: string | null; type: string; at: string; error: string | null; contactName: string | null; system?: boolean; kind?: string | null; status?: string | null }

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
function windowLeft(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'closed';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

function RepliesPanel() {
  const [threads, setThreads] = useState<ReplyThread[] | null>(null);
  const [sel, setSel] = useState<ReplyThread | null>(null);
  const [msgs, setMsgs] = useState<ThreadMsg[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  const loadThreads = useCallback(async () => {
    const r = await fetch('/api/whatsapp/replies');
    if (r.ok) setThreads((await r.json()).threads); else setThreads([]);
  }, []);
  useEffect(() => { loadThreads(); }, [loadThreads]);

  const openThread = async (t: ReplyThread) => {
    setSel(t); setMsgs(null); setErr('');
    const r = await fetch(`/api/whatsapp/replies?phone=${encodeURIComponent(t.phone)}`);
    if (r.ok) setMsgs((await r.json()).messages); else setMsgs([]);
    loadThreads(); // clear the unread badge (server marked it handled)
  };

  const send = async () => {
    if (!sel || !text.trim()) return;
    setSending(true); setErr('');
    try {
      const r = await fetch('/api/whatsapp/replies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: sel.phone, text: text.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not send');
      setMsgs(d.messages); setText(''); loadThreads();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send'); }
    finally { setSending(false); }
  };

  return (
    <div className="mt-5">
      <p className="text-sm text-slate-500 mb-3 max-w-2xl">Parent replies to your WhatsApp messages land here. You can reply for free within <b>24 hours</b> of their last message; after that, they must message again first.</p>
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
        {/* thread list */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="text-sm font-bold text-slate-900">Conversations</div>
            <button onClick={loadThreads} className="text-slate-400 hover:text-purple-600" title="Refresh"><Icon name="RefreshCw" size={15} /></button>
          </div>
          <div className="max-h-[64vh] overflow-y-auto divide-y divide-slate-50">
            {threads === null && Array.from({ length: 4 }).map((_, i) => <div key={i} className="p-3"><Skeleton height={44} /></div>)}
            {threads !== null && threads.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-slate-400"><Icon name="Inbox" size={26} className="mx-auto mb-2 text-slate-300" />No replies yet.</div>
            )}
            {(threads || []).map((t) => (
              <button key={t.phone} onClick={() => openThread(t)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${sel?.phone === t.phone ? 'bg-purple-50/60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800 text-sm truncate">{t.studentName || t.contactName || t.phone}</div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {t.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-purple-600 text-white text-[10px] font-bold grid place-items-center">{t.unread}</span>}
                    <span className="text-[10.5px] text-slate-400">{fmtTime(t.lastAt).split(',')[0]}</span>
                  </div>
                </div>
                <div className="text-[12px] text-slate-500 truncate mt-0.5">{t.contactName ? `${t.contactName} · ` : ''}{t.phone}</div>
                <div className="text-[12.5px] text-slate-600 truncate mt-0.5">{t.lastDirection === 'OUT' ? <span className="text-slate-400">You: </span> : ''}{t.lastText || <span className="italic text-slate-400">({'media'})</span>}</div>
              </button>
            ))}
          </div>
        </div>

        {/* conversation */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden min-h-[420px] flex flex-col">
          {!sel ? (
            <div className="flex-1 grid place-items-center text-center p-10 text-slate-400">
              <div><Icon name="MessageSquare" size={30} className="mx-auto mb-2 text-slate-300" />Pick a conversation to read and reply.</div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="font-bold text-slate-900 text-sm">{sel.studentName || sel.contactName || sel.phone}</div>
                <div className="text-[12px] text-slate-500">{sel.contactName ? `${sel.contactName} · ` : ''}{sel.phone}
                  {sel.studentName && <span className="ml-1 text-slate-400">· student</span>}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/60 max-h-[52vh]">
                {msgs === null ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={34} />) :
                  msgs.length === 0 ? <div className="text-center text-sm text-slate-400 py-8">No messages.</div> :
                  msgs.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}>
                      {m.system ? (
                        // Something the app sent to this parent (reminder, alert, receipt…) — shown for context.
                        <div className="max-w-[82%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] bg-slate-100 border border-slate-200 text-slate-700">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5 inline-flex items-center gap-1"><Icon name="Send" size={10} /> {kindLabel(m.kind || '')}</div>
                          <div className="whitespace-pre-wrap break-words">{m.text || <span className="italic opacity-70">Message sent</span>}</div>
                          <div className="text-[10px] mt-1 text-slate-400">{fmtTime(m.at)}{m.status ? ` · ${DELIVERY_LABEL[m.status] || m.status}` : ''}</div>
                        </div>
                      ) : (
                        <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-[13px] ${m.direction === 'OUT' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                          <div className="whitespace-pre-wrap break-words">{m.text || <span className="italic opacity-70">({m.type})</span>}</div>
                          <div className={`text-[10px] mt-1 ${m.direction === 'OUT' ? 'text-purple-100' : 'text-slate-400'}`}>{fmtTime(m.at)}{m.error ? ` · failed: ${m.error}` : ''}</div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              {err && <div className="mx-4 mt-2 text-[12.5px] text-danger-700 bg-danger-50 border border-danger-100 rounded-lg px-3 py-2">{err}</div>}
              <div className="border-t border-slate-100 p-3">
                {sel.canReply ? (
                  <>
                    <div className="flex items-end gap-2">
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Type a reply…"
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
                        className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400" />
                      <Button kind="primary" icon="Send" onClick={send} disabled={sending || !text.trim()}>{sending ? '…' : 'Send'}</Button>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1"><Icon name="Clock" size={12} /> Reply window: {windowLeft(sel.windowEndsAt)} · Ctrl+Enter to send</div>
                  </>
                ) : (
                  <div className="text-[12.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                    <Icon name="Clock" size={14} className="text-slate-400" />
                    The 24-hour reply window has closed. WhatsApp only allows a free reply within 24h of the parent's last message — they'll need to message again first.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Analytics: fee-reminder WhatsApp delivery (persisted) ---------- */
interface DeliveryRow { student: string; className: string | null; recipient: string; phone: string; status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; error: string | null }
const DELIVERY_LABEL: Record<string, string> = { SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed' };
interface DeliveryBatch { batchId: string; kind: string; title: string | null; at: string; sent: number; failed: number; rows: DeliveryRow[] }
interface DeliveryGroup { kind: string; total: number; batches: DeliveryBatch[] }

// Friendly names + a default per-batch title for each message kind.
const KIND_LABEL: Record<string, string> = {
  FEE_REMINDER: 'Fee reminders',
  FEE_RECEIPT: 'Fee receipts',
  ATTENDANCE_REMINDER: 'Attendance reminders',
  ATTENDANCE_ABSENCE: 'Absence & leave alerts',
  ATTENDANCE_MONTHLY: 'Monthly attendance',
  STAFF_ATTENDANCE_REPORT: 'Attendance reports',
  ADMIN_REPORT: 'Daily reports',
  ADMIN_ALERT: 'Admin alerts',
  LOGIN_OTP: 'Login codes',
};
const kindLabel = (k: string) => KIND_LABEL[k] || k.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const defaultTitle = (k: string) => KIND_LABEL[k] ? KIND_LABEL[k].replace(/s$/, '') : 'Message';

function AnalyticsPanel() {
  const [groups, setGroups] = useState<DeliveryGroup[] | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/circulars/reminder-log')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d) => { const g: DeliveryGroup[] = d.groups || []; setGroups(g); setTab((cur) => cur ?? (g[0]?.kind || null)); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const shortCls = (c: string | null) => (c || '—').replace(/\s?STD$/i, '');
  const active = groups?.find((g) => g.kind === tab) || groups?.[0];
  const batches = active?.batches || [];

  return (
    <div className="mt-5 max-w-3xl space-y-3">
      <p className="text-sm text-slate-500">Every WhatsApp message the app sends — grouped by type — with each number's live delivery status. Saved, so you can review any time.</p>
      {groups === null && !error && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={72} rounded="lg" />)}
      {error && <Card><EmptyState icon="AlertCircle" title="Couldn't load" body={error} /></Card>}
      {groups && groups.length === 0 && <Card><EmptyState icon="BarChart3" title="No messages sent yet" body="When the app sends anything on WhatsApp, its delivery report appears here." /></Card>}
      {groups && groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <button key={g.kind} onClick={() => setTab(g.kind)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors ${(active?.kind === g.kind) ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              {kindLabel(g.kind)} <span className="text-[11px] font-medium text-slate-400">{g.total}</span>
            </button>
          ))}
        </div>
      )}
      {batches.map((b) => {
        const total = b.sent + b.failed;
        const isOpen = open.has(b.batchId);
        return (
          <div key={b.batchId} className="bg-white rounded-xl border border-slate-200 shadow-xs">
            <button onClick={() => toggle(b.batchId)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 truncate">{b.title || defaultTitle(b.kind)}</div>
                <div className="text-xs text-slate-500 mt-0.5">{new Date(b.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {total} number{total === 1 ? '' : 's'}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Chip tone="success">{b.sent} sent</Chip>
                {b.failed > 0 && <Chip tone="danger">{b.failed} failed</Chip>}
                <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-slate-400" />
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 max-h-80 overflow-y-auto divide-y divide-slate-100">
                {[...b.rows].sort((x, y) => Number(y.status === 'FAILED') - Number(x.status === 'FAILED')).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate">{r.student} <span className="text-slate-400">· {shortCls(r.className)}</span></div>
                      <div className="text-slate-500 truncate">{r.recipient}{r.phone && r.phone !== '—' ? ` · ${r.phone}` : ''}</div>
                    </div>
                    {r.status === 'FAILED'
                      ? <span className="flex-shrink-0 text-danger-700 font-medium text-right max-w-[55%] truncate" title={r.error || ''}>Failed{r.error ? `: ${r.error}` : ''}</span>
                      : <span className="flex-shrink-0 inline-flex items-center gap-1 text-success-700 font-medium"><Icon name={r.status === 'READ' ? 'CheckCheck' : 'Check'} size={13} /> {DELIVERY_LABEL[r.status] || 'Sent'}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
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
  // Same personalized template as Fees → Notify parents (mirrors the approved
  // WhatsApp "school_fee_reminder"). Tokens are filled per student.
  const [body, setBody] = useState(`Dear {guardian},
Fee reminder from Jnana Deepika Vidhya Samsthe.
Student: {name} — Class {class}
Outstanding balance: {balance}
{breakup}
Please pay at the school office. Thank you.`);
  const [preview, setPreview] = useState<{ count: number; totalDue: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; waSent?: number; waFailed?: number; pushSent: number; skippedZero?: number; waDetails?: { student: string; className: string | null; name: string; to: string; ok: boolean; error?: string }[] } | null>(null);

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
      // Personalized per student + WhatsApp to both parents (same flow as Fees → Notify parents).
      const res = await fetch('/api/circulars/bulk-reminder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, feeScope: recipients === 'school' ? 'school' : 'dues', mode, minBalance: Number(minBalance) || 0, classId: classId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  if (result) {
    return (
      <Drawer open onClose={onSent} title="Fee reminders sent" subtitle="Delivery summary" width={560}
        footer={<div className="flex justify-end"><Button kind="primary" onClick={onSent}>Done</Button></div>}>
        <div className="text-center py-4">
          <div className="w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mx-auto mb-3"><Icon name="Check" size={26} /></div>
          <p className="text-sm text-slate-700"><span className="font-semibold">{result.created}</span> personalized reminder{result.created === 1 ? '' : 's'} created.</p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-lg border border-slate-200 px-3 py-2.5 text-center"><div className="text-base font-bold tabular-nums text-success-700">{result.waSent ?? 0}</div><div className="text-[11px] text-slate-500 mt-0.5">WhatsApp sent</div></div>
          <div className="rounded-lg border border-slate-200 px-3 py-2.5 text-center"><div className={`text-base font-bold tabular-nums ${(result.waFailed ?? 0) > 0 ? 'text-danger-700' : 'text-slate-400'}`}>{result.waFailed ?? 0}</div><div className="text-[11px] text-slate-500 mt-0.5">WhatsApp failed</div></div>
          <div className="rounded-lg border border-slate-200 px-3 py-2.5 text-center"><div className="text-base font-bold tabular-nums text-slate-900">{result.pushSent ?? 0}</div><div className="text-[11px] text-slate-500 mt-0.5">Phone alerts</div></div>
        </div>
        {(result.waFailed ?? 0) > 0 && (
          <p className="text-xs text-slate-500 mt-3">WhatsApp failures usually mean no valid number, or the parent hasn’t used WhatsApp / has blocked business messages. The in-app reminder still reaches them in the Parent app.</p>
        )}

        {result.waDetails && result.waDetails.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-slate-600 mb-1.5">Per-number delivery ({result.waDetails.length})</div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {[...result.waDetails].sort((a, b) => Number(a.ok) - Number(b.ok)).map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{d.student} <span className="text-slate-400">· {(d.className || '—').replace(/\s?STD$/i, '')}</span></div>
                    <div className="text-slate-500 truncate">{d.name}{d.to ? ` · ${d.to}` : ''}</div>
                  </div>
                  {d.ok
                    ? <span className="flex-shrink-0 inline-flex items-center gap-1 text-success-700 font-medium"><Icon name="Check" size={13} /> Sent</span>
                    : <span className="flex-shrink-0 text-danger-700 font-medium text-right max-w-[45%] truncate" title={d.error}>Failed{d.error ? `: ${d.error}` : ''}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
    );
  }

  return (
    <Drawer open onClose={onClose} title="Send fee reminder" subtitle="Personalized per student · Parent app, phone & WhatsApp" width={560}
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
        <Field label="Message" hint="Filled per student: {name} {firstname} {class} {guardian} {balance} {breakup}. On WhatsApp the approved template goes to the father, mother & fee-contact numbers.">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" />
        </Field>
      </div>
    </Drawer>
  );
}
