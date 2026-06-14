import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { getClassScope } from '@/lib/rbac/roles';

// GET /api/attendance/overview?date=YYYY-MM-DD
// For each class, returns whether the morning/afternoon session is
// pending | taken | locked on that date — used to badge the class pills.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');
    if (!dateStr) {
      return NextResponse.json({ error: 'date is required' }, { status: 400 });
    }
    const date = new Date(dateStr);

    const scope = await getClassScope(session);
    const where: any = { date };
    if (!scope.all) where.classId = { in: scope.classIds };

    const sessions = await prisma.attendanceSession.findMany({
      where,
      select: {
        classId: true,
        slot: true,
        locked: true,
        _count: { select: { records: true } },
      },
    });

    // classId -> { [slotKey]: 'pending' | 'taken' | 'locked' }
    const map: Record<string, Record<string, string>> = {};
    sessions.forEach((s) => {
      if (!map[s.classId]) map[s.classId] = {};
      map[s.classId][s.slot] = s._count.records === 0 ? 'pending' : s.locked ? 'locked' : 'taken';
    });

    return NextResponse.json(map);
  } catch (error) {
    console.error('Error building attendance overview:', error);
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 });
  }
}
