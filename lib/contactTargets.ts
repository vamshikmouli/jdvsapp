// Who a student's contact messages (parent login + fee reminders/receipts on
// WhatsApp) go to. A student can pick any combination of Father / Mother / Guardian.
// Stored on Student.smsFor as a comma-separated list, e.g. "FATHER,MOTHER".
export type ContactTarget = 'FATHER' | 'MOTHER' | 'GUARDIAN';

const ORDER: ContactTarget[] = ['FATHER', 'MOTHER', 'GUARDIAN'];

export const CONTACT_TARGET_LABEL: Record<ContactTarget, string> = {
  FATHER: 'Father',
  MOTHER: 'Mother',
  GUARDIAN: 'Guardian',
};

/** Parse the stored value into an ordered, de-duplicated list. Tolerates the
 *  legacy single values (FATHER / MOTHER / GUARDIAN) and BOTH (= father+mother).
 *  Always returns at least one target (defaults to Father). */
export function parseContactTargets(smsFor?: string | null): ContactTarget[] {
  const raw = String(smsFor || '').toUpperCase().trim();
  if (!raw) return ['FATHER'];
  if (raw === 'BOTH') return ['FATHER', 'MOTHER'];
  const set = new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
  const out = ORDER.filter((t) => set.has(t));
  return out.length ? out : ['FATHER'];
}

/** Canonical stored form: ordered CSV of valid targets. */
export function normalizeContactTargets(smsFor?: string | null): string {
  return parseContactTargets(smsFor).join(',');
}

/** Human label, e.g. "Father, Mother". */
export function contactTargetsLabel(smsFor?: string | null): string {
  return parseContactTargets(smsFor).map((t) => CONTACT_TARGET_LABEL[t]).join(', ');
}
