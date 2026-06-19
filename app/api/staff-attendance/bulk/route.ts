import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { recomputeDay, recomputeStreakForward } from '@/lib/staffAttendance/service';
import type { StaffDayStatus } from '@prisma/client';

const ALLOWED: StaffDayStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'];

// POST /api/staff-attendance/bulk
// Admin marks attendance for many staff on one date at once.
// Body: { date: 'YYYY-MM-DD', entries: [{ staffId, status }] }
//   status 'AUTO' recomputes that staff's day from punches (clears a manual mark).
export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const { date, entries } = await req.json();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'No staff to update.' }, { status: 400 });
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
      writes.push(
        prisma.staffAttendanceDay.upsert({
          where: { staffId_date: { staffId: e.staffId, date: dateObj } },
          update: { status: e.status, late: false, lateMinutes: 0 },
          create: { staffId: e.staffId, date: dateObj, status: e.status },
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
