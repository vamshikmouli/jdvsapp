import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, canAny } from '@/lib/rbac/roles';
import { MARKS_READ_ANY } from '@/lib/rbac/permissions';
import { getActiveYear } from '@/lib/services/fees';
import type { AssessmentType } from '@prisma/client';

// GET /api/assessments — assessments for the active year, with mark-sheet progress.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, [...MARKS_READ_ANY, 'HALL_TICKETS_ACCESS'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  if (!session || !can(session, 'MARKS_ASSESSMENTS')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (b.duplicateFrom) return duplicate(String(b.duplicateFrom), b.names);
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

// Duplicate an assessment's setup under new names (e.g. FA1 → FA2, FA3, FA4): type, term,
// max marks, per-subject maxes and per-class subjects. Not copied: marks, exam dates,
// published state — each copy starts fresh and hidden from parents.
async function duplicate(fromId: string, rawNames: unknown) {
  const src = await prisma.assessment.findUnique({ where: { id: fromId }, include: { subjectMaxes: true, classSubjects: true } });
  if (!src) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
  const names = Array.from(new Set((Array.isArray(rawNames) ? rawNames : []).map((n) => String(n || '').trim()).filter(Boolean)));
  if (!names.length) return NextResponse.json({ error: 'Give at least one name for the copy' }, { status: 400 });
  if (names.length > 12) return NextResponse.json({ error: 'At most 12 copies at a time' }, { status: 400 });
  const taken = await prisma.assessment.findMany({ where: { yearId: src.yearId, name: { in: names }, archived: false }, select: { name: true } });
  if (taken.length) return NextResponse.json({ error: `Already exists: ${taken.map((t) => t.name).join(', ')}` }, { status: 400 });
  const max = await prisma.assessment.aggregate({ where: { yearId: src.yearId }, _max: { order: true } });
  let order = max._max.order ?? 0;
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const name of names) {
      const a = await tx.assessment.create({
        data: { yearId: src.yearId, name, type: src.type, term: src.term, defaultMax: src.defaultMax, order: ++order, publishedToParents: false },
      });
      if (src.subjectMaxes.length) await tx.assessmentSubject.createMany({ data: src.subjectMaxes.map((x) => ({ assessmentId: a.id, subjectId: x.subjectId, maxMarks: x.maxMarks })) });
      if (src.classSubjects.length) await tx.assessmentClassSubject.createMany({ data: src.classSubjects.map((x) => ({ assessmentId: a.id, classId: x.classId, subjectId: x.subjectId, maxMarks: x.maxMarks, order: x.order })) });
      out.push({ id: a.id, name: a.name });
    }
    return out;
  });
  return NextResponse.json({ created }, { status: 201 });
}

// PATCH /api/assessments — edit fields or toggle publishedToParents.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_ASSESSMENTS')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  if (!session || !can(session, 'MARKS_ASSESSMENTS')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  // Soft archive (hides from setup, entry, reports) — marks are preserved.
  const restore = sp.get('restore') === '1';
  await prisma.assessment.update({ where: { id }, data: { archived: !restore } });
  return NextResponse.json({ ok: true, archived: !restore });
}
