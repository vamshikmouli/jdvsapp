import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getOrder, resolveOrder } from '@/lib/payments';

// POST /api/payments/orders/[id]/verify — admin exception path: the webhook never
// arrived but the admin confirmed the credit in the Business app, so post it now.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.status === 'PAID') return NextResponse.json({ ok: true, status: 'PAID' });

    await resolveOrder(params.id, 'verify', (session.user as any)?.id || null);
    const after = await getOrder(params.id);
    return NextResponse.json({ ok: true, status: after?.status, paymentId: after?.paymentId });
  } catch (err) {
    console.error('payments verify', err);
    return NextResponse.json({ error: 'Failed to verify' }, { status: 400 });
  }
}
