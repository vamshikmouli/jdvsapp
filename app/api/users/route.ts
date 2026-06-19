import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { isSyntheticEmail } from '@/lib/auth/provision';

// GET /api/users — admin listing of every login account, with the distributable
// initial PIN (when still unused). Gated by USERS_MANAGE.
export async function GET(req: NextRequest) {
  try {
    await requirePermission('USERS_MANAGE');
    const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

    const users = await prisma.user.findMany({
      orderBy: [{ role: { key: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        initialPin: true,
        passwordChangedAt: true,
        isActive: true,
        lastLogin: true,
        role: { select: { name: true, key: true } },
        guardianOf: { select: { name: true }, where: { status: 'ACTIVE' } },
      },
    });

    const rows = users.map((u) => ({
      id: u.id,
      name: u.name,
      roleName: u.role?.name || '—',
      roleKey: u.role?.key || '',
      phone: u.phone || '',
      email: isSyntheticEmail(u.email) ? '' : u.email,
      initialPin: u.initialPin,                 // 6-digit PIN if not yet changed
      hasOwnPassword: !!u.passwordChangedAt,     // user set their own
      isActive: u.isActive,
      lastLogin: u.lastLogin,
      children: u.guardianOf.map((s) => s.name),
    }));

    const filtered = q
      ? rows.filter((r) =>
          r.name.toLowerCase().includes(q) ||
          r.phone.includes(q) ||
          (r.initialPin || '').includes(q) ||
          r.children.some((c) => c.toLowerCase().includes(q)))
      : rows;

    return NextResponse.json(filtered);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
