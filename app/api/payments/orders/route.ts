import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getRequestUserId } from '@/lib/auth/mobileSession';
import { prisma } from '@/lib/db';
import { getActiveYear, getStudentAccount } from '@/lib/services/fees';
import { autoAllocate } from '@/lib/fees';
import { createOrder, listRecent } from '@/lib/payments';

// POST /api/payments/orders — a parent creates an online fee payment for one of their
// children. Works from the web PWA and the native app (getRequestUserId handles both).
// Amount is always recomputed server-side from the real balance.
export async function POST(req: NextRequest) {
  try {
    const userId = await getRequestUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const studentId = String(body?.studentId || '');
    const mode = body?.mode === 'charges' ? 'charges' : 'full';
    const chargeIds: string[] = Array.isArray(body?.chargeIds) ? body.chargeIds.map(String) : [];
    if (!studentId) return NextResponse.json({ error: 'studentId required' }, { status: 400 });

    // Must be this guardian's child.
    const child = await prisma.student.findFirst({ where: { id: studentId, guardianUserId: userId }, select: { id: true } });
    if (!child) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { onlinePayEnabled: true, paymentProvider: true } });
    if (!settings?.onlinePayEnabled) return NextResponse.json({ error: 'Online payment is not enabled' }, { status: 400 });

    const year = await getActiveYear();
    const account = await getStudentAccount(studentId, year.id);
    if (!account) return NextResponse.json({ error: 'No fee account' }, { status: 404 });

    // Flat outstanding list in the app's priority order.
    const outstanding: { id: string; balance: number }[] = [];
    for (const head of account.summary.heads) for (const c of head.charges) if (c.balance > 0) outstanding.push({ id: c.id, balance: c.balance });

    let amount: number;
    let meta: unknown;
    if (mode === 'charges') {
      const chosen = outstanding.filter((c) => chargeIds.includes(c.id));
      if (!chosen.length) return NextResponse.json({ error: 'Select at least one outstanding item' }, { status: 400 });
      const allocations = chosen.map((c) => ({ chargeId: c.id, amount: c.balance }));
      amount = allocations.reduce((t, a) => t + a.amount, 0);
      meta = { mode, allocations };
    } else {
      amount = account.summary.totalBalance;
      // No stored split — the fulfiller auto-allocates for the amount at pay time.
      meta = { mode, allocations: autoAllocate(outstanding, amount) };
    }
    if (amount <= 0) return NextResponse.json({ error: 'Nothing due' }, { status: 400 });

    const { order, redirectUrl, intentUrl, qrDataUrl } = await createOrder({
      purpose: 'FEES',
      amount,
      providerName: settings.paymentProvider,
      studentId,
      yearId: year.id,
      createdById: userId,
      meta,
    });

    return NextResponse.json({ id: order.id, ref: order.ref, amount: order.amount, status: order.status, redirectUrl, intentUrl, qrDataUrl }, { status: 201 });
  } catch (err) {
    console.error('payments/orders POST', err);
    const msg = err instanceof Error ? err.message : 'Failed to start payment';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// GET /api/payments/orders — admin monitoring list.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const orders = await listRecent(60);
    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        ref: o.ref,
        amount: o.amount,
        status: o.status,
        provider: o.provider,
        utr: o.utr,
        studentName: o.student?.name || null,
        className: o.student?.class?.name || null,
        paymentId: o.paymentId,
        failReason: o.failReason,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('payments/orders GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
