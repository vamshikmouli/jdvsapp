import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, canAny } from '@/lib/rbac/roles';
import { MARKS_READ_ANY } from '@/lib/rbac/permissions';
import { getClassExamSetup, setClassExamSetup } from '@/lib/services/marks';

// GET /api/assessment-class-subjects?assessmentId=&classId= — this exam's subjects + maxes for a class.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, MARKS_READ_ANY)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const assessmentId = sp.get('assessmentId') || '';
  const classId = sp.get('classId') || '';
  if (!assessmentId || !classId) return NextResponse.json({ error: 'assessmentId and classId required' }, { status: 400 });
  try {
    const data = await getClassExamSetup(assessmentId, classId);
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error('assessment-class-subjects GET', err);
    return NextResponse.json({ error: 'Could not load — if the server was just updated, run `npx prisma db push` once.' }, { status: 500 });
  }
}

// PUT /api/assessment-class-subjects
// Body: { assessmentId, classIds: string[], items: [{ subjectId, max }] }  (items in display order)
//    or { assessmentId, classIds, reset: true }  → back to the class's usual subjects.
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_ASSESSMENTS')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const assessmentId = String(b.assessmentId || '');
  const classIds: string[] = (Array.isArray(b.classIds) ? b.classIds : [b.classId]).filter(Boolean).map(String);
  if (!assessmentId || !classIds.length) return NextResponse.json({ error: 'assessmentId and classIds required' }, { status: 400 });
  const items = b.reset ? null : (Array.isArray(b.items) ? b.items : []).map((x: any) => ({ subjectId: String(x.subjectId), max: Number(x.max) }));
  const done: string[] = [], failed: { classId: string; error: string }[] = [];
  for (const classId of classIds) {
    try { await setClassExamSetup(assessmentId, classId, items); done.push(classId); }
    catch (err) { failed.push({ classId, error: err instanceof Error ? err.message : 'Failed' }); }
  }
  if (!done.length) return NextResponse.json({ error: failed[0]?.error || 'Failed', failed }, { status: 400 });
  return NextResponse.json({ ok: true, done, failed });
}
