import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getAssignableOptions, setAssignment } from '@/lib/services/fees';

export async function GET(_req: NextRequest, { params }: { params: { studentId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const year = await getActiveYear();
    const options = await getAssignableOptions(params.studentId, year.id);
    if (!options) return NextResponse.json({ error: 'Student or class not found' }, { status: 404 });
    return NextResponse.json(options);
  } catch (err) {
    console.error('fees/assignment GET', err);
    return NextResponse.json({ error: 'Failed to load assignment options' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { studentId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const year = await getActiveYear();
    const result = await setAssignment(params.studentId, year.id, {
      village: body?.village === undefined ? undefined : (body.village ? String(body.village) : null),
      van: { enabled: !!body?.van?.enabled, fee: Number(body?.van?.fee) || 0 },
      uniform: Array.isArray(body?.uniform) ? body.uniform.map((u: any) => ({ key: String(u.key), qty: Math.max(0, Math.round(Number(u.qty) || 0)) })) : [],
      idCard: !!body?.idCard,
      newAdmission: !!body?.newAdmission,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('fees/assignment PUT', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save assignment' }, { status: 400 });
  }
}
