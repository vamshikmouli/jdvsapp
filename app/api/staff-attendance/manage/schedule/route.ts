import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { parseWeekSchedule } from '@/lib/staffAttendance/schedule';

// POST /api/staff-attendance/manage/schedule
// Set a staff member's per-weekday session schedule.
// { staffId, weekSchedule: { "0".."6": 'OFF'|'MORNING'|'AFTERNOON'|'FULL' } | null }
export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const { staffId, weekSchedule } = await req.json();
    if (!staffId) return NextResponse.json({ error: 'staffId required' }, { status: 400 });

    const ws = parseWeekSchedule(weekSchedule);
    await prisma.staff.update({
      where: { id: staffId },
      // weekSchedule is now the source of truth; null = school default (full week).
      data: { weekSchedule: ws == null ? Prisma.JsonNull : (ws as any) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
