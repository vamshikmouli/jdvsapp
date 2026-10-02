import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, recordPayment, getStudentAccount } from '@/lib/services/fees';
import { sendPushToUsers, parentUserIdsForStudents } from '@/lib/push';
import { feeReceiptWaEnabled, hasPendingConcession, holdFeeReceipt, sendFeeReceiptWhatsApp } from '@/lib/services/feeReceiptWa';
import { prisma } from '@/lib/db';
import { PAY_METHODS, feeMoney } from '@/lib/fees';
import { logActivity } from '@/lib/activity';
import type { PayMethod } from '@prisma/client';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { studentId, method, note, date, allocations, newItems, manualReceiptNo } = body || {};
    const allocList = Array.isArray(allocations) ? allocations : [];
    const itemList = Array.isArray(newItems) ? newItems : [];
    if (!studentId || (allocList.length === 0 && itemList.length === 0)) {
      return NextResponse.json({ error: 'studentId and at least one charge or item are required' }, { status: 400 });
    }

    // Split tender (e.g. UPI + Cash in one receipt): validate each mode.
    const tenders = (Array.isArray(body?.tenders) ? body.tenders : [])
      .map((t: any) => ({ method: String(t.method) as PayMethod, amount: Math.round(Number(t.amount) || 0) }))
      .filter((t: any) => PAY_METHODS.includes(t.method) && t.amount > 0);

    // A single mode still needs a valid method; a split provides its modes via `tenders`.
    if (tenders.length === 0 && !PAY_METHODS.includes(method)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }
    const primaryMethod = (PAY_METHODS.includes(method) ? method : tenders[0]?.method) as PayMethod;

    const year = await getActiveYear();
    const result = await recordPayment({
      studentId,
      yearId: year.id,
      method: primaryMethod,
      tenders: tenders.length ? tenders : undefined,
      note: note || null,
      manualReceiptNo: manualReceiptNo ? String(manualReceiptNo).trim().slice(0, 40) : null,
      date: date ? String(date) : null,
      collectedById: (session.user as any)?.staffId || (session.user as any)?.id || null,
      allocations: allocList.map((a: any) => ({ chargeId: a.chargeId, amount: Math.round(Number(a.amount) || 0) })),
      newItems: itemList.map((i: any) => ({ feeTypeId: String(i.feeTypeId), label: String(i.label || 'Item'), amount: Math.round(Number(i.amount) || 0) })),
    });

    // Audit trail — who collected how much.
    {
      const paidNow = [...allocList, ...itemList].reduce((t: number, a: any) => t + Math.round(Number(a.amount) || 0), 0);
      void logActivity(session, {
        category: 'FEES', action: 'PAYMENT_RECORDED', entityType: 'Payment', entityId: result.id,
        summary: `Recorded ${feeMoney(paidNow)} · receipt ${result.receiptNo} (${primaryMethod})`,
        meta: { studentId, amount: paidNow, receiptNo: result.receiptNo, method: primaryMethod }, req,
      });
    }

    // WhatsApp receipt: if the student has a concession still WAITING FOR APPROVAL,
    // hold the receipt (it would show the pre-concession balance) — it is sent
    // automatically once the concession is approved or rejected.
    let waWanted = false, waHeld = false;
    try {
      waWanted = body?.sendWhatsApp === true && (await feeReceiptWaEnabled());
      if (waWanted && (await hasPendingConcession(studentId, year.id))) {
        const st = await prisma.student.findUnique({ where: { id: studentId }, select: { name: true, class: { select: { name: true } } } });
        await holdFeeReceipt(result.id, studentId, st?.name || '—', st?.class?.name || null, result.receiptNo, (session.user as any)?.id || null);
        waHeld = true;
      }
    } catch (e) { console.error('payment whatsapp hold', e); }

    // Fire-and-forget: collecting a payment must never wait on WhatsApp/Meta.
    // The VM runs a persistent Node process, so this finishes after the response.
    void (async () => {
    // Notify the parent on their phone (best-effort — never blocks the receipt).
    try {
      const total = [...allocList, ...itemList].reduce((t: number, a: any) => t + Math.round(Number(a.amount) || 0), 0);
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

    // WhatsApp FEE receipt (best-effort) — sent now, unless it was held above
    // for a concession that's still waiting for approval.
    if (waWanted && !waHeld) {
      try { await sendFeeReceiptWhatsApp(result.id); } catch (e) { console.error('payment whatsapp', e); }
    }
    })().catch((e) => console.error('post-payment notify', e));

    return NextResponse.json({ ...result, waHeld }, { status: 201 });
  } catch (err) {
    console.error('fees/payments POST', err);
    const msg = err instanceof Error ? err.message : 'Failed to record payment';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
