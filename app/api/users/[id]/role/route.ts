import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

// PATCH /api/users/[id]/role — assign a role to a user.
// Always revokes that user's sessions so the new role's permissions apply
// on their next login (forced re-login — auth plan §2.4).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermission('USERS_MANAGE');
    const body = await req.json();
    const roleId = body.roleId as string;
    if (!roleId) return NextResponse.json({ error: 'roleId is required' }, { status: 400 });

    const [user, role] = await Promise.all([
      prisma.user.findUnique({ where: { id: params.id }, select: { id: true } }),
      prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } }),
    ]);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { roleId } }),
      prisma.userSession.deleteMany({ where: { userId: user.id } }),
      prisma.loginAudit.create({
        data: { userId: user.id, type: 'ROLE_REASSIGNED', detail: `Reassigned to "${role.name}"` },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
