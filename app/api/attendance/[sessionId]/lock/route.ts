import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';

// POST /api/attendance/:sessionId/lock  Body: { locked: boolean }
// - Closing (locked=true): part of submitting attendance — needs ATTENDANCE_MARK
//   and the session's class must be in the user's scope.
// - Reopening (locked=false): an oversight action — needs ATTENDANCE_LOCK.
export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const locked = !!body.locked;

    const target = await prisma.attendanceSession.findUnique({
      where: { id: params.sessionId },
      select: { classId: true },
    });
    if (!target) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    if (locked) {
      // Close / submit
      if (!can(session, 'ATTENDANCE_MARK')) {
        return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
      }
      const scope = await getClassScope(session);
      if (!scope.all && !scope.classIds.includes(target.classId)) {
        return NextResponse.json({ error: 'You are not assigned to this class' }, { status: 403 });
      }
    } else {
      // Reopen — admin-level
      if (!can(session, 'ATTENDANCE_LOCK')) {
        return NextResponse.json({ error: 'Only an admin can reopen a closed session' }, { status: 403 });
      }
    }

    const updated = await prisma.attendanceSession.update({
      where: { id: params.sessionId },
      data: { locked },
    });

    return NextResponse.json({ ok: true, locked: updated.locked });
  } catch (error) {
    console.error('Error toggling lock:', error);
    return NextResponse.json({ error: 'Failed to update lock' }, { status: 500 });
  }
}
