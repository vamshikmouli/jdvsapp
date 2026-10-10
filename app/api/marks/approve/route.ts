import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { decideMarkSheet, approveClassExam } from '@/lib/services/marks';

// POST /api/marks/approve — admin approval.
//   { approveAll: true, assessmentId, classId, sectionId? } → approve every
//      submitted subject of a class exam at once (refuses if any is still draft)
//   { sheetId, action: 'approve'|'return' } → one subject sheet (legacy)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_APPROVE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const userId = (session.user as any)?.id || null;
  try {
    if (b.approveAll) {
      if (!b.assessmentId || !b.classId) return NextResponse.json({ error: 'assessmentId and classId required' }, { status: 400 });
      const res = await approveClassExam({ assessmentId: String(b.assessmentId), classId: String(b.classId), sectionId: b.sectionId ? String(b.sectionId) : null }, userId);
      return NextResponse.json(res);
    }
    const sheetId = String(b.sheetId || '');
    const action = b.action === 'return' ? 'return' : 'approve';
    if (!sheetId) return NextResponse.json({ error: 'sheetId required' }, { status: 400 });
    const res = await decideMarkSheet(sheetId, action, userId);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 });
  }
}
