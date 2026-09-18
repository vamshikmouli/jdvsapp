import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { sendAbsenceStreakSummary } from '@/lib/services/attendanceStreaks';
import { whatsappConfigured } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

// GET|POST /api/attendance/cron/absence-streaks
// Daily: WhatsApp the admins a summary of students on a 3+ day absent/leave streak.
// Auth: `Authorization: Bearer <CRON_SECRET>`, or an admin (NOTICES_MANAGE) for a
// manual "run now". Query: ?dry=1 (compute only), ?to=NUMBER (test recipient),
// ?min=N (streak threshold, default 3).
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(await getServerSession(authOptions), 'NOTICES_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dry = sp.get('dry') === '1';
  const to = sp.get('to');
  const min = sp.get('min') ? Math.max(2, Number(sp.get('min'))) : 3;

  if (!dry && !whatsappConfigured()) {
    return NextResponse.json({ ok: false, error: 'WhatsApp not configured' }, { status: 400 });
  }
  const result = await sendAbsenceStreakSummary({ minStreak: min, dry, toOverride: to });
  return NextResponse.json({ ok: true, dry, ...result });
}

export const GET = handler;
export const POST = handler;
