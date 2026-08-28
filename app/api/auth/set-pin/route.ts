import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { consumeSetPinGrant, OtpError } from '@/lib/auth/otp';
import { findAccountsByPhone } from '@/lib/auth/accounts';

// POST /api/auth/set-pin — first-time PIN setup. Two authorized paths:
//   A) Grant path (NOT logged in): { pin, phone, grantToken } after a WhatsApp OTP.
//      Sets the PIN on every account for that phone still on the default
//      (passwordChangedAt == null): first login, or after an admin reset. It will
//      NOT change an already-set PIN — self-service reset is admin-only.
//   B) Session path (logged in): { pin } — the original flow, only while the
//      logged-in user's passwordChangedAt is null.
// Returns { ok, accounts } on the grant path so the client can sign in (one
// account) or show a role-picker (multiple), using each account's `email`.

function pinError(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'PIN must be 4 to 6 digits.';
  if (/^(\d)\1+$/.test(pin) || pin === '1234' || pin === '123456') return 'Please choose a less obvious PIN.';
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { pin, phone, grantToken } = await req.json();
    const pinStr = String(pin || '');
    const bad = pinError(pinStr);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });

    // ---------- A) OTP grant path (unauthenticated first-login) ----------
    if (grantToken) {
      const verifiedPhone = await consumeSetPinGrant(String(phone || ''), String(grantToken));
      const accounts = await findAccountsByPhone(verifiedPhone);
      const toSet = accounts.filter((a) => a.mustSetPin);
      if (toSet.length === 0) {
        return NextResponse.json(
          { error: 'You already have a PIN. Contact the office to reset it.' },
          { status: 409 },
        );
      }

      const passwordHash = await hashPassword(pinStr);
      await prisma.$transaction([
        prisma.user.updateMany({
          where: { id: { in: toSet.map((a) => a.userId) } },
          data: { passwordHash, passwordChangedAt: new Date(), initialPin: null, loginAttempts: 0, lockedUntil: null },
        }),
        prisma.loginAudit.createMany({
          data: toSet.map((a) => ({ userId: a.userId, type: 'PASSWORD_CHANGED' as const, detail: 'PIN set via OTP' })),
        }),
      ]);

      // Hand back what the client needs to sign in / role-pick.
      return NextResponse.json({
        ok: true,
        accounts: toSet.map((a) => ({
          email: a.email,
          displayName: a.displayName,
          roleName: a.roleName,
          surface: a.surface,
        })),
      });
    }

    // ---------- B) Session path (original behavior) ----------
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordChangedAt: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.passwordChangedAt != null) {
      return NextResponse.json({ error: 'A PIN is already set. Use Change password.' }, { status: 409 });
    }

    const passwordHash = await hashPassword(pinStr);
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date(), initialPin: null } }),
      prisma.loginAudit.create({ data: { userId, type: 'PASSWORD_CHANGED', detail: 'PIN set' } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof OtpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('set-pin error:', err);
    return NextResponse.json({ error: 'Could not set PIN' }, { status: 500 });
  }
}
