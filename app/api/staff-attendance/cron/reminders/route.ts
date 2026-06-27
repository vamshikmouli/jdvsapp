import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { sendPushToUsers } from '@/lib/push';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo } from '@/lib/staffAttendance/rules';
import {
  daySession, sessionTimes, isShortDay,
  parseWeekSchedule, parseWorkPattern, parseWorkDays,
} from '@/lib/staffAttendance/schedule';

export const dynamic = 'force-dynamic';

// POST (or GET) /api/staff-attendance/cron/reminders
// Push reminders timed to each staff member's own working window:
//   - punch IN : ~10 min before their session start, if not yet punched in
//   - punch OUT: ~10 min before their session end, if still punched in
// One route, fired at the few relevant clock times (see vercel.json). Each run
// only acts on staff whose start/end is near "now", so the same route safely
// covers morning, afternoon, and the Saturday short day.
//
// Auth: Vercel Cron's `Authorization: Bearer <CRON_SECRET>`, or an admin with
// STAFF_ATTENDANCE_MANAGE (for a manual "send now"). `?force=in|out|1` bypasses
// the time window so an admin can test immediately.
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(await getServerSession(authOptions), 'STAFF_ATTENDANCE_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cfg = await loadStaffAttConfig();
  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' });

  const force = req.nextUrl.searchParams.get('force'); // 'in' | 'out' | '1' | null
  const wantIn = force === 'in' || force === '1' || force === null;
  const wantOut = force === 'out' || force === '1' || force === null;

  const now = new Date();
  const { dateKey, minutesOfDay, weekday } = localDayInfo(now, cfg.timezone);
  const date = new Date(`${dateKey}T00:00:00Z`);
  // Fire ~10 min before the target. Wide band (target-15 .. target+10) so a
  // late external trigger (GitHub Actions cron can drift several minutes) still
  // lands in the window. Sessions are hours apart, so bands never overlap.
  const near = (target: number) => force ? true : minutesOfDay >= target - 15 && minutesOfDay <= target + 10;

  const [staff, days, holiday] = await Promise.all([
    prisma.staff.findMany({
      where: { archived: false, userId: { not: null }, NOT: { user: { role: { key: 'admin' } } } },
      select: { id: true, userId: true, weekSchedule: true, workPattern: true, workDays: true },
    }),
    prisma.staffAttendanceDay.findMany({
      where: { date },
      select: { staffId: true, firstIn: true, lastOut: true, status: true },
    }),
    prisma.holiday.findUnique({ where: { date }, select: { id: true } }),
  ]);
  if (holiday) return NextResponse.json({ ok: true, skipped: 'holiday' });

  const byStaff = new Map(days.map((d) => [d.staffId, d]));
  const punchInUsers: string[] = [];
  const punchOutUsers: string[] = [];

  for (const s of staff) {
    const session = daySession(
      weekday,
      parseWeekSchedule(s.weekSchedule),
      { workPattern: parseWorkPattern(s.workPattern), workDays: parseWorkDays(s.workDays) },
      cfg.schedule.weeklyOffDays
    );
    if (session === 'OFF') continue;
    const times = sessionTimes(session, isShortDay(weekday), cfg.schedule);
    if (!times) continue;

    const day = byStaff.get(s.id);
    if (day?.status === 'LEAVE') continue; // on approved leave today — don't nag

    // Punch IN: hasn't punched in yet, and their start is ~now.
    if (wantIn && !day?.firstIn && near(times.startMin)) {
      punchInUsers.push(s.userId!);
    }
    // Punch OUT: punched in, not out yet, and their end is ~now.
    if (wantOut && day?.firstIn && !day.lastOut && near(times.endMin)) {
      punchOutUsers.push(s.userId!);
    }
  }

  let inSent = 0, outSent = 0;
  if (punchInUsers.length) {
    const r = await sendPushToUsers(punchInUsers, {
      title: 'Time to punch in',
      body: 'Your shift is about to start. Don’t forget to punch in when you arrive.',
      url: '/admin/my-attendance',
      tag: `punchin-${dateKey}`,
    });
    inSent = r.sent;
  }
  if (punchOutUsers.length) {
    const r = await sendPushToUsers(punchOutUsers, {
      title: 'Don’t forget to punch out',
      body: 'You’re still marked as present. Tap to punch out before you leave.',
      url: '/admin/my-attendance',
      tag: `punchout-${dateKey}`,
    });
    outSent = r.sent;
  }

  return NextResponse.json({
    ok: true,
    punchIn: { candidates: punchInUsers.length, sent: inSent },
    punchOut: { candidates: punchOutUsers.length, sent: outSent },
  });
}

export const GET = handler;
export const POST = handler;
