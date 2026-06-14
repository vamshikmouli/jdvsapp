import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';

// GET /api/subjects — list all subjects (with how many classes use each).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const subjects = await prisma.subject.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { classes: true } } },
  });
  return NextResponse.json(subjects.map((s) => ({ id: s.id, name: s.name, code: s.code, order: s.order, active: s.active, gradeOnly: s.gradeOnly, classCount: s._count.classes })));
}

// POST /api/subjects — create a subject.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Subject name is required' }, { status: 400 });
  const max = await prisma.subject.aggregate({ _max: { order: true } });
  const created = await prisma.subject.create({
    data: { name, code: b.code ? String(b.code).trim() : null, order: (max._max.order ?? 0) + 1 },
  });
  return NextResponse.json(created, { status: 201 });
}

// PATCH /api/subjects — edit name/code/active/order.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.subject.update({
    where: { id: b.id },
    data: {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      code: b.code !== undefined ? (b.code ? String(b.code).trim() : null) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
      gradeOnly: typeof b.gradeOnly === 'boolean' ? b.gradeOnly : undefined,
      order: typeof b.order === 'number' ? b.order : undefined,
    },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/subjects?id= — remove a subject (cascades class links & mark sheets).
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sheets = await prisma.markSheet.count({ where: { subjectId: id } });
  if (sheets > 0) return NextResponse.json({ error: `Can't delete — ${sheets} mark sheet(s) use this subject. Deactivate it instead.` }, { status: 400 });
  await prisma.subject.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
