import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { recordPunch, recomputeDay } from '@/lib/staffAttendance/service';

// POST /api/staff-attendance/manage/regularize
// Admin correction for a staff member's attendance.
//   { action: 'punch',  staffId, type: 'IN'|'OUT', at: ISO, note? }
//   { action: 'status', staffId, date: 'YYYY-MM-DD', status: 'LEAVE'|'HOLIDAY'|'ABSENT', note? }
//   { action: 'recompute', staffId, date: 'YYYY-MM-DD' }
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const adminId = (session.user as any)?.id as string | undefined;
    const body = await req.json();
    const { action, staffId } = body;
    if (!staffId) return NextResponse.json({ error: 'staffId required' }, { status: 400 });

    if (action === 'punch') {
      if (body.type !== 'IN' && body.type !== 'OUT') {
        return NextResponse.json({ error: "type must be 'IN' or 'OUT'" }, { status: 400 });
      }
      const at = body.at ? new Date(body.at) : new Date();
      if (isNaN(at.getTime())) return NextResponse.json({ error: 'Invalid time' }, { status: 400 });
      const result = await recordPunch({
        staffId,
        source: 'MANUAL',
        forceType: body.type,
        at,
        note: body.note ?? null,
        createdById: adminId ?? null,
        withinFence: true,
      });
      return NextResponse.json({ ok: true, day: result.day });
    }

    if (action === 'status') {
      const allowed = ['LEAVE', 'HOLIDAY', 'ABSENT'];
      if (!allowed.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });
      const date = new Date(`${body.date}T00:00:00Z`);
      const day = await prisma.staffAttendanceDay.upsert({
        where: { staffId_date: { staffId, date } },
        update: { status: body.status, late: false, lateMinutes: 0 },
        create: { staffId, date, status: body.status },
      });
      return NextResponse.json({ ok: true, day });
    }

    if (action === 'recompute') {
      if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });
      const day = await recomputeDay(staffId, body.date);
      return NextResponse.json({ ok: true, day });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
