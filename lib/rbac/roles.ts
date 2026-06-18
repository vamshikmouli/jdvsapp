/**
 * Capability layer (RBAC).
 *
 * Roles are data (see prisma Role model). At login we bake the user's
 * roleKey, surface, and granted permission keys into the JWT/session, so
 * permission checks here are pure in-memory reads — no DB hit per request.
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';
import type { Permission, Surface } from '@prisma/client';

export type { Permission, Surface };

/** Shape of the auth fields we attach to the NextAuth session user. */
export interface SessionUserRBAC {
  id: string;
  roleKey: string;
  roleName: string;
  surface: Surface;
  perms: Permission[];
}

type SessionLike = { user?: Partial<SessionUserRBAC> & Record<string, any> } | null | undefined;

/** Extract the RBAC bits from a session object. */
export function rbac(session: SessionLike): SessionUserRBAC | null {
  const u = session?.user as any;
  if (!u) return null;
  return {
    id: u.id,
    roleKey: u.roleKey ?? 'parent',
    roleName: u.roleName ?? 'Parent',
    surface: (u.surface as Surface) ?? 'PARENT',
    perms: (u.perms as Permission[]) ?? [],
  };
}

/** Does this session hold the given permission? */
export function can(session: SessionLike, permission: Permission): boolean {
  const r = rbac(session);
  if (!r) return false;
  return r.perms.includes(permission);
}

/** Does this session hold ANY of the given permissions? */
export function canAny(session: SessionLike, permissions: Permission[]): boolean {
  const r = rbac(session);
  if (!r) return false;
  return permissions.some((p) => r.perms.includes(p));
}

/** Which surface (dashboard/shell) does this session belong to? */
export function surfaceOf(session: SessionLike): Surface {
  return rbac(session)?.surface ?? 'PARENT';
}

/** Default landing path. All staff share the admin shell; parents have their own app. */
export function homePathForSurface(surface: Surface): string {
  if (surface === 'PARENT') return '/parent';
  // Teachers' main daily action is punching attendance — land them there.
  if (surface === 'TEACHER') return '/admin/my-attendance';
  return '/admin/dashboard';
}

// ---------- Server-side guards (for API route handlers) ----------

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Require an authenticated session. Throws AuthError(401) otherwise. */
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) throw new AuthError('Unauthorized', 401);
  return session;
}

/**
 * Require a specific permission. Throws AuthError(401/403).
 * Usage in a route: `const session = await requirePermission('STUDENTS_MANAGE');`
 */
export async function requirePermission(permission: Permission) {
  const session = await requireSession();
  if (!can(session, permission)) {
    throw new AuthError('Forbidden', 403);
  }
  return session;
}

/**
 * Class-level data scope for the current user.
 * - `all: true`  → user holds ALL_CLASSES_ACCESS; sees every class.
 * - `all: false` → user is scoped to `classIds` (the classes assigned to their Staff record).
 *   An empty list means they see nothing class-bound.
 */
export async function getClassScope(
  session: SessionLike
): Promise<{ all: boolean; classIds: string[] }> {
  if (can(session, 'ALL_CLASSES_ACCESS')) return { all: true, classIds: [] };
  const staffId = (session?.user as any)?.staffId as string | undefined;
  if (!staffId) return { all: false, classIds: [] };
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { classes: { select: { id: true } } },
  });
  return { all: false, classIds: (staff?.classes || []).map((c) => c.id) };
}

/** Convert an AuthError (or unknown) to an HTTP status + message. */
export function authErrorResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof AuthError) {
    return { status: err.status, body: { error: err.message } };
  }
  console.error('Unexpected auth error:', err);
  return { status: 500, body: { error: 'Internal error' } };
}
