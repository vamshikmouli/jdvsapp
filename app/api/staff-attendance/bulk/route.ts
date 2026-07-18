import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { recomputeDay, recomputeStreakForward } from '@/lib/staffAttendance/service';
import { LEAVE_TYPES } from '@/lib/staffAttendance/leaveBalance';
import type { StaffDayStatus } from '@prisma/client';

const ALLOWED: StaffDayStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'];
const DEDUCTS = (s: string) => s === 'LEAVE' || s === 'ABSENT' || s === 'HALF_DAY';

// POST /api/staff-attendance/bulk
// Admin marks attendance for many staff on one date at once.
// Body: { date: 'YYYY-MM-DD', entries: [{ staffId, status }] }
//   status 'AUTO' recomputes that staff's day from punches (clears a manual mark).
export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const { date, entries, leaveType, halfSession } = await req.json();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'No staff to update.' }, { status: 400 });
    }
    // Leave/Absent/Half day deduct from a balance — a valid type is required.
    const needsType = entries.some((e: any) => DEDUCTS(e?.status));
    if (needsType && !LEAVE_TYPES.includes(leaveType)) {
      return NextResponse.json({ error: 'Choose a leave type (Earned/Sick/Unpaid) for Leave/Absent/Half day marks.' }, { status: 400 });
    }
    // Half day also needs the session (which half is off).
    const needsSession = entries.some((e: any) => e?.status === 'HALF_DAY');
    if (needsSession && halfSession !== 'MORNING' && halfSession !== 'AFTERNOON') {
      return NextResponse.json({ error: 'Choose morning or afternoon for Half day marks.' }, { status: 400 });
    }
    const dateObj = new Date(`${date}T00:00:00Z`);

    const writes: any[] = [];
    const autos: string[] = [];
    const markedStaff: string[] = [];
    for (const e of entries) {
      if (!e?.staffId) continue;
      if (e.status === 'AUTO') { autos.push(e.staffId); continue; }
      if (!ALLOWED.includes(e.status)) continue;
      markedStaff.push(e.staffId);
      // Deduct for Leave/Absent/Half day; clear for anything else.
      const lt = DEDUCTS(e.status) ? (leaveType as string) : null;
      const hs = e.status === 'HALF_DAY' ? (halfSession as string) : null;
      writes.push(
        prisma.staffAttendanceDay.upsert({
          where: { staffId_date: { staffId: e.staffId, date: dateObj } },
          update: { status: e.status, late: false, lateMinutes: 0, leaveType: lt, halfSession: hs },
          create: { staffId: e.staffId, date: dateObj, status: e.status, leaveType: lt, halfSession: hs },
        })
      );
    }

    if (writes.length) await prisma.$transaction(writes);
    // Keep each marked staff member's streak correct (this day + later days).
    for (const staffId of markedStaff) await recomputeStreakForward(staffId, date);
    // Recompute the 'AUTO' rows from their punches (outside the txn — each reads punches).
    for (const staffId of autos) await recomputeDay(staffId, date, { clearOverride: true });

    return NextResponse.json({ ok: true, updated: writes.length + autos.length });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
