import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';

// POST /api/auth/logout — revoke the current session row + write audit.
// (NextAuth's signOut() clears the cookie client-side; this revokes the
// server-side session record so the token can't be replayed.)
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    const sessionId = ((session?.user as any)?.sessionId ?? (session as any)?.sessionId) as string | undefined;
    const userId = (session?.user as any)?.id as string | undefined;

    if (sessionId) {
      await prisma.userSession
        .update({ where: { sessionToken: sessionId }, data: { revokedAt: new Date() } })
        .catch(() => {});
    }
    if (userId) {
      await prisma.loginAudit.create({ data: { userId, type: 'LOGOUT' } }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
