import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import type { PunchType, StaffDayStatus } from '@prisma/client';

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
//   { type: 'PUNCH', date: 'YYYY-MM-DD', punchType: 'IN'|'OUT', punchTime: 'HH:mm', reason? }
//   { type: 'STATUS', date: 'YYYY-MM-DD', statusValue: 'LEAVE'|'ABSENT'|'HOLIDAY', reason? }
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staff?.id as string | undefined;
    if (!staffId) {
      return NextResponse.json({ error: 'Only staff can submit regularization requests' }, { status: 403 });
    }

    const body = await req.json();
    const { type, date, reason } = body;

    if (!type || !date) {
      return NextResponse.json({ error: 'type and date required' }, { status: 400 });
    }

    const dateObj = new Date(`${date}T00:00:00Z`);
    if (isNaN(dateObj.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    if (type === 'PUNCH') {
      const { punchType, punchTime } = body;
      if (!punchType || !punchTime) {
        return NextResponse.json({ error: 'punchType and punchTime required for PUNCH' }, { status: 400 });
      }
      if (!['IN', 'OUT'].includes(punchType)) {
        return NextResponse.json({ error: "punchType must be 'IN' or 'OUT'" }, { status: 400 });
      }

      // Parse time as HH:mm and create datetime
      const [hours, mins] = punchTime.split(':').map(Number);
      if (isNaN(hours) || isNaN(mins)) {
        return NextResponse.json({ error: 'Invalid punchTime format (use HH:mm)' }, { status: 400 });
      }
      const punchDateTime = new Date(dateObj);
      punchDateTime.setHours(hours, mins, 0, 0);

      // Check if already requested for this date/type
      const existing = await prisma.attendanceRegularizationRequest.findFirst({
        where: { staffId, date: dateObj, type: 'PUNCH' },
      });
      if (existing && ['PENDING', 'APPROVED'].includes(existing.status)) {
        return NextResponse.json({ error: 'A punch request already exists for this date' }, { status: 409 });
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

      return NextResponse.json(request);
    }

    if (type === 'STATUS') {
      const { statusValue } = body;
      const allowed = ['LEAVE', 'ABSENT', 'HOLIDAY'];
      if (!statusValue || !allowed.includes(statusValue)) {
        return NextResponse.json({ error: `statusValue must be one of: ${allowed.join(', ')}` }, { status: 400 });
      }

      // Check if already requested for this date
      const existing = await prisma.attendanceRegularizationRequest.findFirst({
        where: { staffId, date: dateObj, type: 'STATUS' },
      });
      if (existing && ['PENDING', 'APPROVED'].includes(existing.status)) {
        return NextResponse.json({ error: 'A status request already exists for this date' }, { status: 409 });
      }

      let request;
      if (existing) {
        request = await prisma.attendanceRegularizationRequest.update({
          where: { id: existing.id },
          data: { statusValue: statusValue as StaffDayStatus, reason, status: 'PENDING' },
        });
      } else {
        request = await prisma.attendanceRegularizationRequest.create({
          data: {
            staffId,
            date: dateObj,
            type: 'STATUS',
            statusValue: statusValue as StaffDayStatus,
            reason,
          },
        });
      }

      return NextResponse.json(request);
    }

    return NextResponse.json({ error: "type must be 'PUNCH' or 'STATUS'" }, { status: 400 });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
