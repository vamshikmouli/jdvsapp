import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo } from '@/lib/staffAttendance/rules';
import { parseWorkDays, parseWorkPattern, parseWeekSchedule, synthesizeDays } from '@/lib/staffAttendance/schedule';

// GET /api/staff-attendance/me
// Today's punch state + recent history + enrollment status for the signed-in
// staff member. Drives the "My attendance" self-punch screen.
export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) {
      return NextResponse.json({ error: 'No staff profile linked to this account' }, { status: 400 });
    }

    const cfg = await loadStaffAttConfig();
    const todayKey = localDayInfo(new Date(), cfg.timezone).dateKey;
    const todayDate = new Date(`${todayKey}T00:00:00Z`);

    // Calendar month (YYYY-MM), defaults to the current month.
    const monthParam = new URL(req.url).searchParams.get('month');
    const monthKey = /^\d{4}-\d{2}$/.test(monthParam || '') ? (monthParam as string) : todayKey.slice(0, 7);
    const [my, mm] = monthKey.split('-').map(Number);
    const monthStart = new Date(Date.UTC(my, mm - 1, 1));
    const monthEnd = new Date(Date.UTC(my, mm, 1) - 24 * 3600_000);

    const [cred, today, punchesToday, recent, storedMonthDays, staffRec, holidays] = await Promise.all([
      prisma.staffCredential.findFirst({
        where: { staffId, active: true },
        select: { deviceName: true, createdAt: true, lastUsedAt: true },
      }),
      prisma.staffAttendanceDay.findUnique({
        where: { staffId_date: { staffId, date: todayDate } },
      }),
      prisma.staffPunch.findMany({
        where: { staffId, at: { gte: new Date(`${todayKey}T00:00:00Z`) } },
        orderBy: { at: 'asc' },
        select: { type: true, at: true, source: true },
      }),
      prisma.staffAttendanceDay.findMany({
        where: { staffId },
        orderBy: { date: 'desc' },
        take: 14,
      }),
      prisma.staffAttendanceDay.findMany({
        where: { staffId, date: { gte: monthStart, lte: monthEnd } },
        orderBy: { date: 'asc' },
      }),
      prisma.staff.findUnique({ where: { id: staffId }, select: { weekSchedule: true, workPattern: true, workDays: true, pinHash: true } }),
      prisma.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } }, select: { date: true } }),
    ]);

    // Fill non-punch days (holidays / off days) so the calendar isn't all blank/absent.
    const existing = new Set(storedMonthDays.map((d) => d.date.toISOString().slice(0, 10)));
    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    const synthetic = synthesizeDays({
      fromKey: monthStart.toISOString().slice(0, 10),
      toKey: monthEnd.toISOString().slice(0, 10),
      todayKey,
      existing,
      holidays: holidaySet,
      weekSchedule: parseWeekSchedule(staffRec?.weekSchedule),
      workPattern: parseWorkPattern(staffRec?.workPattern),
      workDays: parseWorkDays(staffRec?.workDays),
      weeklyOffDays: cfg.schedule.weeklyOffDays,
    });
    const monthDays = [...storedMonthDays, ...synthetic];

    const lastPunch = punchesToday[punchesToday.length - 1];
    const open = lastPunch?.type === 'IN';

    return NextResponse.json({
      enabled: cfg.enabled,
      configured: cfg.geofence.schoolLat != null && cfg.geofence.schoolLng != null,
      enrolled: !!cred,
      hasPin: !!staffRec?.pinHash,
      device: cred ?? null,
      nextAction: open ? 'OUT' : 'IN',
      today: today ?? null,
      punchesToday: punchesToday.filter((p) => localDayInfo(p.at, cfg.timezone).dateKey === todayKey),
      recent,
      todayKey,
      month: monthKey,
      monthDays,
      // School location so the staff screen can show "you vs assigned location".
      geofence:
        cfg.geofence.schoolLat != null && cfg.geofence.schoolLng != null
          ? {
              schoolLat: cfg.geofence.schoolLat,
              schoolLng: cfg.geofence.schoolLng,
              radiusM: cfg.geofence.geofenceRadiusM,
              accuracyMaxM: cfg.geofence.gpsAccuracyMaxM,
            }
          : null,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
