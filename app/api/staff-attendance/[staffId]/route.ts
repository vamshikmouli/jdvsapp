import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { parseWorkDays, parseWorkPattern, parseWeekSchedule, synthesizeDays } from '@/lib/staffAttendance/schedule';

// GET /api/staff-attendance/[staffId]?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per-staff attendance history (day roll-ups) + raw punches in the range.
export async function GET(req: NextRequest, { params }: { params: { staffId: string } }) {
  try {
    await requirePermission('STAFF_ATTENDANCE_VIEW');
    const { staffId } = params;
    const cfg = await loadStaffAttConfig();

    const sp = new URL(req.url).searchParams;
    const to = sp.get('to') ? new Date(`${sp.get('to')}T00:00:00Z`) : new Date();
    const from = sp.get('from')
      ? new Date(`${sp.get('from')}T00:00:00Z`)
      : new Date(to.getTime() - 30 * 24 * 3600_000);

    const [staff, storedDays, punches, holidays] = await Promise.all([
      prisma.staff.findUnique({
        where: { id: staffId },
        select: {
          id: true,
          name: true,
          designation: true,
          pinHash: true,
          weekSchedule: true,
          workPattern: true,
          workDays: true,
          attCredentials: { where: { active: true }, select: { deviceName: true, lastUsedAt: true } },
        },
      }),
      prisma.staffAttendanceDay.findMany({
        where: { staffId, date: { gte: from, lte: to } },
        orderBy: { date: 'desc' },
      }),
      prisma.staffPunch.findMany({
        where: { staffId, at: { gte: from } },
        orderBy: { at: 'desc' },
        take: 200,
      }),
      prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } }),
    ]);

    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });

    // Which half is off for half-day leaves → split calendar cell.
    const halfLeaves = await prisma.leaveRequest.findMany({
      where: { staffId, status: 'APPROVED', halfDay: true, fromDate: { gte: from, lte: to } },
      select: { fromDate: true, halfSession: true },
    });
    const halfSessionByDate = new Map(halfLeaves.map((l) => [l.fromDate.toISOString().slice(0, 10), l.halfSession]));

    const todayKey = new Date().toISOString().slice(0, 10);
    const existing = new Set(storedDays.map((d) => d.date.toISOString().slice(0, 10)));
    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    const synthetic = synthesizeDays({
      fromKey: from.toISOString().slice(0, 10),
      toKey: to.toISOString().slice(0, 10),
      todayKey,
      existing,
      holidays: holidaySet,
      weekSchedule: parseWeekSchedule(staff.weekSchedule),
      workPattern: parseWorkPattern(staff.workPattern),
      workDays: parseWorkDays(staff.workDays),
      weeklyOffDays: cfg.schedule.weeklyOffDays,
    });

    return NextResponse.json({
      staff: {
        id: staff.id,
        name: staff.name,
        designation: staff.designation,
        hasPin: !!staff.pinHash,
        device: staff.attCredentials[0] ?? null,
        weekSchedule: parseWeekSchedule(staff.weekSchedule),
      },
      days: [
        ...storedDays.map((d) => ({ ...d, halfSession: halfSessionByDate.get(d.date.toISOString().slice(0, 10)) ?? null })),
        ...synthetic,
      ],
      punches,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
