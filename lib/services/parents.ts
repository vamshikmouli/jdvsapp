import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { normalizePhone, syntheticEmail } from '@/lib/auth/provision';
import { parseContactTargets } from '@/lib/contactTargets';

/**
 * Pick the primary contact (name + phone) from father/mother based on `smsFor`.
 * Falls back to the other parent, then to legacy guardian fields.
 */
export function pickPrimaryContact(b: {
  smsFor?: string; fatherName?: string; fatherPhone?: string;
  motherName?: string; motherPhone?: string;
  altGuardianName?: string; altGuardianPhone?: string;
  guardianName?: string; guardianPhone?: string;
}): { name: string; phone: string } {
  const targets = parseContactTargets(b.smsFor);
  const contacts: Record<string, { name: string; phone: string }> = {
    FATHER: { name: String(b.fatherName || '').trim(), phone: String(b.fatherPhone || '').trim() },
    MOTHER: { name: String(b.motherName || '').trim(), phone: String(b.motherPhone || '').trim() },
    GUARDIAN: { name: String(b.altGuardianName || '').trim(), phone: String(b.altGuardianPhone || '').trim() },
  };
  // The login is one phone: the first selected target that has a number, then any
  // selected target with a name, then any contact at all, then the legacy guardian.
  const withPhone = targets.map((t) => contacts[t]).find((c) => c.phone);
  const withName = targets.map((t) => contacts[t]).find((c) => c.name);
  const anyPhone = Object.values(contacts).find((c) => c.phone);
  const name = (withPhone?.name || withName?.name || anyPhone?.name || '') || String(b.guardianName || '').trim();
  const phone = (withPhone?.phone || anyPhone?.phone || '') || String(b.guardianPhone || '').trim();
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
