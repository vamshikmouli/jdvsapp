import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { notifyRegularizationRequest } from '@/lib/notifications';
import type { PunchType, StaffDayStatus } from '@prisma/client';

/** Convert a wall-clock date+time in an IANA timezone to the true UTC instant. */
function zonedWallTimeToUtc(dateKey: string, hh: number, mm: number, tz: string): Date {
  const naiveUtc = new Date(`${dateKey}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  // How that same instant reads in the target tz vs UTC gives the offset to subtract.
  const inTz = new Date(naiveUtc.toLocaleString('en-US', { timeZone: tz }));
  const inUtc = new Date(naiveUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naiveUtc.getTime() - (inTz.getTime() - inUtc.getTime()));
}

// GET /api/staff-attendance/regularization
// Admin lists pending regularization requests
export async function GET(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const status = req.nextUrl.searchParams.get('status') || 'PENDING';

    const requests = await prisma.attendanceRegularizationRequest.findMany({
      where: { status: status as any },
      include: { staff: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(requests);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// POST /api/staff-attendance/regularization
// Staff submits a regularization request
//   { date: 'YYYY-MM-DD', punchType: 'IN'|'OUT', punchTime: 'HH:mm', reason? }
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const userId = (session.user as any)?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get staff ID from user ID
    const staff = await prisma.staff.findUnique({
      where: { userId },
      select: { id: true, name: true },
    });
    const staffId = staff?.id;
    if (!staffId) {
      return NextResponse.json({ error: 'Only staff can submit regularization requests' }, { status: 403 });
    }

    const body = await req.json();
    const { date, reason, punchType, punchTime } = body;

    if (!date) {
      return NextResponse.json({ error: 'date required' }, { status: 400 });
    }

    const dateObj = new Date(`${date}T00:00:00Z`);
    if (isNaN(dateObj.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    if (!punchType || !punchTime) {
      return NextResponse.json({ error: 'punchType and punchTime required' }, { status: 400 });
    }
    if (!['IN', 'OUT'].includes(punchType)) {
      return NextResponse.json({ error: "punchType must be 'IN' or 'OUT'" }, { status: 400 });
    }

    // Parse time as HH:mm. The staff picks a wall-clock time in the school's
    // timezone, so convert to the real UTC instant (server runs in UTC).
    const [hours, mins] = punchTime.split(':').map(Number);
    if (isNaN(hours) || isNaN(mins)) {
      return NextResponse.json({ error: 'Invalid punchTime format (use HH:mm)' }, { status: 400 });
    }
    const cfg = await loadStaffAttConfig();
    const punchDateTime = zonedWallTimeToUtc(date, hours, mins, cfg.timezone);

    // Check if this same direction was already requested for this date. IN and
    // OUT are independent — a staff who missed both can request each separately.
    const existing = await prisma.attendanceRegularizationRequest.findFirst({
      where: { staffId, date: dateObj, type: 'PUNCH', punchType: punchType as PunchType },
    });
    if (existing && ['PENDING', 'APPROVED'].includes(existing.status)) {
      const dir = punchType === 'IN' ? 'punch-in' : 'punch-out';
      return NextResponse.json({ error: `A ${dir} request already exists for this date` }, { status: 409 });
    }

    let request;
    if (existing) {
      request = await prisma.attendanceRegularizationRequest.update({
        where: { id: existing.id },
        data: { punchType: punchType as PunchType, punchTime: punchDateTime, reason, status: 'PENDING' },
      });
    } else {
      request = await prisma.attendanceRegularizationRequest.create({
        data: {
          staffId,
          date: dateObj,
          type: 'PUNCH',
          punchType: punchType as PunchType,
          punchTime: punchDateTime,
          reason,
        },
      });
    }

    // Alert attendance managers (in-app bell + Web Push + WhatsApp). Best-effort.
    await notifyRegularizationRequest({
      staffId,
      staffName: staff.name,
      date: dateObj,
      punchType: punchType as PunchType,
      punchTime: punchDateTime,
      reason,
      timezone: cfg.timezone,
    });

    return NextResponse.json(request);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
