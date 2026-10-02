import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { getStudentAccount } from '@/lib/services/fees';
import { sendTextTemplate, sendImageTemplate, uploadWhatsAppMedia, feeWaRecipients, whatsappConfigured } from '@/lib/services/whatsapp';
import { renderReceiptImage, receiptImageAvailable } from '@/lib/services/receiptImage';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';
import { feeMoney, PAY_METHOD_LABEL } from '@/lib/fees';
import { fmtDate } from '@/lib/dateFormat';

// WhatsApp fee receipts.
//
// A receipt for a student with a concession still WAITING FOR APPROVAL is held
// back: the parent would otherwise get a receipt showing the pre-concession
// balance. The hold is a MessageDelivery row (kind FEE_RECEIPT, status HELD,
// batchId receipt-<paymentId>) — no schema change. When the student's last
// pending concession is approved / rejected / withdrawn, the held receipts go
// out, showing the balance after that decision.

const HELD = 'HELD';
const batchOf = (paymentId: string) => `receipt-${paymentId}`;

/** True when the school-wide setting allows WhatsApp fee receipts and WhatsApp is set up. */
export async function feeReceiptWaEnabled(): Promise<boolean> {
  const waMode = (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { feeReceiptWhatsapp: true } }))?.feeReceiptWhatsapp || 'ASK';
  return waMode !== 'OFF' && whatsappConfigured();
}

export async function hasPendingConcession(studentId: string, yearId: string): Promise<boolean> {
  const n = await prisma.concession.count({ where: { status: 'PENDING', assignment: { studentId, yearId } } });
  return n > 0;
}

/** Park this payment's WhatsApp receipt until the student's pending concession is decided. */
export async function holdFeeReceipt(paymentId: string, studentId: string, studentName: string, className: string | null, receiptNo: string, sentById?: string | null) {
  await prisma.messageDelivery.create({
    data: {
      batchId: batchOf(paymentId), kind: 'FEE_RECEIPT', title: `Fee receipt ${receiptNo}`,
      studentId, studentName: studentName || '—', className, recipient: 'Waiting for concession approval', phone: '—',
      status: HELD, sentById: sentById ?? null,
    },
  });
}

/**
 * Send the held receipts of a student once no concession is pending any more.
 * Best-effort; call fire-and-forget after a concession is decided or withdrawn.
 */
export async function releaseHeldFeeReceipts(studentId: string): Promise<number> {
  const held = await prisma.messageDelivery.findMany({ where: { kind: 'FEE_RECEIPT', status: HELD, studentId }, select: { id: true, batchId: true } });
  if (!held.length) return 0;
  const pays = await prisma.payment.findMany({
    where: { id: { in: held.map((h) => h.batchId.replace(/^receipt-/, '')) } },
    select: { id: true, yearId: true },
  });
  // Still waiting on another concession of the same year → keep holding.
  for (const p of pays) if (await hasPendingConcession(studentId, p.yearId)) return 0;
  // Claim the rows first so two quick approvals can't send the same receipt twice.
  const claimed = await prisma.messageDelivery.deleteMany({ where: { id: { in: held.map((h) => h.id) }, status: HELD } });
  if (claimed.count === 0) return 0;
  if (!(await feeReceiptWaEnabled())) return 0;
  let sent = 0;
  for (const p of pays) { if (await sendFeeReceiptWhatsApp(p.id)) sent++; }
  return sent;
}

/** Render + send the FEE receipt of one payment to the student's fee contacts. Returns true if anything was sent. */
export async function sendFeeReceiptWhatsApp(paymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, studentId: true, yearId: true, receiptNo: true, method: true, paidAt: true, voided: true } });
  if (!payment || payment.voided) return false;
  const { studentId } = payment;
  const acct = await getStudentAccount(studentId, payment.yearId);
  // Fee receipts go to father + mother + the extra fee-contact number (deduped).
  const recipients = acct ? feeWaRecipients(acct.student as any) : [];
  if (!acct || !recipients.length) return false;

  const cls = (acct.student.className || '—').replace(/\s?STD$/i, '');
  const brandName = (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { schoolName: true } }))?.schoolName || 'Jnana Deepika Vidhya Samsthe';
  const rs = (n: number) => 'Rs. ' + feeMoney(n).slice(1);
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
  const feeImgTpl = process.env.WHATSAPP_FEE_RECEIPT_IMAGE_TEMPLATE || 'fee_receipt_image';
  const date = fmtDate(payment.paidAt);
  const method = PAY_METHOD_LABEL[payment.method as keyof typeof PAY_METHOD_LABEL] || payment.method;

  // THIS transaction only — never the cumulative statement. Only the FEE receipt
  // goes on WhatsApp; the uniform receipt is print-only.
  const pay = acct.payments.find((p: any) => p.id === payment.id);
  const allocs = (pay?.allocations || []) as { amount: number; label: string }[];
  const feeAllocs = allocs.filter((a) => !/uniform/i.test(a.label) && a.amount > 0);
  if (!feeAllocs.length) return false;
  const sub = `${payment.receiptNo} · ${date} · ${method}`;
  const feeTotal = feeAllocs.reduce((t, a) => t + a.amount, 0);
  const feeLine = feeAllocs.map((a) => `${a.label} ${feeMoney(a.amount)}`).join('; ') + ` | Paid ${feeMoney(feeTotal)}`;

  // Render + upload the image once, then send to every recipient.
  let mediaId: string | null = null;
  if (receiptImageAvailable()) {
    try {
      // Verification QR (same as the printed receipt) — scan to confirm it's genuine.
      let qrPng: Buffer | undefined;
      if ((pay as any)?.verifyToken) {
        try {
          const base = (process.env.NEXTAUTH_URL || 'https://jnanadeepika.app').replace(/\/$/, '');
          const url = `${base}/verify?r=${encodeURIComponent(payment.receiptNo)}&t=${(pay as any).verifyToken}`;
          qrPng = await QRCode.toBuffer(url, { margin: 1, width: 160, errorCorrectionLevel: 'M' });
        } catch { /* no QR if it fails */ }
      }
      // Current whole-year balance (after any concession decided since collection).
      const bal = acct.summary.totalBalance;
      const png = await renderReceiptImage({
        schoolName: brandName, title: 'Fee Receipt', studentName: acct.student.name, klass: cls, sub,
        rows: feeAllocs.map((a) => [a.label, rs(a.amount)] as [string, string]),
        totalAmount: rs(feeTotal),
        balanceLabel: 'Balance due', balanceValue: bal > 0 ? rs(bal) : 'No dues',
        note: `Receipt ${payment.receiptNo}`, qrPng,
      });
      mediaId = await uploadWhatsAppMedia(png);
    } catch (e) { console.error('wa fee image render', e); }
  }

  const deliveries: WaDeliveryInput[] = [];
  let any = false;
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
    any = any || sent;
    deliveries.push({
      kind: 'FEE_RECEIPT', batchId: batchOf(payment.id), title: `Fee receipt ${payment.receiptNo}`,
      studentId, studentName: acct.student.name, className: acct.student.className,
      recipient: rcp.name, phone: rcp.to, ok: sent, error: sent ? null : (err || 'send failed'), wamid,
    });
  }
  await recordWaDeliveries(deliveries);
  return any;
}
