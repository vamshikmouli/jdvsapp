import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, recordPayment, getStudentAccount } from '@/lib/services/fees';
import { sendPushToUsers, parentUserIdsForStudents } from '@/lib/push';
import { PAY_METHODS, feeMoney } from '@/lib/fees';
import type { PayMethod } from '@prisma/client';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { studentId, method, note, allocations } = body || {};
    if (!studentId || !Array.isArray(allocations) || allocations.length === 0) {
      return NextResponse.json({ error: 'studentId and allocations are required' }, { status: 400 });
    }
    if (!PAY_METHODS.includes(method)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }

    const year = await getActiveYear();
    const result = await recordPayment({
      studentId,
      yearId: year.id,
      method: method as PayMethod,
      note: note || null,
      collectedById: (session.user as any)?.staffId || (session.user as any)?.id || null,
      allocations: allocations.map((a: any) => ({ chargeId: a.chargeId, amount: Math.round(Number(a.amount) || 0) })),
    });

    // Notify the parent on their phone (best-effort — never blocks the receipt).
    try {
      const total = allocations.reduce((t: number, a: any) => t + Math.round(Number(a.amount) || 0), 0);
      const [acct, parents] = await Promise.all([
        getStudentAccount(studentId, year.id),
        parentUserIdsForStudents([studentId]),
      ]);
      if (acct && parents.length) {
        const bal = acct.summary.totalBalance;
        await sendPushToUsers(parents, {
          title: 'Fee payment received',
          body: `${feeMoney(total)} received for ${acct.student.name}. ${bal > 0 ? `Balance due ${feeMoney(bal)}.` : 'All fees cleared — thank you!'} Receipt ${result.receiptNo}.`,
          url: '/parent',
          tag: `pay-${result.id}`,
        });
      }
    } catch (e) {
      console.error('payment notify', e);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('fees/payments POST', err);
    const msg = err instanceof Error ? err.message : 'Failed to record payment';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
