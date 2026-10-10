import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { listPendingSheets, listPendingGroups } from '@/lib/services/marks';

// GET /api/marks/pending — admin approval queue.
//   ?grouped=1 → one row per class + exam (approve all subjects together)
//   (default) → one row per submitted subject sheet (legacy)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_APPROVE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (new URL(req.url).searchParams.get('grouped') === '1') {
    return NextResponse.json({ groups: await listPendingGroups() });
  }
  const items = await listPendingSheets();
  return NextResponse.json({ items });
}
