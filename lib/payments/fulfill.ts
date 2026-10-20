// Fee fulfillment: the handler registered for purpose "FEES". Runs once when an order
// is confirmed PAID. Posts the money through the SAME recordPayment() the counter uses,
// so an online payment is an ordinary Payment (method ONLINE) and shows up everywhere
// (reports, receipts, parent history) with no special-casing.
import { prisma } from '@/lib/db';
import type { PaymentOrder } from '@prisma/client';
import { recordPayment, getStudentAccount, getActiveYear } from '@/lib/services/fees';
import { autoAllocate, feeMoney } from '@/lib/fees';
import { sendPushToUsers, parentUserIdsForStudents } from '@/lib/push';
import { logActivity } from '@/lib/activity';
import { notifyAdminsPaid, notifyAdminsAttention } from './notify';

type StoredAlloc = { chargeId: string; amount: number };

function readStoredAllocations(meta: unknown): StoredAlloc[] {
  const m = meta as any;
  const list = Array.isArray(m?.allocations) ? m.allocations : [];
  return list
    .map((a: any) => ({ chargeId: String(a.chargeId), amount: Math.round(Number(a.amount) || 0) }))
    .filter((a: StoredAlloc) => a.chargeId && a.amount > 0);
}

export async function fulfillFeesOrder(order: PaymentOrder): Promise<void> {
  if (order.paymentId) return; // already posted
  const studentId = order.studentId;
  if (!studentId) {
    await notifyAdminsAttention({ studentName: '(unknown)', amount: order.amount, reason: 'order has no student' });
    return;
  }
  const yearId = order.yearId || (await getActiveYear()).id;
  const account = await getStudentAccount(studentId, yearId);
  const studentName = account?.student.name || 'Student';

  // Outstanding charges in the app's natural priority order (old-due → oldest first),
  // which is how getStudentAccount returns them.
  const outstanding: { id: string; balance: number }[] = [];
  for (const head of account?.summary.heads || []) {
    for (const c of head.charges) if (c.balance > 0) outstanding.push({ id: c.id, balance: c.balance });
  }
  const balById = new Map(outstanding.map((c) => [c.id, c.balance]));

  // Re-derive allocations against the CURRENT balances: a stored per-charge split is
  // clamped (a counter payment may have reduced it since the order was created); a
  // "full balance" order (no stored split) is auto-allocated for the amount paid.
  const stored = readStoredAllocations(order.meta);
  let allocations: StoredAlloc[];
  if (stored.length) {
    allocations = stored
      .map((a) => ({ chargeId: a.chargeId, amount: Math.min(a.amount, balById.get(a.chargeId) ?? 0) }))
      .filter((a) => a.amount > 0);
  } else {
    allocations = autoAllocate(outstanding, order.amount);
  }

  if (!allocations.length) {
    // Nothing left to pay — balance already cleared (duplicate / overpayment). Don't
    // fabricate a charge; flag it for a human.
    await notifyAdminsAttention({ studentName, amount: order.amount, reason: 'paid but balance already cleared — please check for a duplicate/refund' });
    return;
  }

  const note = `Online payment${order.utr ? ` · UPI ref ${order.utr}` : ''}${order.providerTxnId ? ` · ${order.provider} ${order.providerTxnId}` : ''}`;
  const payment = await recordPayment({
    studentId,
    yearId,
    method: 'ONLINE',
    note,
    collectedById: null,
    allocations,
  });

  const paidTotal = allocations.reduce((t, a) => t + a.amount, 0);
  await prisma.paymentOrder.update({ where: { id: order.id }, data: { paymentId: payment.id } }).catch(() => {});

  // Audit trail — system actor (the payer is the parent, posting is automatic).
  void logActivity({ user: { name: 'Online payment' } } as any, {
    category: 'FEES',
    action: 'ONLINE_PAYMENT',
    entityType: 'Payment',
    entityId: payment.id,
    summary: `Online ${feeMoney(paidTotal)} · receipt ${payment.receiptNo} (${order.provider})`,
    meta: { studentId, amount: paidTotal, receiptNo: payment.receiptNo, orderId: order.id },
  });

  // Parent push — same message shape as the counter flow.
  try {
    const after = await getStudentAccount(studentId, yearId);
    const bal = after?.summary.totalBalance ?? 0;
    const parents = await parentUserIdsForStudents([studentId]);
    if (parents.length) {
      await sendPushToUsers(parents, {
        title: 'Fee payment received',
        body: `${feeMoney(paidTotal)} received for ${studentName}. ${bal > 0 ? `Balance due ${feeMoney(bal)}.` : 'All fees cleared — thank you!'} Receipt ${payment.receiptNo}.`,
        url: '/parent',
        tag: `pay-${payment.id}`,
      });
    }
  } catch (e) {
    console.error('[payments] parent notify', e);
  }

  await notifyAdminsPaid({ studentId, studentName, amount: paidTotal, receiptNo: payment.receiptNo });
}
