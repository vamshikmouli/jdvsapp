import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { runBirthdayWishes } from '@/lib/birthdays';

export const dynamic = 'force-dynamic';

// POST (or GET) /api/birthdays/cron
// Sends today's birthday wishes (push + bell) to parents of birthday students and to
// birthday staff. Fire once each morning via VM cron (e.g. 8:00 AM IST). Safe to re-run:
// a wish already sent today is skipped.
//
// Auth: `Authorization: Bearer <CRON_SECRET>`, or an admin with NOTICES_MANAGE.
// ?dry=1 — list who has a birthday today, send nothing.
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(await getServerSession(authOptions), 'NOTICES_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const out = await runBirthdayWishes({ dry: req.nextUrl.searchParams.get('dry') === '1' });
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    console.error('birthdays cron', err);
    return NextResponse.json({ error: 'Failed to send birthday wishes' }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
