import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo } from '@/lib/staffAttendance/rules';

// GET /api/staff-attendance?date=YYYY-MM-DD
// Daily board: every active staff member with their roll-up for the date.
export async function GET(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_VIEW');
    const cfg = await loadStaffAttConfig();

    const qDate = new URL(req.url).searchParams.get('date');
    const dateKey = qDate || localDayInfo(new Date(), cfg.timezone).dateKey;
    const date = new Date(`${dateKey}T00:00:00Z`);

    const [staff, days] = await Promise.all([
      prisma.staff.findMany({
        where: { archived: false },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          designation: true,
          pinHash: true,
          attCredentials: { where: { active: true }, select: { id: true } },
        },
      }),
      prisma.staffAttendanceDay.findMany({ where: { date } }),
    ]);

    const byStaff = new Map(days.map((d) => [d.staffId, d]));

    const rows = staff.map((s) => {
      const day = byStaff.get(s.id);
      return {
        staffId: s.id,
        name: s.name,
        designation: s.designation,
        hasDevice: s.attCredentials.length > 0,
        hasPin: !!s.pinHash,
        status: day?.status ?? 'ABSENT',
        late: day?.late ?? false,
        lateMinutes: day?.lateMinutes ?? 0,
        firstIn: day?.firstIn ?? null,
        lastOut: day?.lastOut ?? null,
        workedMinutes: day?.workedMinutes ?? 0,
        locked: day?.locked ?? false,
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

    return NextResponse.json({ date: dateKey, rows, summary });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
