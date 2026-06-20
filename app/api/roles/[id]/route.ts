import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { ALL_PERMISSIONS } from '@/lib/rbac/permissions';
import { Permission, Surface } from '@prisma/client';

/**
 * Revoke all sessions for the users holding a role, so permission/surface
 * changes take effect immediately (forced re-login — auth plan §2.4).
 */
async function forceReLoginForRole(roleId: string, detail: string): Promise<number> {
  const users = await prisma.user.findMany({ where: { roleId }, select: { id: true } });
  if (users.length === 0) return 0;
  const userIds = users.map((u) => u.id);
  await prisma.$transaction([
    prisma.userSession.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.loginAudit.createMany({
      data: userIds.map((userId) => ({ userId, type: 'ROLE_PERMISSIONS_CHANGED' as const, detail })),
    }),
  ]);
  return userIds.length;
}

// PATCH /api/roles/[id] — edit name/description/permissions/surface/active
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermission('ROLES_MANAGE');
    const role = await prisma.role.findUnique({
      where: { id: params.id },
      include: { permissions: true },
    });
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

    const body = await req.json();
    const data: any = {};

    // System roles: permissions/surface/active editable, but name/key locked
    if (!role.isSystem) {
      if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
      if (body.description !== undefined) data.description = (body.description || '').trim() || null;
    }
    if (body.baseSurface !== undefined) {
      if (!['ADMIN', 'TEACHER', 'ACCOUNTANT', 'PARENT'].includes(body.baseSurface)) {
        return NextResponse.json({ error: 'Invalid base surface' }, { status: 400 });
      }
      data.baseSurface = body.baseSurface as Surface;
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

    // Permissions the role holds that aren't in the editable catalog (e.g. the
    // internal STAFF_ATTENDANCE_KIOSK granted by script). The UI never renders or
    // sends these back, so they must be preserved across a save — otherwise a
    // naive rewrite strips them and silently breaks that capability.
    const hiddenPerms = role.permissions
      .map((p) => p.permission)
      .filter((p) => !ALL_PERMISSIONS.includes(p));

    // Detect security-relevant changes (require forced re-login). Merge the
    // catalog perms the UI sent with the hidden perms we're preserving.
    const newPerms: Permission[] | undefined = Array.isArray(body.permissions)
      ? Array.from(
          new Set([
            ...(body.permissions as Permission[]).filter((p) => ALL_PERMISSIONS.includes(p)),
            ...hiddenPerms,
          ])
        )
      : undefined;

    const oldPerms = role.permissions.map((p) => p.permission).sort();
    const permsChanged =
      newPerms !== undefined && JSON.stringify([...newPerms].sort()) !== JSON.stringify(oldPerms);
    const surfaceChanged = data.baseSurface !== undefined && data.baseSurface !== role.baseSurface;
    const activeChanged = data.isActive !== undefined && data.isActive !== role.isActive;
    const securityRelevant = permsChanged || surfaceChanged || activeChanged;

    // Apply updates
    await prisma.role.update({ where: { id: role.id }, data });
    if (newPerms !== undefined) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (newPerms.length) {
        await prisma.rolePermission.createMany({
          data: newPerms.map((p) => ({ roleId: role.id, permission: p })),
          skipDuplicates: true,
        });
      }
    }

    // Force re-login of affected users when permissions/surface/active change
    let affectedUsers = 0;
    if (securityRelevant) {
      affectedUsers = await forceReLoginForRole(role.id, `Role "${role.name}" updated`);
    }

    return NextResponse.json({ ok: true, affectedUsers });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// DELETE /api/roles/[id] — only if not system and no users assigned
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermission('ROLES_MANAGE');
    const role = await prisma.role.findUnique({
      where: { id: params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    if (role.isSystem) {
      return NextResponse.json({ error: 'System roles cannot be deleted' }, { status: 400 });
    }
    if (role._count.users > 0) {
      return NextResponse.json(
        { error: `Reassign ${role._count.users} user(s) before deleting this role.` },
        { status: 400 }
      );
    }
    await prisma.role.delete({ where: { id: role.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
