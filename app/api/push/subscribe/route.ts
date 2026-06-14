import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';

// POST /api/push/subscribe — store (or refresh) a browser push subscription for the signed-in user.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sub = await req.json();
    const endpoint = sub?.endpoint as string | undefined;
    const p256dh = sub?.keys?.p256dh as string | undefined;
    const auth = sub?.keys?.auth as string | undefined;
    if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });

    const userAgent = req.headers.get('user-agent') || null;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh, auth, userAgent, userId },
      update: { p256dh, auth, userAgent, userId, lastUsedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('push subscribe', err);
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 400 });
  }
}

// DELETE /api/push/subscribe — remove a subscription (e.g. user turns notifications off).
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { endpoint } = await req.json().catch(() => ({}));
    if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('push unsubscribe', err);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 400 });
  }
}
