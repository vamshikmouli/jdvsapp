'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, Button, Card, Chip, EmptyState, Skeleton } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { toast } from '@/lib/toast';
import { ReminderModal, type ReminderInitial } from '@/components/ReminderModal';

interface Reminder {
  id: string; title: string; note: string | null; dueAt: string; status: 'OPEN' | 'DONE' | 'DISMISSED';
  assignedToId: string | null; assignedToName: string | null; createdById: string | null; createdByName: string | null;
  entityType: string | null; entityId: string | null; entityLabel: string | null;
  students: { id: string; name: string; className?: string | null }[] | null;
  url: string | null; completedAt: string | null;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function relLabel(iso: string): { text: string; tone: 'danger' | 'warn' | 'neutral' } {
  const now = new Date(); const d = new Date(iso);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDue = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startDue.getTime() - startToday.getTime()) / 86400000);
  if (days < 0) return { text: `Overdue ${-days}d`, tone: 'danger' };
  if (days === 0) return { text: 'Today', tone: 'warn' };
  if (days === 1) return { text: 'Tomorrow', tone: 'neutral' };
  return { text: `In ${days}d`, tone: 'neutral' };
}

export default function RemindersPage() {
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [view, setView] = useState<'mine' | 'assigned' | 'all'>('mine');
  const [canSeeAll, setCanSeeAll] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; initial?: ReminderInitial }>({ open: false });

  const load = useCallback(async () => {
    setItems(null);
    try {
      const r = await fetch(`/api/reminders?view=${view}&status=${tab}`, { cache: 'no-store' });
      const d = await r.json();
      setItems(d.items || []); setCanSeeAll(!!d.canSeeAll);
    } catch { setItems([]); }
  }, [view, tab]);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, body: any) => {
    const r = await fetch(`/api/reminders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error || 'Failed'); return; }
    load();
  };
  const del = async (id: string) => { const r = await fetch(`/api/reminders/${id}`, { method: 'DELETE' }); if (r.ok) load(); };
  const snooze = (id: string, days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(10, 0, 0, 0); act(id, { action: 'snooze', dueAt: d.toISOString() }); };

  const groups = useMemo(() => {
    const list = items || [];
    if (tab === 'done') return [{ label: 'Completed', rows: list }];
    const overdue: Reminder[] = [], today: Reminder[] = [], upcoming: Reminder[] = [];
    for (const r of list) { const t = relLabel(r.dueAt); (t.tone === 'danger' ? overdue : t.text === 'Today' ? today : upcoming).push(r); }
    return [
      { label: 'Overdue', rows: overdue },
      { label: 'Today', rows: today },
      { label: 'Upcoming', rows: upcoming },
    ].filter((g) => g.rows.length);
  }, [items, tab]);

  return (
    <>
      <PageHeader title="Reminders" meta="Follow-ups and call-backs"
        actions={<Button kind="primary" icon="Plus" onClick={() => setModal({ open: true })}>New reminder</Button>} />

      <div className="mt-3 space-y-2">
        {/* Whose tasks */}
        <div className="flex rounded-md border border-slate-200 overflow-x-auto w-fit max-w-full">
          {(([['mine', 'Own tasks'], ['assigned', 'Assigned to staff'], ...(canSeeAll ? [['all', 'All staff']] : [])]) as [typeof view, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className={`px-4 py-1.5 text-sm font-medium whitespace-nowrap ${view === k ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        {/* Open / Done */}
        <div className="flex rounded-md border border-slate-200 overflow-hidden w-fit">
          {(['open', 'done'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 text-sm font-medium ${tab === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {t === 'open' ? 'Open' : 'Done'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-5">
        {items === null ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={64} />)}</div>
        ) : (items.length === 0 ? (
          <Card><EmptyState icon="BellRing"
            title={view === 'assigned' ? (tab === 'open' ? 'No tasks assigned to staff' : 'No completed staff tasks') : tab === 'open' ? 'No open reminders' : 'Nothing completed yet'}
            body={view === 'assigned' ? 'Assign a reminder to a staff member and it shows up here to track.' : tab === 'open' ? 'Set a reminder to follow up — e.g. “call back on the 20th”.' : 'Completed reminders show here.'} /></Card>
        ) : groups.map((g) => (
          <div key={g.label}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{g.label} · {g.rows.length}</div>
            <Card padded={false}>
              <div className="divide-y divide-slate-100">
                {g.rows.map((r) => {
                  const rl = relLabel(r.dueAt);
                  const done = r.status !== 'OPEN';
                  return (
                    <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-medium ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{r.title}</div>
                        {r.note && <div className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap">{r.note}</div>}
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1"><Icon name="Clock" size={12} /> {fmtWhen(r.dueAt)}</span>
                          {!done && <Chip tone={rl.tone === 'danger' ? 'danger' : rl.tone === 'warn' ? 'warn' : 'neutral'}>{rl.text}</Chip>}
                          {r.assignedToName && <span className="inline-flex items-center gap-1"><Icon name="User" size={12} /> {r.assignedToName}</span>}
                          {r.createdByName && r.createdById && r.createdById !== r.assignedToId && <span className="inline-flex items-center gap-1 text-slate-400">· from {r.createdByName}</span>}
                          {r.students && r.students.length > 0 ? (
                            r.students.map((s) => (
                              <a key={s.id} href="/admin/students" className="inline-flex items-center gap-1 text-purple-600 hover:underline"><Icon name="User" size={12} /> {s.name}</a>
                            ))
                          ) : (
                            r.entityLabel && (r.url ? <a href={r.url} className="inline-flex items-center gap-1 text-purple-600 hover:underline"><Icon name="Link" size={12} /> {r.entityLabel}</a> : <span className="inline-flex items-center gap-1"><Icon name="Link" size={12} /> {r.entityLabel}</span>)
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!done ? (
                          <>
                            <button onClick={() => act(r.id, { action: 'done' })} title="Mark done" className="p-1.5 rounded-md text-slate-400 hover:text-success-600 hover:bg-slate-100"><Icon name="Check" size={16} /></button>
                            <button onClick={() => snooze(r.id, 1)} title="Snooze to tomorrow" className="p-1.5 rounded-md text-slate-400 hover:text-purple-600 hover:bg-slate-100"><Icon name="Clock" size={16} /></button>
                            <button onClick={() => setModal({ open: true, initial: r })} title="Edit" className="p-1.5 rounded-md text-slate-400 hover:text-purple-600 hover:bg-slate-100"><Icon name="Pencil" size={15} /></button>
                          </>
                        ) : (
                          <button onClick={() => act(r.id, { action: 'reopen' })} title="Reopen" className="p-1.5 rounded-md text-slate-400 hover:text-purple-600 hover:bg-slate-100"><Icon name="RotateCcw" size={15} /></button>
                        )}
                        <button onClick={() => del(r.id)} title="Delete" className="p-1.5 rounded-md text-slate-400 hover:text-danger-600 hover:bg-slate-100"><Icon name="Trash2" size={15} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )))}
      </div>

      <ReminderModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false })} onSaved={load} />
    </>
  );
}
