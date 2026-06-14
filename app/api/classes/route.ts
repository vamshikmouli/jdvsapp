import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Archived classes are hidden everywhere unless explicitly requested.
    const showArchived = new URL(req.url).searchParams.get('archived') === '1';
    const archFilter = { archived: showArchived };

    // Scope to assigned classes unless the user can access all classes
    const scope = await getClassScope(session);
    const where = scope.all ? { ...archFilter } : { id: { in: scope.classIds }, ...archFilter };

    const classes = await prisma.schoolClass.findMany({
      where,
      orderBy: { order: 'asc' },
      include: {
        teachers: { select: { id: true, name: true } },
        sections: { select: { id: true, name: true } },
      },
    });

    // Student counts are for the SELECTED academic year (enrollment-based).
    const year = await getActiveYear();
    const grouped = await prisma.enrollment.groupBy({
      by: ['classId'],
      where: { yearId: year.id, status: 'ACTIVE', student: { status: 'ACTIVE' } },
      _count: { _all: true },
    });
    const countByClass = Object.fromEntries(grouped.map((g) => [g.classId, g._count._all]));

    return NextResponse.json(classes.map((c) => ({ ...c, _count: { students: countByClass[c.id] || 0 } })));
  } catch (error) {
    console.error('Error fetching classes:', error);
    return NextResponse.json({ error: 'Failed to fetch classes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'CLASSES_MANAGE')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const maxOrder = await prisma.schoolClass.aggregate({ _max: { order: true } });

    const created = await prisma.schoolClass.create({
      data: {
        id: body.id || `c${Date.now()}`,
        name: body.name,
        order: (maxOrder._max.order ?? 0) + 1,
        room: body.room || null,
        group: body.group || 'PRIMARY',
        teachers: Array.isArray(body.teacherIds) && body.teacherIds.length
          ? { connect: body.teacherIds.map((id: string) => ({ id })) }
          : undefined,
      },
      include: { teachers: { select: { id: true, name: true } } },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating class:', error);
    return NextResponse.json({ error: 'Failed to create class' }, { status: 500 });
  }
}
