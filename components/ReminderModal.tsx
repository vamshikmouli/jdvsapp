'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Field, Input, Select } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { toast } from '@/lib/toast';

export interface ReminderInitial {
  id?: string;
  title?: string;
  note?: string | null;
  dueAt?: string;            // ISO
  assignedToId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  url?: string | null;
}

interface Assignee { id: string; name: string; role: string }
interface StudentHit { id: string; name: string; className: string | null }

// Local datetime-local value (YYYY-MM-DDTHH:mm) for an ISO string, or a default
// of tomorrow 10:00.
function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : (() => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0); return t; })();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ReminderModal({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved?: () => void; initial?: ReminderInitial }) {
  const editing = !!initial?.id;
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [saving, setSaving] = useState(false);

  // Optional linked student
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const [sQuery, setSQuery] = useState('');
  const [sHits, setSHits] = useState<StudentHit[]>([]);
  const sTimer = useRef<any>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title || '');
    setNote(initial?.note || '');
    setDue(toLocalInput(initial?.dueAt));
    setAssignedToId(initial?.assignedToId || '');
    setStudent(initial?.entityType === 'Student' && initial?.entityId ? { id: initial.entityId, name: initial.entityLabel || initial.entityId } : null);
    setSQuery(''); setSHits([]);
    fetch('/api/reminders/assignees').then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setAssignees(d.items || [])).catch(() => {});
  }, [open, initial]);

  // Debounced student search.
  useEffect(() => {
    if (sTimer.current) clearTimeout(sTimer.current);
    if (sQuery.trim().length < 2) { setSHits([]); return; }
    sTimer.current = setTimeout(() => {
      fetch(`/api/reminders/student-search?q=${encodeURIComponent(sQuery.trim())}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setSHits(d.items || [])).catch(() => {});
    }, 250);
  }, [sQuery]);

  const save = async () => {
    if (!title.trim()) { toast.error('Enter a title'); return; }
    if (!due) { toast.error('Pick a due date & time'); return; }
    setSaving(true);
    const payload: any = {
      title: title.trim(), note: note.trim() || null, dueAt: new Date(due).toISOString(),
      assignedToId: assignedToId || null,
      entityType: student ? 'Student' : null, entityId: student?.id || null,
      entityLabel: student ? `${student.name} (${student.id})` : null, url: student ? '/admin/students' : null,
    };
    try {
      const r = await fetch(editing ? `/api/reminders/${initial!.id}` : '/api/reminders', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      toast.success(editing ? 'Reminder updated.' : 'Reminder set.');
      onSaved?.(); onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit reminder' : 'New reminder'} width={480}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" icon="BellRing" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Set reminder'}</Button></div>}>
      <div className="space-y-3">
        <Field label="Reminder"><Input autoFocus value={title} placeholder="e.g. Call Asha's father — will pay on the 20th" onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="When"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Assign to">
          <Select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
            <option value="">Myself</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` · ${a.role}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" placeholder="Any extra detail…" /></Field>

        {/* Optional: link a student */}
        <Field label="Link a student (optional)">
          {student ? (
            <div className="flex items-center gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm text-purple-800">
              <Icon name="User" size={14} /> <span className="flex-1 truncate">{student.name} · {student.id}</span>
              <button onClick={() => setStudent(null)} className="text-purple-500 hover:text-danger-600"><Icon name="X" size={14} /></button>
            </div>
          ) : (
            <div className="relative">
              <Input value={sQuery} onChange={(e) => setSQuery(e.target.value)} placeholder="Search name or ID…" />
              {sHits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {sHits.map((h) => (
                    <button key={h.id} onClick={() => { setStudent({ id: h.id, name: h.name }); setSQuery(''); setSHits([]); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{h.name}</span>
                      <span className="text-xs text-slate-400"> · {h.id}{h.className ? ` · ${h.className}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  );
}
