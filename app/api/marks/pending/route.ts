import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { listPendingSheets } from '@/lib/services/marks';

// GET /api/marks/pending — admin approval queue (submitted sheets).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_APPROVE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const items = await listPendingSheets();
  return NextResponse.json({ items });
}
