/**
 * Helpers for auto-provisioning login accounts from Staff/Student records.
 *
 * Policy (per product decision):
 *  - Every staff member gets a login. Password = their phone number.
 *  - Parents are auto-created from a student's guardian info; siblings share one.
 *  - Users can log in with either their email OR their phone number.
 */

/** Strip everything except digits (and a leading +) so the phone is a stable key. */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/[^\d]/g, '');
}

/** Build a synthetic, unique login email when a person has no real email. */
export function syntheticEmail(prefix: 'staff' | 'parent', phone: string): string {
  return `${prefix}_${normalizePhone(phone).replace('+', '')}@jnanadeepika.local`;
}

/** Is this a system-generated placeholder email (vs a real one the person uses)? */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith('@jnanadeepika.local');
}
