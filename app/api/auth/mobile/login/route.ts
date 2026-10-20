import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { encode } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { normalizePhone } from '@/lib/auth/provision';

const SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret-change-me';
const SESSION_MAX_AGE = (Number(process.env.SESSION_MAX_AGE_DAYS) || 365) * 24 * 60 * 60;
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_MINUTES = Number(process.env.ACCOUNT_LOCKOUT_MINUTES) || 30;

function clientIp(req: NextRequest): string | undefined {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || undefined;
}

// POST /api/auth/mobile/login  { identifier, pin, platform }
// Everyday PIN sign-in for the parent app. Verifies the PIN (same bcrypt hash as
// the web login), opens a UserSession, and returns a NextAuth-encoded JWT the app
// sends as `Authorization: Bearer <token>`. The parent API accepts it via
// getRequestUserId() (see lib/auth/mobileSession.ts).
export async function POST(req: NextRequest) {
  try {
    const { identifier, pin, platform } = await req.json();
    if (!identifier || !pin) {
      return NextResponse.json({ error: 'Phone and PIN are required.' }, { status: 400 });
    }

    const id = String(identifier).trim();
    const email = id.toLowerCase();
    const phone = normalizePhone(id);
    const ip = clientIp(req);
    const userAgent = req.headers.get('user-agent') || `mobile/${platform || 'unknown'}`;

    const user = await prisma.user.findFirst({
      where: { OR: [{ email }, ...(phone ? [{ phone }, { phone: id }] : [])] },
      include: { role: { include: { permissions: true } }, staff: { select: { id: true } } },
    });

    const fail = async (detail: string, status: number, message: string) => {
      await prisma.loginAudit.create({
        data: { userId: user?.id, email: id, type: 'LOGIN_FAILED', ip, userAgent, detail },
      }).catch(() => {});
      return NextResponse.json({ error: message }, { status });
    };

    if (!user) return fail('No such user', 401, 'Invalid phone or PIN.');
    if (!user.isActive) return fail('Account inactive', 403, 'Your account is disabled. Contact the school office.');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return fail('Account locked', 423, 'Account locked due to failed attempts. Try again later.');
    }
    if (process.env.FORCE_OTP_FIRST_LOGIN === 'true' && user.passwordChangedAt == null) {
      return fail('First login requires OTP', 403, 'First-time login: verify by WhatsApp to set your PIN.');
    }

    const ok = await verifyPassword(String(pin), user.passwordHash);
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
      return fail(
        `Wrong PIN (attempt ${attempts})`,
        401,
        lock ? `Too many attempts. Locked for ${LOCKOUT_MINUTES} minutes.` : 'Invalid phone or PIN.',
      );
    }

    // Parent app is for guardians (and admins/support who may assist).
    const childrenCount = await prisma.student.count({ where: { guardianUserId: user.id } });
    const isParent = childrenCount > 0;
    const surface = user.role.baseSurface;
    if (!isParent && !['PARENT', 'ADMIN'].includes(surface)) {
      return fail('Not a parent account', 403, 'This account is not linked to any student.');
    }

    // Success — open a session and mint the token.
    const sessionToken = randomUUID();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: 0, lockedUntil: null, lastLogin: new Date(), lastLoginIp: ip },
      }),
      prisma.userSession.create({ data: { userId: user.id, sessionToken, userAgent, ip } }),
      prisma.loginAudit.create({ data: { userId: user.id, email, type: 'LOGIN', ip, userAgent } }),
    ]);

    const token = await encode({
      secret: SECRET,
      maxAge: SESSION_MAX_AGE,
      token: {
        id: user.id,
        sub: user.id,
        name: user.name,
        email: user.email,
        roleKey: user.role.key,
        roleName: user.role.name,
        surface,
        perms: user.role.permissions.map((p) => p.permission),
        staffId: user.staff?.id ?? null,
        isParent,
        mustSetPin: user.passwordChangedAt == null,
        sessionId: sessionToken,
      },
    });

    return NextResponse.json({
      token,
      user: { id: user.id, name: user.name, surface: 'PARENT', roleKey: user.role.key },
    });
  } catch (err) {
    console.error('mobile login error:', err);
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
