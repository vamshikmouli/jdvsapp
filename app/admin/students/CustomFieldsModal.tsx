'use client';

import { useState, useEffect } from 'react';
import { Modal, Button, Input, Select } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { toast } from '@/lib/toast';
import type { CustomFieldDef, CustomFieldType } from '@/lib/customFields';

let seq = 0;
const rid = () => `cf${Date.now().toString(36)}${seq++}`;

// Admin editor for the student form's custom fields. Definitions are saved to
// Settings and then rendered on the student form + available in Super Tools.
export function CustomFieldsModal({ open, onClose, initial, onSaved }: {
  open: boolean;
  onClose: () => void;
  initial: CustomFieldDef[];
  onSaved: (fields: CustomFieldDef[]) => void;
}) {
  const [fields, setFields] = useState<CustomFieldDef[]>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setFields(initial); }, [open, initial]);

  const add = () => setFields((f) => [...f, { id: rid(), label: '', type: 'text' }]);
  const upd = (i: number, patch: Partial<CustomFieldDef>) => setFields((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const del = (i: number) => setFields((f) => f.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => setFields((f) => {
    const j = i + dir;
    if (j < 0 || j >= f.length) return f;
    const c = [...f];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });

  const save = async () => {
    const clean = fields.map((x) => ({ ...x, label: x.label.trim() })).filter((x) => x.label);
    setSaving(true);
    try {
      const r = await fetch('/api/settings/student-fields', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: clean }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed to save');
      onSaved(d.fields || clean);
      toast.success('Custom fields saved');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Custom fields" subtitle="Extra fields for the student form — also available in Super Tools" width={560}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button kind="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save fields'}</Button></div>}>
      <div className="space-y-3">
        {fields.length === 0 && <p className="text-sm text-slate-400">No custom fields yet — add one below.</p>}
        {fields.map((f, i) => (
          <div key={f.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input value={f.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Field label (e.g. Blood group)" className="flex-1" />
              <Select value={f.type} onChange={(e) => upd(i, { type: e.target.value as CustomFieldType })} className="w-32">
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown</option>
              </Select>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 p-1" title="Move up"><Icon name="ChevronUp" size={16} /></button>
              <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 p-1" title="Move down"><Icon name="ChevronDown" size={16} /></button>
              <button onClick={() => del(i)} className="text-slate-300 hover:text-danger-600 p-1" title="Remove"><Icon name="Trash2" size={16} /></button>
            </div>
            {f.type === 'select' && (
              <Input value={(f.options || []).join(', ')} onChange={(e) => upd(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="Options, comma-separated (e.g. A+, B+, O+)" />
            )}
          </div>
        ))}
        <Button size="sm" icon="Plus" onClick={add}>Add field</Button>
      </div>
    </Modal>
  );
}
