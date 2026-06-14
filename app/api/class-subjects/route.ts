import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';

// GET /api/class-subjects — which subjects are mapped to each class.
// Returns { map: { [classId]: subjectId[] } }.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const links = await prisma.classSubject.findMany({ select: { classId: true, subjectId: true } });
  const map: Record<string, string[]> = {};
  for (const l of links) (map[l.classId] ||= []).push(l.subjectId);
  return NextResponse.json({ map });
}

// PUT /api/class-subjects — replace the subject list for ONE class.
// Body: { classId, subjectIds: string[] }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const classId = String(b.classId || '');
  const subjectIds: string[] = Array.isArray(b.subjectIds) ? b.subjectIds.map(String) : [];
  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });

  await prisma.$transaction([
    prisma.classSubject.deleteMany({ where: { classId, subjectId: { notIn: subjectIds.length ? subjectIds : ['__none__'] } } }),
    ...subjectIds.map((subjectId, i) =>
      prisma.classSubject.upsert({
        where: { classId_subjectId: { classId, subjectId } },
        create: { classId, subjectId, order: i },
        update: { order: i },
      })
    ),
  ]);
  return NextResponse.json({ ok: true, count: subjectIds.length });
}
