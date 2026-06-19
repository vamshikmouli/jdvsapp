import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { hashPassword } from '@/lib/auth/password';
import crypto from 'crypto';

// POST /api/users/[id]/reset-pin
// Admin resets a user's login: sets a random temporary PIN, clears the "PIN set"
// flag (so they're forced to choose their own PIN on next login), unlocks the
// account, and signs out their other devices. Returns the temp PIN to hand over.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermission('USERS_MANAGE');
    const user = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 6-digit temporary PIN (avoid leading-zero loss by ranging 100000–999999).
    const tempPin = String(crypto.randomInt(100000, 1000000));
    const passwordHash = await hashPassword(tempPin);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: null, loginAttempts: 0, lockedUntil: null, initialPin: tempPin },
      }),
      prisma.userSession.deleteMany({ where: { userId: user.id } }), // sign out all devices
      prisma.loginAudit.create({ data: { userId: user.id, type: 'PASSWORD_RESET', detail: 'Admin reset PIN' } }),
    ]);

    return NextResponse.json({ ok: true, name: user.name, tempPin });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
