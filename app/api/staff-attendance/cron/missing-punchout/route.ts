import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { sendPushToUsers } from '@/lib/push';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo, parseHm } from '@/lib/staffAttendance/rules';

export const dynamic = 'force-dynamic';

// POST (or GET) /api/staff-attendance/cron/missing-punchout
// Remind staff who are still punched IN after shift end to punch out.
// Auth: Vercel Cron's `Authorization: Bearer <CRON_SECRET>` header, or an admin
// with STAFF_ATTENDANCE_MANAGE (for a manual "send now").
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(await getServerSession(authOptions), 'STAFF_ATTENDANCE_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cfg = await loadStaffAttConfig();
  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' });

  const now = new Date();
  const { dateKey, minutesOfDay } = localDayInfo(now, cfg.timezone);
  // Only nag after shift end (unless forced).
  if (req.nextUrl.searchParams.get('force') !== '1' && minutesOfDay < parseHm(cfg.schedule.shiftEnd)) {
    return NextResponse.json({ ok: true, skipped: 'before shift end' });
  }

  const date = new Date(`${dateKey}T00:00:00Z`);
  const open = await prisma.staffAttendanceDay.findMany({
    where: { date, firstIn: { not: null }, lastOut: null, status: { notIn: ['LEAVE', 'HOLIDAY', 'WEEKLY_OFF'] } },
    include: { staff: { select: { userId: true, name: true } } },
  });

  let reminded = 0;
  for (const d of open) {
    if (!d.staff.userId) continue;
    const res = await sendPushToUsers([d.staff.userId], {
      title: 'Don’t forget to punch out',
      body: 'You’re still marked as present. Tap to punch out before you leave.',
      url: '/admin/my-attendance',
      tag: `punchout-${dateKey}`,
    });
    if (res.sent > 0) reminded++;
  }

  return NextResponse.json({ ok: true, candidates: open.length, reminded });
}

export const GET = handler;
export const POST = handler;
