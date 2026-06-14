import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';
import { getMarkSheetGrid, getMarkSheetGridById, saveMarkSheet } from '@/lib/services/marks';

// Teachers may only touch classes they're assigned to (unless ALL_CLASSES_ACCESS).
// Admins with MARKS_APPROVE can touch any class.
async function classAllowed(session: any, classId: string) {
  if (can(session, 'MARKS_APPROVE')) return true;
  const scope = await getClassScope(session);
  return scope.all || scope.classIds.includes(classId);
}

// GET /api/marks/sheet?assessmentId=&classId=&sectionId=&subjectId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;

  // Lookup by sheet id (admin review screen).
  const sheetId = sp.get('sheetId');
  if (sheetId) {
    const grid = await getMarkSheetGridById(sheetId);
    if (!grid) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!(await classAllowed(session, grid.class.id))) return NextResponse.json({ error: 'Not your class' }, { status: 403 });
    const isAdmin = can(session, 'MARKS_APPROVE');
    const canEdit = isAdmin || (can(session, 'MARKS_ENTER') && grid.status !== 'APPROVED');
    return NextResponse.json({ ...grid, canEdit, isAdmin });
  }

  const assessmentId = sp.get('assessmentId') || '';
  const classId = sp.get('classId') || '';
  const subjectId = sp.get('subjectId') || '';
  const sectionId = sp.get('sectionId') || null;
  if (!assessmentId || !classId || !subjectId) return NextResponse.json({ error: 'assessmentId, classId, subjectId required' }, { status: 400 });
  if (!(await classAllowed(session, classId))) return NextResponse.json({ error: 'Not your class' }, { status: 403 });

  const grid = await getMarkSheetGrid({ assessmentId, classId, subjectId, sectionId });
  if (!grid) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Who can edit: admin (approve) anytime; teachers (enter) unless the sheet is approved.
  const isAdmin = can(session, 'MARKS_APPROVE');
  const canEdit = isAdmin || (can(session, 'MARKS_ENTER') && grid.status !== 'APPROVED');
  return NextResponse.json({ ...grid, canEdit, isAdmin });
}

// PUT /api/marks/sheet — save or submit the grid.
// Body: { assessmentId, classId, sectionId, subjectId, action: 'save'|'submit', marks: [...] }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_ENTER')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const { assessmentId, classId, subjectId } = b;
  const sectionId = b.sectionId || null;
  if (!assessmentId || !classId || !subjectId) return NextResponse.json({ error: 'assessmentId, classId, subjectId required' }, { status: 400 });
  if (!(await classAllowed(session, classId))) return NextResponse.json({ error: 'Not your class' }, { status: 403 });

  // Block edits to an approved sheet unless admin can approve (re-open by editing).
  const isAdmin = can(session, 'MARKS_APPROVE');
  try {
    const grid = await getMarkSheetGrid({ assessmentId, classId, subjectId, sectionId });
    if (grid?.status === 'APPROVED' && !isAdmin) {
      return NextResponse.json({ error: 'These marks are approved and locked. Ask an admin to re-open.' }, { status: 400 });
    }
    const action: 'save' | 'submit' = b.action === 'submit' ? 'submit' : 'save';
    const marks = Array.isArray(b.marks) ? b.marks.map((m: any) => ({
      studentId: String(m.studentId),
      marksObtained: m.marksObtained === null || m.marksObtained === '' ? null : Math.round(Number(m.marksObtained)),
      isAbsent: !!m.isAbsent,
      remark: m.remark || null,
    })) : [];
    const userId = (session.user as any)?.id || null;
    const res = await saveMarkSheet({ assessmentId, classId, subjectId, sectionId }, marks, action, userId);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save' }, { status: 400 });
  }
}
