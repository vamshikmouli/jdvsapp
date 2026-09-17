import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { voidPayment } from '@/lib/services/fees';
import { logActivity } from '@/lib/activity';
import { feeMoney } from '@/lib/fees';

// POST /api/fees/payments/[id]/void — cancel a payment (FEES_VOID, admins).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VOID')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const result = await voidPayment(params.id, (session.user as any)?.id || null, String(body?.reason || ''));
    void logActivity(session, {
      category: 'FEES', action: 'PAYMENT_VOIDED', entityType: 'Payment', entityId: params.id,
      summary: `Cancelled receipt ${(result as any)?.receiptNo || params.id}${(result as any)?.total ? ` (${feeMoney((result as any).total)})` : ''}${body?.reason ? ` — ${body.reason}` : ''}`,
      meta: { reason: body?.reason || null }, req,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('fees/payments/[id]/void', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to cancel payment' }, { status: 400 });
  }
}
