import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/auth/password';

// POST /api/auth/change-password — logged-in user changes their own password.
// Revokes all OTHER sessions (keeps current device signed in).
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const currentSessionId = ((session?.user as any)?.sessionId ?? (session as any)?.sessionId) as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both current and new password are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });

    const errors = validatePasswordStrength(newPassword);
    if (errors.length) return NextResponse.json({ error: errors.join('. ') }, { status: 400 });

    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        // Clear the admin-visible initial PIN — the user has set their own password.
        data: { passwordHash, passwordChangedAt: new Date(), initialPin: null },
      }),
      // Revoke all other devices (keep current session active)
      prisma.userSession.deleteMany({
        where: { userId, sessionToken: { not: currentSessionId ?? '' } },
      }),
      prisma.loginAudit.create({ data: { userId, type: 'PASSWORD_CHANGED' } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('change-password error:', err);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
