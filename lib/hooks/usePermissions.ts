'use client';

/**
 * Client-side RBAC hook.
 *
 * The user's granted permission keys are baked into the NextAuth session at
 * login (see lib/auth/authOptions), so this is a pure in-memory read — no
 * network call. Use it instead of hand-rolling
 * `((session?.user as any)?.perms as string[]) || []` in every page.
 *
 *   const { can } = usePermissions();
 *   if (can('FEES_COLLECT')) { ... }
 */
import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { permAllows } from '@/lib/rbac/crud';
import type { Permission } from '@prisma/client';

export interface Permissions {
  /** Raw permission keys held by the signed-in user. */
  perms: Permission[];
  /** Does the user hold this permission? */
  can: (permission: Permission) => boolean;
  /** Does the user hold ANY of these permissions? */
  canAny: (permissions: Permission[]) => boolean;
  /** Does the user hold ALL of these permissions? */
  canAll: (permissions: Permission[]) => boolean;
  /** Session still loading — treat as "not yet known" rather than "denied". */
  isLoading: boolean;
}

export function usePermissions(): Permissions {
  const { data: session, status } = useSession();

  return useMemo(() => {
    const perms = (((session?.user as any)?.perms as Permission[]) || []);
    const set = new Set<Permission>(perms);
    return {
      perms,
      can: (p: Permission) => permAllows(set, p),
      canAny: (ps: Permission[]) => ps.some((p) => permAllows(set, p)),
      canAll: (ps: Permission[]) => ps.every((p) => permAllows(set, p)),
      isLoading: status === 'loading',
    };
  }, [session, status]);
}
