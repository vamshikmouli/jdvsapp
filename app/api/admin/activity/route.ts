import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

// GET /api/admin/activity — the action audit trail (admins, USERS_MANAGE).
//   ?category= FEES|STUDENTS|STAFF|PAYROLL|ROLES|CONFIG|MARKS
//   ?userId=   filter to one actor
//   ?q=        text search on the summary / actor name
//   ?limit=    default 150 (max 500)
export async function GET(req: NextRequest) {
  try {
    await requirePermission('USERS_MANAGE');
    const sp = req.nextUrl.searchParams;
    const category = sp.get('category') || undefined;
    const userId = sp.get('userId') || undefined;
    const q = (sp.get('q') || '').trim();
    const limit = Math.min(500, Math.max(1, Number(sp.get('limit')) || 150));

    const where: any = {};
    if (category) where.category = category;
    if (userId) where.userId = userId;
    if (q) where.OR = [
      { summary: { contains: q, mode: 'insensitive' } },
      { userName: { contains: q, mode: 'insensitive' } },
    ];

    const [items, actors] = await Promise.all([
      prisma.activityLog.findMany({
        where, orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, userId: true, userName: true, roleKey: true, category: true, action: true, summary: true, ip: true, createdAt: true },
      }),
      // Distinct recent actors for the filter dropdown.
      prisma.activityLog.findMany({
        where: { userId: { not: null } }, distinct: ['userId'], orderBy: { createdAt: 'desc' }, take: 100,
        select: { userId: true, userName: true },
      }),
    ]);

    return NextResponse.json({ items, actors });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
