'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Button, Field, Input, Select } from '@/components/Primitives';
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
  students?: { id: string; name: string; className?: string | null }[] | null;
  url?: string | null;
}

interface Assignee { id: string; name: string; role: string }
interface StudentHit { id: string; name: string; className: string | null }
interface StudentSel { id: string; name: string; className?: string | null }

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
  const [saving, setSaving] = useState(false);

  // Assign to — multiple people (a copy per person on create).
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [selected, setSelected] = useState<Assignee[]>([]);
  const selectedIds = new Set(selected.map((a) => a.id));

  // Linked students — multiple per reminder.
  const [students, setStudents] = useState<StudentSel[]>([]);
  const [sQuery, setSQuery] = useState('');
  const [sHits, setSHits] = useState<StudentHit[]>([]);
  const sTimer = useRef<any>(null);
  const chosenIds = new Set(students.map((s) => s.id));

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title || '');
    setNote(initial?.note || '');
    setDue(toLocalInput(initial?.dueAt));
    // Students: prefer the new list; fall back to a legacy single entity.
    const pre: StudentSel[] = Array.isArray(initial?.students) && initial!.students!.length
      ? initial!.students!.map((s) => ({ id: s.id, name: s.name, className: s.className ?? null }))
      : (initial?.entityType === 'Student' && initial?.entityId ? [{ id: initial.entityId, name: initial.entityLabel || initial.entityId, className: null }] : []);
    setStudents(pre);
    setSQuery(''); setSHits([]);
    fetch('/api/reminders/assignees').then((r) => (r.ok ? r.json() : { items: [] })).then((d) => {
      const items: Assignee[] = d.items || [];
      setAssignees(items);
      setSelected(initial?.assignedToId ? items.filter((a) => a.id === initial.assignedToId) : []);
    }).catch(() => {});
  }, [open, initial]);

  // Debounced student search.
  useEffect(() => {
    if (sTimer.current) clearTimeout(sTimer.current);
    if (sQuery.trim().length < 2) { setSHits([]); return; }
    sTimer.current = setTimeout(() => {
      fetch(`/api/reminders/student-search?q=${encodeURIComponent(sQuery.trim())}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setSHits(d.items || [])).catch(() => {});
    }, 250);
  }, [sQuery]);

  const addAssignee = (id: string) => {
    const a = assignees.find((x) => x.id === id);
    if (a && !selectedIds.has(id)) setSelected((prev) => [...prev, a]);
  };
  const removeAssignee = (id: string) => setSelected((prev) => prev.filter((a) => a.id !== id));
  const addStudent = (h: StudentHit) => {
    if (!chosenIds.has(h.id)) setStudents((prev) => [...prev, { id: h.id, name: h.name, className: h.className }]);
    setSQuery(''); setSHits([]);
  };
  const removeStudent = (id: string) => setStudents((prev) => prev.filter((s) => s.id !== id));

  const save = async () => {
    if (!title.trim()) { toast.error('Enter a title'); return; }
    if (!due) { toast.error('Pick a due date & time'); return; }
    setSaving(true);
    const common = {
      title: title.trim(), note: note.trim() || null, dueAt: new Date(due).toISOString(),
      students: students.map((s) => ({ id: s.id, name: s.name, className: s.className ?? null })),
    };
    const payload: any = editing
      ? { ...common, assignedToId: selected[0]?.id || null }
      : { ...common, assignedToIds: selected.map((a) => a.id) };
    try {
      const r = await fetch(editing ? `/api/reminders/${initial!.id}` : '/api/reminders', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      const d = await r.json().catch(() => ({}));
      const n = d.count || 1;
      toast.success(editing ? 'Reminder updated.' : n > 1 ? `Reminder set for ${n} people.` : 'Reminder set.');
      onSaved?.(); onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title={editing ? 'Edit reminder' : 'New reminder'} width={460}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" icon="BellRing" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Set reminder'}</Button></div>}>
      <div className="space-y-3">
        <Field label="Reminder"><Input autoFocus value={title} placeholder="e.g. Call Asha's father — will pay on the 20th" onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="When"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>

        <Field label="Assign to">
          <div className="space-y-2">
            {selected.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-xs text-purple-800">
                    <Icon name="User" size={12} /> {a.name}{a.role ? ` · ${a.role}` : ''}
                    <button onClick={() => removeAssignee(a.id)} className="text-purple-500 hover:text-danger-600"><Icon name="X" size={12} /></button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No one selected — this will be assigned to you.</p>
            )}
            <Select value="" onChange={(e) => { if (e.target.value) addAssignee(e.target.value); }}>
              <option value="">+ Add person…</option>
              {assignees.filter((a) => !selectedIds.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` · ${a.role}` : ''}</option>)}
            </Select>
            {!editing && selected.length > 1 && <p className="text-xs text-slate-400">A separate reminder will be created for each person.</p>}
          </div>
        </Field>

        <Field label="Note (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" placeholder="Any extra detail…" /></Field>

        {/* Optional: link one or more students */}
        <Field label="Link students (optional)">
          <div className="space-y-2">
            {students.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {students.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-xs text-purple-800">
                    <Icon name="User" size={12} /> <span className="truncate max-w-[180px]">{s.name} · {s.id}</span>
                    <button onClick={() => removeStudent(s.id)} className="text-purple-500 hover:text-danger-600"><Icon name="X" size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Input value={sQuery} onChange={(e) => setSQuery(e.target.value)} placeholder="Search name or ID to add…" />
              {sHits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {sHits.filter((h) => !chosenIds.has(h.id)).map((h) => (
                    <button key={h.id} onClick={() => addStudent(h)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{h.name}</span>
                      <span className="text-xs text-slate-400"> · {h.id}{h.className ? ` · ${h.className}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Field>
      </div>
    </Drawer>
  );
}
