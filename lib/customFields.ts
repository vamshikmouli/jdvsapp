// Admin-defined custom fields for the student form. Definitions live in
// Settings.studentCustomFields; per-student values live in Student.customFields
// (keyed by field id). Shared by the students page, the API, and Super Tools.

export type CustomFieldType = 'text' | 'number' | 'date' | 'select';

export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  options?: string[]; // for 'select'
}

const TYPES: CustomFieldType[] = ['text', 'number', 'date', 'select'];

/** Safely coerce stored JSON into a clean list of field definitions. */
export function parseCustomFieldDefs(raw: unknown): CustomFieldDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFieldDef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = String(o.id || '').trim();
    const label = String(o.label || '').trim();
    const type = TYPES.includes(o.type as CustomFieldType) ? (o.type as CustomFieldType) : 'text';
    if (!id || !label) continue;
    const def: CustomFieldDef = { id, label, type };
    if (type === 'select' && Array.isArray(o.options)) {
      def.options = o.options.map((x) => String(x).trim()).filter(Boolean);
    }
    out.push(def);
  }
  return out;
}

/** Keep only values for known fields; stringify everything for stable storage. */
export function cleanCustomValues(raw: unknown, defs: CustomFieldDef[]): Record<string, string> {
  const values = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const d of defs) {
    const v = values[d.id];
    if (v != null && String(v).trim() !== '') out[d.id] = String(v).trim();
  }
  return out;
}
