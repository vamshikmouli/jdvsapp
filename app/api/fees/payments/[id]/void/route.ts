import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { voidPayment } from '@/lib/services/fees';

// POST /api/fees/payments/[id]/void — cancel a payment (FEES_VOID, admins).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VOID')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const result = await voidPayment(params.id, (session.user as any)?.id || null, String(body?.reason || ''));
    return NextResponse.json(result);
  } catch (err) {
    console.error('fees/payments/[id]/void', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to cancel payment' }, { status: 400 });
  }
}
