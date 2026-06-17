import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

// POST /api/staff-attendance/manage/reset-device   { staffId }
// Deactivate the staff member's bound phone so they can enroll a new one.
export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const { staffId } = await req.json();
    if (!staffId) return NextResponse.json({ error: 'staffId required' }, { status: 400 });

    const { count } = await prisma.staffCredential.updateMany({
      where: { staffId, active: true },
      data: { active: false },
    });
    return NextResponse.json({ ok: true, cleared: count });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
