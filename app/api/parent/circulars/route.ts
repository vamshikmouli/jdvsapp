import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';

// GET /api/parent/circulars — school circulars/notices for parents.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // What this guardian's children belong to → what circulars they should see.
    const children = await prisma.student.findMany({ where: { guardianUserId: userId }, select: { id: true, classId: true } });
    const childIds = children.map((c) => c.id);
    const childClassIds = [...new Set(children.map((c) => c.classId).filter(Boolean) as string[])];

    const circulars = await prisma.circular.findMany({
      where: {
        archived: false,
        OR: [
          { audience: 'SCHOOL' },
          ...(childClassIds.length ? [{ audience: 'CLASS' as const, classIds: { hasSome: childClassIds } }] : []),
          ...(childIds.length ? [{ audience: 'STUDENT' as const, studentIds: { hasSome: childIds } }] : []),
        ],
      },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: 100,
    });
    return NextResponse.json({
      circulars: circulars.map((c) => ({
        id: c.id,
        title: c.title,
        body: c.body,
        category: c.category,
        kind: c.kind,
        pinned: c.pinned,
        publishedAt: c.publishedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('parent circulars error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
