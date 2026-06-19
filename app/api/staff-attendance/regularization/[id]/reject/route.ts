import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

// POST /api/staff-attendance/regularization/[id]/reject
// Admin rejects a regularization request
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
        { error: `Cannot reject a ${request.status.toLowerCase()} request` },
        { status: 409 }
      );
    }

    const body = await req.json();
    const { decisionNote } = body;

    const updated = await prisma.attendanceRegularizationRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
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
