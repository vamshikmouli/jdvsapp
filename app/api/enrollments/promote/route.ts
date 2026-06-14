import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { copyEnrollments } from '@/lib/services/enrollment';

// POST /api/enrollments/promote — copy a roster to another year with a class shift.
// Body: { sourceYearId, targetYearId, shift, overwrite? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'SETTINGS_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  try {
    const res = await copyEnrollments({
      sourceYearId: String(b.sourceYearId || ''),
      targetYearId: String(b.targetYearId || ''),
      shift: Math.round(Number(b.shift)),
      overwrite: !!b.overwrite,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 });
  }
}
