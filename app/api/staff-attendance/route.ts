import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo } from '@/lib/staffAttendance/rules';
import { parseWorkDays, parseWorkPattern, parseWeekSchedule, daySession, emptyStatusForSession, weekdayOfKey } from '@/lib/staffAttendance/schedule';

// GET /api/staff-attendance?date=YYYY-MM-DD
// Daily board: every active staff member with their roll-up for the date.
export async function GET(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_VIEW');
    const cfg = await loadStaffAttConfig();

    const qDate = new URL(req.url).searchParams.get('date');
    const dateKey = qDate || localDayInfo(new Date(), cfg.timezone).dateKey;
    const date = new Date(`${dateKey}T00:00:00Z`);

    const [staff, days, holiday] = await Promise.all([
      prisma.staff.findMany({
        // Admins aren't tracked for attendance — exclude admin-role staff.
        // Staff with no linked user account are kept (regular non-login staff).
        where: { archived: false, NOT: { user: { role: { key: 'admin' } } } },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          designation: true,
          pinHash: true,
          weekSchedule: true,
          workPattern: true,
          workDays: true,
          attCredentials: { where: { active: true }, select: { id: true } },
        },
      }),
      prisma.staffAttendanceDay.findMany({ where: { date } }),
      prisma.holiday.findUnique({ where: { date }, select: { name: true } }),
    ]);

    const byStaff = new Map(days.map((d) => [d.staffId, d]));

    // Current running streak per staff: the streak on their most recent stored day
    // on/before the viewed date. This keeps a streak visible on off-days and on
    // days not yet marked (it only drops to 0 once an absent/leave row exists).
    const latestStreakRows = await prisma.staffAttendanceDay.findMany({
      where: { staffId: { in: staff.map((s) => s.id) }, date: { lte: date } },
      orderBy: [{ staffId: 'asc' }, { date: 'desc' }],
      distinct: ['staffId'],
      select: { staffId: true, currentStreak: true },
    });
    const streakByStaff = new Map(latestStreakRows.map((r) => [r.staffId, r.currentStreak]));

    const weekday = weekdayOfKey(dateKey);
    const weeklyOff = cfg.schedule.weeklyOffDays;

    const rows = staff.map((s) => {
      const day = byStaff.get(s.id);
      // No stored row → derive the expected status (holiday / off / absent) from
      // the staff member's session for this weekday.
      const session = daySession(weekday, parseWeekSchedule(s.weekSchedule), { workPattern: parseWorkPattern(s.workPattern), workDays: parseWorkDays(s.workDays) }, weeklyOff);
      const fallback = emptyStatusForSession(session, !!holiday);
      return {
        staffId: s.id,
        name: s.name,
        designation: s.designation,
        hasDevice: s.attCredentials.length > 0,
        hasPin: !!s.pinHash,
        status: day?.status ?? fallback,
        late: day?.late ?? false,
        lateMinutes: day?.lateMinutes ?? 0,
        firstIn: day?.firstIn ?? null,
        lastOut: day?.lastOut ?? null,
        workedMinutes: day?.workedMinutes ?? 0,
        locked: day?.locked ?? false,
        currentStreak: streakByStaff.get(s.id) ?? 0,
      };
    });

    const summary = rows.reduce(
      (acc, r) => {
        acc.total += 1;
        if (r.status === 'PRESENT') acc.present += 1;
        else if (r.status === 'HALF_DAY') acc.halfDay += 1;
        else if (r.status === 'LEAVE') acc.leave += 1;
        else if (r.status === 'HOLIDAY' || r.status === 'WEEKLY_OFF') acc.off += 1;
        else acc.absent += 1;
        if (r.late) acc.late += 1;
        return acc;
      },
      { total: 0, present: 0, halfDay: 0, absent: 0, leave: 0, off: 0, late: 0 }
    );

    return NextResponse.json({ date: dateKey, rows, summary, holiday: holiday?.name ?? null });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
