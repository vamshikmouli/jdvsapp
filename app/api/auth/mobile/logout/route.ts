import { NextRequest, NextResponse } from 'next/server';
import { decode } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

const SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret-change-me';

// POST /api/auth/mobile/logout — revoke the Bearer token's UserSession so it can
// no longer authenticate. Always returns ok (idempotent).
export async function POST(req: NextRequest) {
  try {
    const authz = req.headers.get('authorization') || '';
    if (authz.startsWith('Bearer ')) {
      const token = await decode({ token: authz.slice(7).trim(), secret: SECRET }).catch(() => null);
      const sessionId = token?.sessionId as string | undefined;
      if (sessionId) {
        await prisma.userSession.updateMany({
          where: { sessionToken: sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        }).catch(() => {});
      }
    }
  } catch {
    // swallow — logout is best-effort
  }
  return NextResponse.json({ ok: true });
}
