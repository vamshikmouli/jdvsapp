import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getRequestUserId } from '@/lib/auth/mobileSession';
import { getOrder, syncStatus } from '@/lib/payments';

// GET /api/payments/orders/[id] — status. The parent UI (web or native) polls this; it
// re-checks the provider's status API (source of truth) and fulfills if paid.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getRequestUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const existing = await getOrder(params.id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Own order, or an admin (web) who can collect fees.
    const isOwner = existing.createdById === userId;
    if (!isOwner) {
      const session = await getServerSession(authOptions);
      if (!session || !can(session, 'FEES_COLLECT')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const order = (await syncStatus(params.id)) || existing;
    return NextResponse.json({
      id: order.id,
      status: order.status,
      amount: order.amount,
      paid: order.status === 'PAID',
      failed: order.status === 'FAILED',
    });
  } catch (err) {
    console.error('payments/orders/[id] GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
