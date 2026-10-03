import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { diagnoseParentReport } from '@/lib/services/marks';

// GET /api/marks/parent-check?studentId= — why each exam is / isn't on the parent's report card.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['MARKS_APPROVE', 'MARKS_ASSESSMENTS'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const studentId = new URL(req.url).searchParams.get('studentId') || '';
  if (!studentId) return NextResponse.json({ error: 'studentId required' }, { status: 400 });
  const year = await getActiveYear();
  const d = await diagnoseParentReport(studentId, year.id);
  if (!d) return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  return NextResponse.json({ year: year.label, ...d });
}
