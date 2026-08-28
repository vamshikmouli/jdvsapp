// Maps a phone number to the login account(s) that own it.
//
// In Jnana every login is a `User`: parents (role.baseSurface = PARENT, guardian
// of Student(s); siblings share ONE user) and staff (ADMIN | TEACHER | ACCOUNTANT,
// optionally linked to a Staff row). Roles are data-driven (the Role table), so a
// user's role is role.key and its dashboard is role.baseSurface.
//
// A phone maps to >1 User only when the same number owns two separate accounts
// (e.g. a teacher who is also a parent with a distinct login) — that drives the
// role-picker. Drivers without a User can't sign in and are excluded.
import { prisma } from '@/lib/db';
import { normalizePhone } from '@/lib/auth/provision';

export type Surface = 'ADMIN' | 'TEACHER' | 'ACCOUNTANT' | 'PARENT';

export interface Account {
  userId: string;
  email: string;        // the unique login identifier (real or synthetic) for signIn
  displayName: string;  // User.name
  roleKey: string;      // Role.key
  roleName: string;     // Role.name — label for the role-picker
  surface: Surface;     // Role.baseSurface — which dashboard
  mustSetPin: boolean;  // true while still on the provisioned/reset default
}

// Last 10 digits — stable regardless of bare (98765xxxxx) vs +91 storage.
export function phoneTail10(phone: string): string {
  return normalizePhone(phone).replace(/\D/g, '').slice(-10);
}

export async function findAccountsByPhone(phone: string): Promise<Account[]> {
  const last10 = phoneTail10(phone);
  if (last10.length < 10) return [];

  const users = await prisma.user.findMany({
    where: { isActive: true, phone: { endsWith: last10 } },
    select: {
      id: true,
      email: true,
      name: true,
      passwordChangedAt: true,
      role: { select: { key: true, name: true, baseSurface: true, isActive: true } },
    },
  });

  return users
    .filter((u) => u.role?.isActive)
    .map((u) => ({
      userId: u.id,
      email: u.email,
      displayName: u.name,
      roleKey: u.role.key,
      roleName: u.role.name,
      surface: u.role.baseSurface as Surface,
      mustSetPin: u.passwordChangedAt == null,
    }));
}

export async function anyAccountForPhone(phone: string): Promise<boolean> {
  return (await findAccountsByPhone(phone)).length > 0;
}
