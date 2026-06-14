import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';
import { getActiveYear, listAccounts } from '@/lib/services/fees';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || undefined;
    const classId = searchParams.get('classId') || undefined;
    const filter = searchParams.get('filter') || undefined;

    const year = await getActiveYear();
    const scope = await getClassScope(session);
    const classIds = scope.all ? null : scope.classIds;

    const rows = await listAccounts(year.id, { q, classId, filter, classIds });
    return NextResponse.json({ year: { id: year.id, label: year.label }, rows });
  } catch (err) {
    console.error('fees/accounts GET', err);
    return NextResponse.json({ error: 'Failed to load fee accounts' }, { status: 500 });
  }
}
