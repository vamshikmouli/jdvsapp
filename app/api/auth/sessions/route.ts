import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';

// GET /api/auth/sessions — list the current user's active devices
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const currentToken = ((session?.user as any)?.sessionId ?? (session as any)?.sessionId) as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sessions = await prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, sessionToken: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
    });

    return NextResponse.json(
      sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        isCurrent: s.sessionToken === currentToken,
      }))
    );
  } catch (err) {
    console.error('sessions GET error:', err);
    return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 });
  }
}

// DELETE /api/auth/sessions  — body { id } revokes one device,
//                               { scope: 'others' } signs out everywhere else.
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const currentToken = ((session?.user as any)?.sessionId ?? (session as any)?.sessionId) as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    if (body.scope === 'others') {
      const result = await prisma.userSession.updateMany({
        where: { userId, revokedAt: null, sessionToken: { not: currentToken ?? '' } },
        data: { revokedAt: new Date() },
      });
      await prisma.loginAudit.create({
        data: { userId, type: 'SESSION_REVOKED', detail: `Signed out ${result.count} other device(s)` },
      });
      return NextResponse.json({ ok: true, revoked: result.count });
    }

    if (body.id) {
      // Revoke a specific device (must belong to this user)
      const target = await prisma.userSession.findFirst({ where: { id: body.id, userId } });
      if (!target) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      await prisma.userSession.update({ where: { id: target.id }, data: { revokedAt: new Date() } });
      await prisma.loginAudit.create({ data: { userId, type: 'SESSION_REVOKED', detail: 'Revoked a device' } });
      return NextResponse.json({ ok: true, revoked: 1 });
    }

    return NextResponse.json({ error: 'Specify id or scope' }, { status: 400 });
  } catch (err) {
    console.error('sessions DELETE error:', err);
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });
  }
}
