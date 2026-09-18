'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

// Two-way WhatsApp inbox, styled like a chat app. Parent replies land here; the
// office can reply within WhatsApp's 24h window. Everything the app sent to a number
// (reminders, alerts, receipts…) shows inline for context.
interface ReplyThread {
  phone: string; studentId: string | null; studentName: string | null; contactName: string | null;
  lastText: string | null; lastAt: string; lastDirection: string; unread: number; canReply: boolean; windowEndsAt: string | null;
}
interface ThreadMsg { id: string; direction: string; text: string | null; type: string; at: string; error: string | null; contactName: string | null; system?: boolean; kind?: string | null; status?: string | null }

const KIND_LABEL: Record<string, string> = {
  FEE_REMINDER: 'Fee reminder', FEE_RECEIPT: 'Fee receipt', ATTENDANCE_REMINDER: 'Attendance reminder',
  ATTENDANCE_ABSENCE: 'Absence/leave alert', ATTENDANCE_MONTHLY: 'Monthly attendance', ABSENCE_STREAK: '3+ day absentee',
  STAFF_ATTENDANCE_REPORT: 'Attendance report', ADMIN_REPORT: 'Daily report', ADMIN_ALERT: 'Admin alert',
  ANNOUNCEMENT: 'Announcement', LOGIN_OTP: 'Login code',
};
const kindLabel = (k: string) => KIND_LABEL[k] || k.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const DELIVERY_LABEL: Record<string, string> = { SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed' };
const WA_GREEN = '#d9fdd3';           // outgoing bubble (like WhatsApp)
const WA_BG = '#efeae2';              // chat background

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
function windowLeft(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'closed';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
const initials = (s: string) => s.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// WhatsApp-style delivery ticks for an outgoing message.
function Ticks({ status }: { status?: string | null }) {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === 'FAILED') return <Icon name="AlertCircle" size={12} className="inline text-danger-500" />;
  if (s === 'READ') return <Icon name="CheckCheck" size={14} className="inline text-sky-500" />;
  if (s === 'DELIVERED') return <Icon name="CheckCheck" size={14} className="inline text-slate-400" />;
  return <Icon name="Check" size={13} className="inline text-slate-400" />; // SENT
}

export default function WhatsAppInbox() {
  const [threads, setThreads] = useState<ReplyThread[] | null>(null);
  const [sel, setSel] = useState<ReplyThread | null>(null);
  const [msgs, setMsgs] = useState<ThreadMsg[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  // Keep the newest message + composer in view when a thread opens or a reply is sent.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const loadThreads = useCallback(async () => {
    const r = await fetch('/api/whatsapp/replies');
    if (r.ok) setThreads((await r.json()).threads); else setThreads([]);
  }, []);
  useEffect(() => { loadThreads(); }, [loadThreads]);

  const openThread = async (t: ReplyThread) => {
    setSel(t); setMsgs(null); setErr('');
    const r = await fetch(`/api/whatsapp/replies?phone=${encodeURIComponent(t.phone)}`);
    if (r.ok) setMsgs((await r.json()).messages); else setMsgs([]);
    loadThreads();
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

  const title = (t: { studentName: string | null; contactName: string | null; phone: string }) => t.studentName || t.contactName || t.phone;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[330px_1fr] rounded-2xl border border-slate-200 overflow-hidden bg-white" style={{ height: 'calc(100vh - 230px)', minHeight: 440, maxHeight: 760 }}>
      {/* Conversation list */}
      <div className={`flex-col border-r border-slate-200 ${sel ? 'hidden md:flex' : 'flex'}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="text-sm font-bold text-slate-900 inline-flex items-center gap-2"><Icon name="MessagesSquare" size={16} className="text-emerald-600" /> Chats</div>
          <button onClick={loadThreads} className="text-slate-400 hover:text-emerald-600" title="Refresh"><Icon name="RefreshCw" size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          {threads === null && Array.from({ length: 6 }).map((_, i) => <div key={i} className="p-3"><Skeleton height={44} /></div>)}
          {threads !== null && threads.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-slate-400"><Icon name="Inbox" size={28} className="mx-auto mb-2 text-slate-300" />No conversations yet.</div>
          )}
          {(threads || []).map((t) => (
            <button key={t.phone} onClick={() => openThread(t)}
              className={`w-full text-left px-3 py-3 hover:bg-slate-50 transition-colors flex items-center gap-3 ${sel?.phone === t.phone ? 'bg-emerald-50/60' : ''}`}>
              <span className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-sm font-semibold flex-shrink-0">{initials(title(t))}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800 text-sm truncate">{title(t)}</div>
                  <span className="text-[10.5px] text-slate-400 flex-shrink-0">{fmtTime(t.lastAt).split(',')[0]}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12.5px] text-slate-500 truncate">{t.lastDirection === 'OUT' ? <span className="text-slate-400">You: </span> : ''}{t.lastText || <span className="italic text-slate-400">(media)</span>}</div>
                  {t.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold grid place-items-center flex-shrink-0">{t.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div className={`flex-col ${sel ? 'flex' : 'hidden md:flex'}`} style={{ background: WA_BG }}>
        {!sel ? (
          <div className="flex-1 grid place-items-center text-center p-10 text-slate-400">
            <div><Icon name="MessagesSquare" size={34} className="mx-auto mb-2 text-slate-300" />Pick a conversation to read and reply.</div>
          </div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
              <button className="md:hidden text-slate-500" onClick={() => setSel(null)}><Icon name="ArrowLeft" size={18} /></button>
              <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-[13px] font-semibold flex-shrink-0">{initials(title(sel))}</span>
              <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm truncate">{title(sel)}</div>
                <div className="text-[12px] text-slate-500 truncate">{sel.contactName ? `${sel.contactName} · ` : ''}{sel.phone}</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {msgs === null ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={34} />) :
                msgs.length === 0 ? <div className="text-center text-sm text-slate-500 py-8">No messages.</div> :
                msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}>
                    {m.system ? (
                      <div className="max-w-[85%] rounded-lg px-3 py-2 text-[13px] bg-white/70 border border-slate-200 text-slate-600 shadow-sm">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5 inline-flex items-center gap-1"><Icon name="Send" size={10} /> {kindLabel(m.kind || '')}</div>
                        <div className="whitespace-pre-wrap break-words">{m.text || <span className="italic opacity-70">Message sent</span>}</div>
                        <div className="text-[10px] mt-1 text-slate-400 flex items-center gap-1 justify-end">{fmtTime(m.at)}<Ticks status={m.status} /></div>
                      </div>
                    ) : (
                      <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-[13.5px] shadow-sm ${m.direction === 'OUT' ? 'text-slate-800 rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none'}`}
                        style={m.direction === 'OUT' ? { background: WA_GREEN } : undefined}>
                        <div className="whitespace-pre-wrap break-words">{m.text || <span className="italic opacity-70">({m.type})</span>}</div>
                        <div className="text-[10px] mt-0.5 text-slate-500 flex items-center gap-1 justify-end">{fmtTime(m.at).split(', ')[1] || fmtTime(m.at)}{m.direction === 'OUT' && <Ticks status={m.status} />}</div>
                      </div>
                    )}
                  </div>
                ))}
              <div ref={endRef} />
            </div>

            {err && <div className="mx-4 mb-2 text-[12.5px] text-danger-700 bg-danger-50 border border-danger-100 rounded-lg px-3 py-2">{err}</div>}
            <div className="border-t border-slate-200 p-3 bg-slate-50">
              {sel.canReply ? (
                <>
                  <div className="flex items-end gap-2">
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Type a message…"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                      className="flex-1 resize-none rounded-full border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400" />
                    <button onClick={send} disabled={sending || !text.trim()}
                      className="w-11 h-11 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white grid place-items-center flex-shrink-0" title="Send">
                      <Icon name={sending ? 'Loader' : 'Send'} size={18} />
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1 pl-1"><Icon name="Clock" size={12} /> Reply window: {windowLeft(sel.windowEndsAt)} · Enter to send</div>
                </>
              ) : (
                <div className="text-[12.5px] text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <Icon name="Clock" size={14} className="text-slate-400" />
                  The 24-hour reply window has closed — WhatsApp only allows a free reply within 24h of the parent's last message. Send them a template (a fee reminder / notice) or wait for them to message again.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
