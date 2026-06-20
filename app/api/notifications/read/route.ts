import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, authErrorResponse } from '@/lib/rbac/roles';

// POST /api/notifications/read — mark the user's notifications read.
// Body: { ids?: string[] }. Omit ids to mark ALL of the user's unread read.
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const userId = (session.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ ok: true, updated: 0 });

    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body?.ids) ? body.ids : undefined;

    const res = await prisma.notification.updateMany({
      // Always scoped to the caller's own rows — never trust ids alone.
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });

    return NextResponse.json({ ok: true, updated: res.count });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
