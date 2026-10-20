import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getOrder, resolveOrder } from '@/lib/payments';
import { notifyParentFailed } from '@/lib/payments/notify';

// POST /api/payments/orders/[id]/reject — admin marks an unmatched/failed order FAILED
// and the parent is told to retry.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const order = await getOrder(params.id);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.status === 'PAID') return NextResponse.json({ error: 'Already paid — cannot reject' }, { status: 400 });

    const reason = String((await req.json().catch(() => ({})))?.reason || '').slice(0, 200) || null;
    await resolveOrder(params.id, 'reject', (session.user as any)?.id || null, reason);

    const studentName = order.studentId
      ? (await prisma.student.findUnique({ where: { id: order.studentId }, select: { name: true } }))?.name || 'your child'
      : 'your child';
    void notifyParentFailed(order.studentId, studentName);

    return NextResponse.json({ ok: true, status: 'FAILED' });
  } catch (err) {
    console.error('payments reject', err);
    return NextResponse.json({ error: 'Failed to reject' }, { status: 400 });
  }
}
