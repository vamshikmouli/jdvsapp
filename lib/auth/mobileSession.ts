import { headers } from 'next/headers';
import { getServerSession } from 'next-auth';
import { decode } from 'next-auth/jwt';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';

const SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret-change-me';

/**
 * Resolve the signed-in user id from EITHER:
 *  - the mobile app's `Authorization: Bearer <jwt>` (a NextAuth-encoded token
 *    minted by /api/auth/mobile/login), validated against UserSession so a
 *    logged-out / revoked session stops working — same guarantee the web has; or
 *  - the web session cookie (getServerSession), unchanged.
 *
 * Returns the userId, or null when neither is present/valid. Route handlers can
 * read it without threading `req` — the Bearer is pulled from next/headers.
 */
export async function getRequestUserId(): Promise<string | null> {
  // 1) Mobile Bearer token
  const authz = (await headers()).get('authorization') || '';
  if (authz.startsWith('Bearer ')) {
    const raw = authz.slice(7).trim();
    try {
      const token = await decode({ token: raw, secret: SECRET });
      const id = token?.id as string | undefined;
      const sessionId = token?.sessionId as string | undefined;
      if (id && sessionId) {
        const sess = await prisma.userSession.findUnique({
          where: { sessionToken: sessionId },
          select: { revokedAt: true },
        });
        if (sess && !sess.revokedAt) return id;
      }
    } catch {
      // malformed / expired token → fall through to cookie session
    }
  }

  // 2) Web session cookie
  const session = await getServerSession(authOptions);
  return ((session?.user as any)?.id as string | undefined) ?? null;
}
