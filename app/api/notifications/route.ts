import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, authErrorResponse } from '@/lib/rbac/roles';

// GET /api/notifications — the signed-in user's latest notifications + unread count.
// Powers the top-bar bell (polled). Notifications are per-user, so no extra
// permission is needed beyond being signed in.
export async function GET() {
  try {
    const session = await requireSession();
    const userId = (session.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ items: [], unread: 0 });

    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, type: true, title: true, body: true, url: true, readAt: true, createdAt: true },
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return NextResponse.json({
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        url: n.url,
        read: n.readAt != null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
