import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import type { AssessmentType } from '@prisma/client';

// GET /api/assessments — assessments for the active year, with mark-sheet progress.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const year = await getActiveYear();
  const showArchived = new URL(req.url).searchParams.get('archived') === '1';
  const items = await prisma.assessment.findMany({
    where: { yearId: year.id, archived: showArchived },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { markSheets: true } } },
  });
  return NextResponse.json({
    yearId: year.id,
    items: items.map((a) => ({
      id: a.id, name: a.name, type: a.type, term: a.term, order: a.order,
      defaultMax: a.defaultMax, publishedToParents: a.publishedToParents, archived: a.archived, sheetCount: a._count.markSheets,
    })),
  });
}

// POST /api/assessments — create an assessment in the active year.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const name = String(b.name || '').trim();
  const type: AssessmentType = b.type === 'SUMMATIVE' ? 'SUMMATIVE' : 'FORMATIVE';
  const defaultMax = Math.round(Number(b.defaultMax) || 0);
  if (!name) return NextResponse.json({ error: 'Assessment name is required' }, { status: 400 });
  if (!(defaultMax > 0)) return NextResponse.json({ error: 'Max marks must be greater than 0' }, { status: 400 });
  const year = await getActiveYear();
  const max = await prisma.assessment.aggregate({ where: { yearId: year.id }, _max: { order: true } });
  const created = await prisma.assessment.create({
    data: { yearId: year.id, name, type, term: b.term ? String(b.term).trim() : null, defaultMax, order: (max._max.order ?? 0) + 1 },
  });
  return NextResponse.json(created, { status: 201 });
}

// PATCH /api/assessments — edit fields or toggle publishedToParents.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.assessment.update({
    where: { id: b.id },
    data: {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      type: b.type === 'SUMMATIVE' || b.type === 'FORMATIVE' ? b.type : undefined,
      term: b.term !== undefined ? (b.term ? String(b.term).trim() : null) : undefined,
      defaultMax: b.defaultMax !== undefined ? Math.round(Number(b.defaultMax) || 0) : undefined,
      publishedToParents: typeof b.publishedToParents === 'boolean' ? b.publishedToParents : undefined,
      order: typeof b.order === 'number' ? b.order : undefined,
    },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/assessments?id= — remove an assessment (cascades its mark sheets).
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  // Soft archive (hides from setup, entry, reports) — marks are preserved.
  const restore = sp.get('restore') === '1';
  await prisma.assessment.update({ where: { id }, data: { archived: !restore } });
  return NextResponse.json({ ok: true, archived: !restore });
}
