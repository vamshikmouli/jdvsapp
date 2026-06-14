import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';
import { getClassGrid, saveMarkSheet } from '@/lib/services/marks';

async function classAllowed(session: any, classId: string) {
  if (can(session, 'MARKS_APPROVE')) return true;
  const scope = await getClassScope(session);
  return scope.all || scope.classIds.includes(classId);
}

// GET /api/marks/grid?assessmentId=&classId=&sectionId= — all subjects × all students.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const assessmentId = sp.get('assessmentId') || '';
  const classId = sp.get('classId') || '';
  const sectionId = sp.get('sectionId') || null;
  if (!assessmentId || !classId) return NextResponse.json({ error: 'assessmentId, classId required' }, { status: 400 });
  if (!(await classAllowed(session, classId))) return NextResponse.json({ error: 'Not your class' }, { status: 403 });

  const grid = await getClassGrid({ assessmentId, classId, sectionId });
  if (!grid) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = can(session, 'MARKS_APPROVE');
  return NextResponse.json({
    ...grid,
    isAdmin,
    subjects: grid.subjects.map((s) => ({ ...s, canEdit: isAdmin || (can(session, 'MARKS_ENTER') && s.status !== 'APPROVED') })),
  });
}

// PUT /api/marks/grid — save/submit marks for many subjects at once.
// Body: { assessmentId, classId, sectionId, action:'save'|'submit', subjects:[{ subjectId, marks:[{studentId, marksObtained, isAbsent}] }] }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_ENTER')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const { assessmentId, classId } = b;
  const sectionId = b.sectionId || null;
  if (!assessmentId || !classId) return NextResponse.json({ error: 'assessmentId, classId required' }, { status: 400 });
  if (!(await classAllowed(session, classId))) return NextResponse.json({ error: 'Not your class' }, { status: 403 });

  const isAdmin = can(session, 'MARKS_APPROVE');
  const userId = (session.user as any)?.id || null;
  const action: 'save' | 'submit' = b.action === 'submit' ? 'submit' : 'save';
  const inputSubjects: any[] = Array.isArray(b.subjects) ? b.subjects : [];

  // Current statuses, so we never overwrite an approved sheet from a non-admin.
  const current = await getClassGrid({ assessmentId, classId, sectionId });
  const statusBySubject = new Map((current?.subjects || []).map((s) => [s.id, s.status]));

  const results: { subjectId: string; status: string }[] = [];
  try {
    for (const sub of inputSubjects) {
      const subjectId = String(sub.subjectId || '');
      if (!subjectId) continue;
      if (statusBySubject.get(subjectId) === 'APPROVED' && !isAdmin) continue; // locked

      const marks = (Array.isArray(sub.marks) ? sub.marks : []).map((m: any) => ({
        studentId: String(m.studentId),
        marksObtained: m.marksObtained === null || m.marksObtained === '' || m.marksObtained === undefined ? null : Math.round(Number(m.marksObtained)),
        isAbsent: !!m.isAbsent,
      }));

      // On "submit", only actually submit columns that have at least one entry; otherwise just save.
      const hasEntry = marks.some((m: any) => m.isAbsent || m.marksObtained != null);
      const effective: 'save' | 'submit' = action === 'submit' && hasEntry ? 'submit' : 'save';

      const res = await saveMarkSheet({ assessmentId, classId, subjectId, sectionId }, marks, effective, userId);
      results.push({ subjectId, status: res.status });
    }
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save' }, { status: 400 });
  }
}
