import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { parseUA } from '@/lib/ua';

// GET /api/push/devices — admin list of everyone who installed/enabled the app, with device names.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const subs = await prisma.pushSubscription.findMany({
      orderBy: { lastUsedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true, name: true, phone: true, email: true,
            guardianOf: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Group by user (a parent may install on several devices).
    const byUser = new Map<string, any>();
    for (const s of subs) {
      const u = s.user;
      if (!u) continue;
      const ua = parseUA(s.userAgent);
      if (!byUser.has(u.id)) {
        byUser.set(u.id, {
          userId: u.id,
          name: u.name,
          phone: u.phone || u.email,
          children: u.guardianOf.map((c) => c.name),
          devices: [],
        });
      }
      byUser.get(u.id).devices.push({
        id: s.id,
        device: ua.device,
        os: ua.os,
        browser: ua.browser,
        label: ua.label,
        enabledAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
      });
    }

    const users = Array.from(byUser.values());
    return NextResponse.json({
      totalDevices: subs.length,
      totalUsers: users.length,
      users,
    });
  } catch (err) {
    console.error('push devices', err);
    return NextResponse.json({ error: 'Failed to load devices' }, { status: 500 });
  }
}
