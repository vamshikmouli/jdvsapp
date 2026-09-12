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
import type { PayMethod } from '@prisma/client';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { studentId, method, note, date, allocations, newItems } = body || {};
    const allocList = Array.isArray(allocations) ? allocations : [];
    const itemList = Array.isArray(newItems) ? newItems : [];
    if (!studentId || (allocList.length === 0 && itemList.length === 0)) {
      return NextResponse.json({ error: 'studentId and at least one charge or item are required' }, { status: 400 });
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
      date: date ? String(date) : null,
      collectedById: (session.user as any)?.staffId || (session.user as any)?.id || null,
      allocations: allocList.map((a: any) => ({ chargeId: a.chargeId, amount: Math.round(Number(a.amount) || 0) })),
      newItems: itemList.map((i: any) => ({ feeTypeId: String(i.feeTypeId), label: String(i.label || 'Item'), amount: Math.round(Number(i.amount) || 0) })),
    });

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
      if (body?.sendWhatsApp === true && whatsappConfigured()) {
        const acct = await getStudentAccount(studentId, year.id);
        // Fee receipts go to father + mother + the extra fee-contact number (deduped).
        const recipients = acct ? feeWaRecipients(acct.student as any) : [];
        if (acct && recipients.length) {
          const cls = (acct.student.className || '—').replace(/\s?STD$/i, '');
          const short = (label: string) => { const t = label.replace(/^\s*uniform\s*[—\-:]\s*/i, '').trim(); const w = t.split(/\s+/).filter(Boolean); return w.length > 1 ? w.map((x) => x[0]).join('').toUpperCase() : t.slice(0, 4).toUpperCase(); };
          const brandName = (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { schoolName: true } }))?.schoolName || 'Jnana Deepika Vidhya Samsthe';

          const rs = (n: number) => 'Rs. ' + feeMoney(n).slice(1);
          const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
          const feeImgTpl = process.env.WHATSAPP_FEE_RECEIPT_IMAGE_TEMPLATE || 'fee_receipt_image';
          const uniImgTpl = process.env.WHATSAPP_UNIFORM_RECEIPT_IMAGE_TEMPLATE || 'uniform_receipt_image';
          const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          const imgOk = receiptImageAvailable();

          // THIS transaction only — the payment just recorded (never the cumulative statement).
          const pay = acct.payments.find((p: any) => p.id === result.id);
          const allocs = (pay?.allocations || []) as { amount: number; label: string }[];
          const feeAllocs = allocs.filter((a) => !/uniform/i.test(a.label) && a.amount > 0);
          const uniAllocs = allocs.filter((a) => /uniform/i.test(a.label) && a.amount > 0);
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
            for (const rcp of recipients) {
              let sent = false;
              if (mediaId) {
                const r = await sendImageTemplate({ to: rcp.to, templateName: feeImgTpl, lang, mediaId, bodyParams: [rcp.name, acct.student.name, cls, feeLine] });
                if (r.ok) sent = true; else console.error('wa fee image', rcp.to, r.error);
              }
              if (!sent) {
                const r = await sendTextTemplate({ to: rcp.to, templateName: process.env.WHATSAPP_FEE_RECEIPT_TEMPLATE || 'fee_receipt', lang, bodyParams: [rcp.name, acct.student.name, cls, feeLine] });
                if (!r.ok) console.error('wa fee receipt', rcp.to, r.error);
              }
            }
          }

          if (uniAllocs.length) {
            const uTotal = uniAllocs.reduce((t, a) => t + a.amount, 0);
            const uLine = uniAllocs.map((a) => `${short(a.label)} ${feeMoney(a.amount)}`).join(', ') + ` | Paid ${feeMoney(uTotal)}`;
            let mediaId: string | null = null;
            if (imgOk) {
              try {
                const png = renderReceiptImage({
                  title: 'Uniform Receipt', studentName: acct.student.name, klass: cls, sub,
                  rows: uniAllocs.map((a) => [short(a.label), rs(a.amount)] as [string, string]),
                  totalAmount: rs(uTotal), note: `Receipt ${result.receiptNo}`,
                });
                mediaId = await uploadWhatsAppMedia(png);
              } catch (e) { console.error('wa uniform image render', e); }
            }
            for (const rcp of recipients) {
              let sent = false;
              if (mediaId) {
                const r = await sendImageTemplate({ to: rcp.to, templateName: uniImgTpl, lang, mediaId, bodyParams: [acct.student.name, cls, uLine] });
                if (r.ok) sent = true; else console.error('wa uniform image', rcp.to, r.error);
              }
              if (!sent) {
                const r = await sendTextTemplate({ to: rcp.to, templateName: process.env.WHATSAPP_UNIFORM_RECEIPT_TEMPLATE || 'uniform_receipt', lang, bodyParams: [acct.student.name, cls, uLine] });
                if (!r.ok) console.error('wa uniform receipt', rcp.to, r.error);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('payment whatsapp', e);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('fees/payments POST', err);
    const msg = err instanceof Error ? err.message : 'Failed to record payment';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
