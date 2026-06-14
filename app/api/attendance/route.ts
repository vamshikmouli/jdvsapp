import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';
import { AttendanceStatus } from '@prisma/client';
import { getActiveYear } from '@/lib/services/fees';

// Returns true if the user may access this class (all-access or assigned to it).
async function classInScope(session: any, classId: string): Promise<boolean> {
  const scope = await getClassScope(session);
  return scope.all || scope.classIds.includes(classId);
}

// GET /api/attendance?classId=&date=YYYY-MM-DD&slot=MORNING|AFTERNOON
// Returns the roster for the class plus any saved marks + session lock state.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get('classId');
    const dateStr = searchParams.get('date');
    const slot = searchParams.get('slot');

    if (!classId || !dateStr || !slot) {
      return NextResponse.json(
        { error: 'classId, date and slot are required' },
        { status: 400 }
      );
    }

    if (!(await classInScope(session, classId))) {
      return NextResponse.json({ error: 'You are not assigned to this class' }, { status: 403 });
    }

    const date = new Date(dateStr);

    // Active roster for the class — driven by the selected year's enrollment.
    const year = await getActiveYear();
    const enr = await prisma.enrollment.findMany({
      where: { yearId: year.id, classId, status: 'ACTIVE', student: { status: 'ACTIVE' } },
      orderBy: [{ student: { name: 'asc' } }],
      include: { student: { select: { id: true, name: true, gender: true, guardianName: true } } },
    });
    const roster = enr.map((e) => ({ id: e.student.id, name: e.student.name, roll: e.roll, gender: e.student.gender, guardianName: e.student.guardianName }));

    // Existing session (if attendance was taken)
    const attendanceSession = await prisma.attendanceSession.findUnique({
      where: { classId_date_slot: { classId, date, slot } },
      include: { records: true },
    });

    const marks: Record<string, AttendanceStatus> = {};
    if (attendanceSession) {
      attendanceSession.records.forEach((r) => {
        marks[r.studentId] = r.status;
      });
    }

    return NextResponse.json({
      classId,
      date: dateStr,
      slot,
      roster,
      marks,
      locked: attendanceSession?.locked ?? false,
      sessionId: attendanceSession?.id ?? null,
      taken: !!attendanceSession,
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json({ error: 'Failed to fetch attendance' }, { status: 500 });
  }
}

// POST /api/attendance
// Body: { classId, date, slot, records: [{ studentId, status }] }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!can(session, 'ATTENDANCE_MARK')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { classId, date: dateStr, slot, records } = body as {
      classId: string;
      date: string;
      slot: string;
      records: { studentId: string; status: AttendanceStatus }[];
    };

    if (!classId || !dateStr || !slot || !Array.isArray(records)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    if (!(await classInScope(session, classId))) {
      return NextResponse.json({ error: 'You are not assigned to this class' }, { status: 403 });
    }

    const date = new Date(dateStr);

    // Find or create the session
    let attendanceSession = await prisma.attendanceSession.findUnique({
      where: { classId_date_slot: { classId, date, slot } },
    });

    // Respect lock — only someone who can lock/reopen may write to a locked session
    if (attendanceSession?.locked && !can(session, 'ATTENDANCE_LOCK')) {
      return NextResponse.json(
        { error: 'This session is locked. Ask an admin to reopen it.' },
        { status: 409 }
      );
    }

    if (!attendanceSession) {
      attendanceSession = await prisma.attendanceSession.create({
        data: {
          classId,
          date,
          slot,
          takenById: (session.user as any).id,
        },
      });
    }

    // Upsert each record
    const sessionId = attendanceSession.id;
    await prisma.$transaction(
      records.map((r) =>
        prisma.attendanceRecord.upsert({
          where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
          update: { status: r.status },
          create: { sessionId, studentId: r.studentId, status: r.status },
        })
      )
    );

    return NextResponse.json({ ok: true, sessionId, saved: records.length });
  } catch (error) {
    console.error('Error saving attendance:', error);
    return NextResponse.json({ error: 'Failed to save attendance' }, { status: 500 });
  }
}
