import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { parseWorkPattern, parseWorkDays } from '@/lib/staffAttendance/schedule';

// POST /api/staff-attendance/manage/schedule
// Set a staff member's work pattern + working days.
// { staffId, workPattern: 'FULL'|'HALF_MORNING'|'HALF_AFTERNOON', workDays: number[] | null }
export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const { staffId, workPattern, workDays } = await req.json();
    if (!staffId) return NextResponse.json({ error: 'staffId required' }, { status: 400 });

    const wd = parseWorkDays(workDays); // number[] | null (null = follow weekly-offs)
    await prisma.staff.update({
      where: { id: staffId },
      data: {
        workPattern: parseWorkPattern(workPattern),
        workDays: wd == null ? Prisma.JsonNull : wd,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
