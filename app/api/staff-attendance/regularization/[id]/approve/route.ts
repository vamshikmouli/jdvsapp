import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { recordPunch, recomputeDay } from '@/lib/staffAttendance/service';

// POST /api/staff-attendance/regularization/[id]/approve
// Admin approves and applies a regularization request
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const adminId = (session.user as any)?.id as string | undefined;
    const { id } = params;

    const request = await prisma.attendanceRegularizationRequest.findUnique({
      where: { id },
    });

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (request.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot approve a ${request.status.toLowerCase()} request` },
        { status: 409 }
      );
    }

    const body = await req.json();
    const { decisionNote } = body;

    // Apply the regularization
    if (request.type === 'PUNCH' && request.punchType && request.punchTime) {
      await recordPunch({
        staffId: request.staffId,
        source: 'MANUAL',
        forceType: request.punchType,
        at: request.punchTime,
        note: request.reason || null,
        createdById: adminId ?? null,
        withinFence: true,
      });
    } else if (request.type === 'STATUS' && request.statusValue) {
      const dateKey = request.date.toISOString().slice(0, 10);
      await prisma.staffAttendanceDay.upsert({
        where: { staffId_date: { staffId: request.staffId, date: request.date } },
        update: { status: request.statusValue, late: false, lateMinutes: 0 },
        create: { staffId: request.staffId, date: request.date, status: request.statusValue },
      });
    }

    // Mark request as approved
    const updated = await prisma.attendanceRegularizationRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedById: adminId,
        decidedAt: new Date(),
        decisionNote,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
