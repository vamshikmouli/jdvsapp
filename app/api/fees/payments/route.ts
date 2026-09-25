import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, recordPayment, getStudentAccount } from '@/lib/services/fees';
import { sendPushToUsers, parentUserIdsForStudents } from '@/lib/push';
import { sendTextTemplate, sendImageTemplate, uploadWhatsAppMedia, feeWaRecipients, whatsappConfigured } from '@/lib/services/whatsapp';
import { renderReceiptImage, receiptImageAvailable } from '@/lib/services/receiptImage';
import { prisma } from '@/lib/db';
import { PAY_METHODS, feeMoney } from '@/lib/fees';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';
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

    // WhatsApp receipts (best-effort): one FEE receipt (with school name) and one
    // UNIFORM receipt (student details, no school name, short item codes).
    try {
      // Global Fee-Setup switch can turn off WhatsApp fee receipts for the whole school.
      const waMode = (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { feeReceiptWhatsapp: true } }))?.feeReceiptWhatsapp || 'ASK';
      if (body?.sendWhatsApp === true && waMode !== 'OFF' && whatsappConfigured()) {
        const acct = await getStudentAccount(studentId, year.id);
        // Fee receipts go to father + mother + the extra fee-contact number (deduped).
        const recipients = acct ? feeWaRecipients(acct.student as any) : [];
        if (acct && recipients.length) {
          const cls = (acct.student.className || '—').replace(/\s?STD$/i, '');
          const brandName = (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { schoolName: true } }))?.schoolName || 'Jnana Deepika Vidhya Samsthe';

          const rs = (n: number) => 'Rs. ' + feeMoney(n).slice(1);
          const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
          const feeImgTpl = process.env.WHATSAPP_FEE_RECEIPT_IMAGE_TEMPLATE || 'fee_receipt_image';
          const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          const imgOk = receiptImageAvailable();

          // THIS transaction only — the payment just recorded (never the cumulative statement).
          // Only the FEE receipt goes on WhatsApp; the uniform receipt is print-only
          // (the office prints it — parents don't need it on WhatsApp).
          const pay = acct.payments.find((p: any) => p.id === result.id);
          const allocs = (pay?.allocations || []) as { amount: number; label: string }[];
          const feeAllocs = allocs.filter((a) => !/uniform/i.test(a.label) && a.amount > 0);
          const sub = `${result.receiptNo} · ${date} · ${method}`;

          if (feeAllocs.length) {
            const feeTotal = feeAllocs.reduce((t, a) => t + a.amount, 0);
            const feeLine = feeAllocs.map((a) => `${a.label} ${feeMoney(a.amount)}`).join('; ') + ` | Paid ${feeMoney(feeTotal)}`;
            // Render + upload the image once, then send to every recipient.
            let mediaId: string | null = null;
            if (imgOk) {
              try {
                const png = renderReceiptImage({
                  schoolName: brandName, title: 'Fee Receipt', studentName: acct.student.name, klass: cls, sub,
                  rows: feeAllocs.map((a) => [a.label, rs(a.amount)] as [string, string]),
                  totalAmount: rs(feeTotal), note: `Receipt ${result.receiptNo}`,
                });
                mediaId = await uploadWhatsAppMedia(png);
              } catch (e) { console.error('wa fee image render', e); }
            }
            const deliveries: WaDeliveryInput[] = [];
            for (const rcp of recipients) {
              let sent = false, wamid: string | undefined, err: string | undefined;
              if (mediaId) {
                const r = await sendImageTemplate({ to: rcp.to, templateName: feeImgTpl, lang, mediaId, bodyParams: [rcp.name, acct.student.name, cls, feeLine] });
                if (r.ok) { sent = true; wamid = r.id; } else { err = r.error; console.error('wa fee image', rcp.to, r.error); }
              }
              if (!sent) {
                const r = await sendTextTemplate({ to: rcp.to, templateName: process.env.WHATSAPP_FEE_RECEIPT_TEMPLATE || 'fee_receipt', lang, bodyParams: [rcp.name, acct.student.name, cls, feeLine] });
                if (r.ok) { sent = true; wamid = r.id; } else { err = r.error; console.error('wa fee receipt', rcp.to, r.error); }
              }
              deliveries.push({
                kind: 'FEE_RECEIPT', batchId: `receipt-${result.id}`, title: `Fee receipt ${result.receiptNo}`,
                studentId, studentName: acct.student.name, className: acct.student.className,
                recipient: rcp.name, phone: rcp.to, ok: sent, error: sent ? null : (err || 'send failed'), wamid,
              });
            }
            await recordWaDeliveries(deliveries);
          }

        }
      }
    } catch (e) {
      console.error('payment whatsapp', e);
    }
    })().catch((e) => console.error('post-payment notify', e));

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('fees/payments POST', err);
    const msg = err instanceof Error ? err.message : 'Failed to record payment';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
