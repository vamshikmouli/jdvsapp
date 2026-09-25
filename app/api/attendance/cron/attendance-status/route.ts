import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { sendAttendanceStatusReport } from '@/lib/services/attendanceStatus';
import { whatsappConfigured } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

// GET|POST /api/attendance/cron/attendance-status
// Daily (11:00 AM IST): WhatsApp the configured recipients which classes have
// submitted student attendance today and which are still pending.
// Auth: `Authorization: Bearer <CRON_SECRET>`, or an admin (ATTENDANCE_MANAGE /
// NOTICES_MANAGE) for a manual run. ?dry=1 computes only; ?to=NUMBER test recipient.
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const session = await getServerSession(authOptions);
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(session, 'ATTENDANCE_LOCK') || can(session, 'NOTICES_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dry = sp.get('dry') === '1';
  const to = sp.get('to');
  if (!dry && !whatsappConfigured()) return NextResponse.json({ ok: false, error: 'WhatsApp not configured' }, { status: 400 });

  const result = await sendAttendanceStatusReport({ dry, toOverride: to });
  return NextResponse.json({ ok: true, dry, ...result });
}

export const GET = handler;
export const POST = handler;
