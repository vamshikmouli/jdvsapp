import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { decideMarkSheet } from '@/lib/services/marks';

// POST /api/marks/approve — admin approves or returns a submitted sheet.
// Body: { sheetId, action: 'approve'|'return' }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_APPROVE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const sheetId = String(b.sheetId || '');
  const action = b.action === 'return' ? 'return' : 'approve';
  if (!sheetId) return NextResponse.json({ error: 'sheetId required' }, { status: 400 });
  try {
    const userId = (session.user as any)?.id || null;
    const res = await decideMarkSheet(sheetId, action, userId);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 });
  }
}
