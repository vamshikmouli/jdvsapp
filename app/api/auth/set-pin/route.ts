import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

// POST /api/auth/set-pin — first-time PIN setup for a logged-in user still on the
// default (phone-number) password. Only allowed while passwordChangedAt is null,
// so it can't be used to bypass the current-password check for already-set users.
// Body: { pin }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { pin } = await req.json();
    if (!/^\d{4,6}$/.test(String(pin || ''))) {
      return NextResponse.json({ error: 'PIN must be 4 to 6 digits.' }, { status: 400 });
    }
    // Reject trivially weak PINs.
    if (/^(\d)\1+$/.test(pin) || pin === '1234' || pin === '123456') {
      return NextResponse.json({ error: 'Please choose a less obvious PIN.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordChangedAt: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.passwordChangedAt != null) {
      // Already set a password — use the normal change-password flow instead.
      return NextResponse.json({ error: 'A PIN is already set. Use Change password.' }, { status: 409 });
    }

    const passwordHash = await hashPassword(String(pin));
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date(), initialPin: null } }),
      prisma.loginAudit.create({ data: { userId, type: 'PASSWORD_CHANGED', detail: 'PIN set' } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('set-pin error:', err);
    return NextResponse.json({ error: 'Could not set PIN' }, { status: 500 });
  }
}
