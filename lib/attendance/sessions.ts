/**
 * Configurable, school-wide attendance sessions.
 * Stored as an ordered JSON array on Settings.sessions. Admins can have one
 * session or many. `key` is what AttendanceSession.slot stores.
 */

export interface SessionDef {
  key: string;
  label: string;
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

// Defaults — keys match the legacy enum values so existing rows stay valid.
export const DEFAULT_SESSIONS: SessionDef[] = [
  { key: 'MORNING', label: 'Morning', open: '08:30', close: '09:30' },
  { key: 'AFTERNOON', label: 'Afternoon', open: '13:00', close: '14:00' },
];

/** Turn a label into a stable, unique-ish key. */
export function slugifyKey(label: string): string {
  const base = label
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || `SESSION_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/** Read sessions from a settings row, falling back to defaults. */
export function parseSessions(raw: unknown): SessionDef[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_SESSIONS;
  const cleaned = (raw as any[])
    .filter((s) => s && typeof s.key === 'string' && typeof s.label === 'string')
    .map((s) => ({
      key: String(s.key),
      label: String(s.label),
      open: typeof s.open === 'string' ? s.open : '',
      close: typeof s.close === 'string' ? s.close : '',
    }));
  return cleaned.length ? cleaned : DEFAULT_SESSIONS;
}

/** Validate + normalize an incoming sessions array (used by the settings API). */
export function normalizeSessions(input: unknown): SessionDef[] {
  if (!Array.isArray(input)) return DEFAULT_SESSIONS;
  const seen = new Set<string>();
  const out: SessionDef[] = [];
  for (const item of input as any[]) {
    if (!item || typeof item.label !== 'string' || !item.label.trim()) continue;
    let key = typeof item.key === 'string' && item.key.trim() ? item.key.trim().toUpperCase() : slugifyKey(item.label);
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    out.push({
      key,
      label: item.label.trim(),
      open: typeof item.open === 'string' ? item.open : '',
      close: typeof item.close === 'string' ? item.close : '',
    });
  }
  return out.length ? out : DEFAULT_SESSIONS;
}

export function windowLabel(s: SessionDef): string {
  return s.open && s.close ? `${s.open} – ${s.close}` : '';
}
