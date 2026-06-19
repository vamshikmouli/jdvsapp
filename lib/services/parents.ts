import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { normalizePhone, syntheticEmail } from '@/lib/auth/provision';

/**
 * Pick the primary contact (name + phone) from father/mother based on `smsFor`.
 * Falls back to the other parent, then to legacy guardian fields.
 */
export function pickPrimaryContact(b: {
  smsFor?: string; fatherName?: string; fatherPhone?: string;
  motherName?: string; motherPhone?: string; guardianName?: string; guardianPhone?: string;
}): { name: string; phone: string } {
  const sms = String(b.smsFor || 'FATHER').toUpperCase();
  const fN = String(b.fatherName || '').trim(), fP = String(b.fatherPhone || '').trim();
  const mN = String(b.motherName || '').trim(), mP = String(b.motherPhone || '').trim();
  const name = (sms === 'MOTHER' ? mN || fN : fN || mN) || String(b.guardianName || '').trim();
  const phone = (sms === 'MOTHER' ? mP || fP : fP || mP) || String(b.guardianPhone || '').trim();
  return { name, phone };
}

/** A random 6-digit login PIN (admin distributes it; parent can change later). */
export function generateLoginPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Find or create the Parent login account for a guardian.
 * Keyed by phone so siblings share one parent account. Returns the userId
 * (or null if no phone / parent role not seeded). A new account gets an
 * auto-generated 6-digit PIN as its initial password, stored (plaintext) in
 * `initialPin` so an admin can hand it out; it's cleared when the parent
 * changes their password. Existing accounts are reused untouched.
 */
export async function ensureParentUser(
  guardianName: string,
  guardianPhone: string
): Promise<string | null> {
  const phone = normalizePhone(guardianPhone);
  if (!phone) return null;

  // Reuse an existing account with this phone (sibling already added)
  const existing = await prisma.user.findFirst({ where: { phone } });
  if (existing) return existing.id;

  const parentRole = await prisma.role.findUnique({ where: { key: 'parent' } });
  if (!parentRole) return null;

  const email = syntheticEmail('parent', phone);
  const pin = generateLoginPin();
  const passwordHash = await hashPassword(pin);
  const user = await prisma.user.create({
    data: {
      name: guardianName || 'Parent',
      email,
      phone,
      roleId: parentRole.id,
      passwordHash,
      initialPin: pin,
      isActive: true,
    },
  });
  return user.id;
}
