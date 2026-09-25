import type { Permission } from '@prisma/client';

/**
 * The legacy `*_MANAGE` umbrella ⇄ granular CRUD bridge.
 *
 * Pure and client-safe (no server imports) so the same rule runs in the server
 * `can()` guard and the client `usePermissions()` hook — a page and its API
 * always agree on who can do what.
 *
 * - Holding a `*_MANAGE` grant satisfies any of its CRUD permissions.
 * - Holding the full CRUD trio satisfies a legacy `*_MANAGE` check.
 */
export const MANAGE_IMPLIES: Partial<Record<Permission, Permission[]>> = {
  STUDENTS_MANAGE: ['STUDENTS_CREATE', 'STUDENTS_UPDATE', 'STUDENTS_DELETE'],
  CLASSES_MANAGE: ['CLASSES_CREATE', 'CLASSES_UPDATE', 'CLASSES_DELETE'],
  STAFF_MANAGE: ['STAFF_CREATE', 'STAFF_UPDATE', 'STAFF_DELETE'],
  PAYROLL_MANAGE: ['PAYROLL_CREATE', 'PAYROLL_UPDATE', 'PAYROLL_DELETE'],
};

// Reverse index: each granular perm → the umbrella that also satisfies it.
export const GRANULAR_UMBRELLA: Partial<Record<Permission, Permission>> = (() => {
  const m: Partial<Record<Permission, Permission>> = {};
  for (const [umbrella, grans] of Object.entries(MANAGE_IMPLIES)) {
    for (const g of grans as Permission[]) m[g] = umbrella as Permission;
  }
  return m;
})();

/** Does this permission set grant `permission`, honouring the MANAGE⇄CRUD bridge? */
export function permAllows(perms: ReadonlySet<Permission> | ReadonlyArray<Permission>, permission: Permission): boolean {
  const has = (p: Permission) => (perms instanceof Set ? perms.has(p) : (perms as ReadonlyArray<Permission>).includes(p));
  if (has(permission)) return true;
  const umbrella = GRANULAR_UMBRELLA[permission];
  if (umbrella && has(umbrella)) return true;
  const implied = MANAGE_IMPLIES[permission];
  if (implied && implied.every(has)) return true;
  return false;
}
