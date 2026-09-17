import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

// GET /api/admin/logins — who signed in / out (and failed attempts, role changes),
// plus the currently-active devices. Admins only (USERS_MANAGE).
//   ?type=  LOGIN|LOGOUT|LOGIN_FAILED|… to filter
//   ?limit= default 150 (max 500)
export async function GET(req: NextRequest) {
  try {
    await requirePermission('USERS_MANAGE');
    const sp = req.nextUrl.searchParams;
    const type = sp.get('type') || undefined;
    const limit = Math.min(500, Math.max(1, Number(sp.get('limit')) || 150));

    const [audits, sessions] = await Promise.all([
      prisma.loginAudit.findMany({
        where: type ? { type: type as any } : {},
        orderBy: { createdAt: 'desc' }, take: limit,
        include: { user: { select: { name: true, role: { select: { name: true } } } } },
      }),
      prisma.userSession.findMany({
        where: { revokedAt: null },
        orderBy: { lastSeenAt: 'desc' }, take: 200,
        include: { user: { select: { name: true, role: { select: { name: true } } } } },
      }),
    ]);

    return NextResponse.json({
      audits: audits.map((a) => ({
        id: a.id, type: a.type, at: a.createdAt, ip: a.ip, userAgent: a.userAgent, detail: a.detail,
        name: a.user?.name || a.email || 'Unknown', role: a.user?.role?.name || null, email: a.email,
      })),
      sessions: sessions.map((s) => ({
        id: s.id, name: s.user?.name || 'Unknown', role: s.user?.role?.name || null,
        ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt,
      })),
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
