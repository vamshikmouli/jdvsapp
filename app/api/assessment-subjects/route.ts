import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getAssessmentSubjectMaxes, setAssessmentSubjectMaxes } from '@/lib/services/marks';

// GET /api/assessment-subjects?assessmentId= — per-subject max marks for an assessment.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const assessmentId = new URL(req.url).searchParams.get('assessmentId') || '';
  if (!assessmentId) return NextResponse.json({ error: 'assessmentId required' }, { status: 400 });
  const data = await getAssessmentSubjectMaxes(assessmentId);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}

// PUT /api/assessment-subjects — set per-subject max marks.
// Body: { assessmentId, maxes: [{ subjectId, max }] }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const assessmentId = String(b.assessmentId || '');
  const maxes = Array.isArray(b.maxes) ? b.maxes : [];
  if (!assessmentId) return NextResponse.json({ error: 'assessmentId required' }, { status: 400 });
  try {
    await setAssessmentSubjectMaxes(assessmentId, maxes.map((m: any) => ({ subjectId: String(m.subjectId), max: Number(m.max) })));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 });
  }
}
