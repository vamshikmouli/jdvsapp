import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRequestUserId } from '@/lib/auth/mobileSession';

// POST /api/push/register  { token, platform?, deviceName? }
// The native app registers its Expo push token so the school can notify this
// device. Authenticated via the mobile Bearer (or web cookie). Idempotent —
// re-registering the same token just refreshes its owner + lastUsedAt.
export async function POST(req: NextRequest) {
  try {
    const userId = await getRequestUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { token, platform, deviceName } = await req.json();
    if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken')) {
      return NextResponse.json({ error: 'Invalid push token' }, { status: 400 });
    }

    await prisma.expoPushToken.upsert({
      where: { token },
      create: { token, userId, platform: platform ?? null, deviceName: deviceName ?? null },
      update: { userId, platform: platform ?? null, deviceName: deviceName ?? null, lastUsedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('push register error:', err);
    return NextResponse.json({ error: 'Failed to register' }, { status: 500 });
  }
}

// DELETE /api/push/register  { token }  — unregister this device (on sign-out).
export async function DELETE(req: NextRequest) {
  try {
    const { token } = await req.json().catch(() => ({}));
    if (token) await prisma.expoPushToken.deleteMany({ where: { token } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
