import { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { normalizePhone } from '@/lib/auth/provision';

const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_MINUTES = Number(process.env.ACCOUNT_LOCKOUT_MINUTES) || 30;
const SESSION_MAX_AGE = (Number(process.env.SESSION_MAX_AGE_DAYS) || 365) * 24 * 60 * 60;

function clientIp(req: any): string | undefined {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req?.headers?.['x-real-ip'];
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email or phone', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email/phone and password are required');
        }
        const identifier = credentials.email.trim();
        const email = identifier.toLowerCase();
        const phone = normalizePhone(identifier);
        const ip = clientIp(req);
        const userAgent = (req?.headers?.['user-agent'] as string) || undefined;

        // Match by email OR phone (staff/parents may log in with their phone number)
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { email },
              ...(phone ? [{ phone }, { phone: identifier }] : []),
            ],
          },
          include: { role: { include: { permissions: true } }, staff: true },
        });

        // Generic failure helper (avoid leaking which part failed)
        const failAudit = async (detail: string) => {
          await prisma.loginAudit.create({
            data: { userId: user?.id, email: identifier, type: 'LOGIN_FAILED', ip, userAgent, detail },
          });
        };

        if (!user) {
          await failAudit('No such user');
          throw new Error('Invalid email or password');
        }

        if (!user.isActive) {
          await failAudit('Account inactive');
          throw new Error('Your account is disabled. Contact your administrator.');
        }

        // Account lockout
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await failAudit('Account locked');
          throw new Error('Account locked due to failed attempts. Try again later.');
        }

        // Verify password
        const ok = await verifyPassword(credentials.password, user.passwordHash);
        if (!ok) {
          const attempts = user.loginAttempts + 1;
          const lock = attempts >= MAX_LOGIN_ATTEMPTS;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              loginAttempts: attempts,
              lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
            },
          });
          await failAudit(`Wrong password (attempt ${attempts})`);
          throw new Error(
            lock
              ? `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`
              : 'Invalid email or password'
          );
        }

        // Success — reset counters, record login, create a session row
        const sessionToken = randomUUID();
        await prisma.$transaction([
          prisma.user.update({
            where: { id: user.id },
            data: { loginAttempts: 0, lockedUntil: null, lastLogin: new Date(), lastLoginIp: ip },
          }),
          prisma.userSession.create({
            data: { userId: user.id, sessionToken, userAgent, ip },
          }),
          prisma.loginAudit.create({
            data: { userId: user.id, email, type: 'LOGIN', ip, userAgent },
          }),
        ]);

        // Is this account also a guardian of students? (dual staff + parent)
        const childrenCount = await prisma.student.count({ where: { guardianUserId: user.id } });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roleKey: user.role.key,
          roleName: user.role.name,
          surface: user.role.baseSurface,
          perms: user.role.permissions.map((p) => p.permission),
          staffId: user.staff?.id ?? null,
          isParent: childrenCount > 0,
          sessionId: sessionToken,
        } as any;
      },
    }),
  ],
  pages: { signIn: '/', error: '/' },
  callbacks: {
    async jwt({ token, user }) {
      // Initial sign-in: persist identity + RBAC + session id
      if (user) {
        const u = user as any;
        token.id = u.id;
        token.roleKey = u.roleKey;
        token.roleName = u.roleName;
        token.surface = u.surface;
        token.perms = u.perms;
        token.staffId = u.staffId;
        token.isParent = u.isParent;
        token.sessionId = u.sessionId;
        return token;
      }

      // Subsequent calls: verify the session hasn't been revoked.
      // (Force re-login on role/permission change works by deleting UserSession rows.)
      if (token.sessionId) {
        const sess = await prisma.userSession.findUnique({
          where: { sessionToken: token.sessionId as string },
          select: { revokedAt: true },
        });
        if (!sess || sess.revokedAt) {
          // Revoked / missing → clear the token (effectively logs the user out)
          return {} as any;
        }
        // Touch lastSeen (cheap, keeps the device list fresh)
        prisma.userSession
          .update({ where: { sessionToken: token.sessionId as string }, data: { lastSeenAt: new Date() } })
          .catch(() => {});
      }
      return token;
    },
    async session({ session, token }) {
      if (token && token.id) {
        (session.user as any).id = token.id;
        (session.user as any).roleKey = token.roleKey;
        (session.user as any).roleName = token.roleName;
        (session.user as any).surface = token.surface;
        (session.user as any).perms = token.perms || [];
        (session.user as any).staffId = token.staffId ?? null;
        (session.user as any).isParent = !!token.isParent;
        // Keep on both user and top-level — custom user fields survive getServerSession reliably.
        (session.user as any).sessionId = token.sessionId;
        (session as any).sessionId = token.sessionId;
      } else {
        // Token was cleared (revoked) — strip the session user
        (session as any).user = undefined;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE, // ~1 year — effectively "until logout" (no idle timeout)
    updateAge: 24 * 60 * 60, // slide the cookie at most once/day
  },
  secret: process.env.NEXTAUTH_SECRET || 'dev-secret-change-me',
};
