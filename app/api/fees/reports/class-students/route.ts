import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear, getClassFeeStudents } from '@/lib/services/fees';

// GET /api/fees/reports/class-students?classId=
// Each student in a class with their billed / paid / pending (Reports drill-down).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, ['FEES_REPORTS', 'SETTINGS_MANAGE'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const classId = new URL(req.url).searchParams.get('classId') || '';
    if (!classId) return NextResponse.json({ error: 'classId is required' }, { status: 400 });

    const year = await getActiveYear();
    const data = await getClassFeeStudents(year.id, classId);
    return NextResponse.json(data);
  } catch (err) {
    console.error('fees/reports/class-students GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
