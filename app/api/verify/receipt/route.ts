import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyReceiptToken } from '@/lib/receiptVerify';

export const dynamic = 'force-dynamic';

// GET /api/verify/receipt?r=<receiptNo>&t=<token> — PUBLIC.
// Confirms a fee receipt is genuine. Returns data only when the signed token matches,
// so it can't be used to enumerate receipts (no token → no data).
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const r = sp.get('r') || '';
  const t = sp.get('t') || '';
  if (!r || !t) return NextResponse.json({ valid: false });

  try {
    const pay = await prisma.payment.findUnique({
      where: { receiptNo: r },
      select: {
        receiptNo: true, total: true, studentId: true, paidAt: true, voided: true,
        student: { select: { name: true, class: { select: { name: true } } } },
      },
    });
    if (!pay || !verifyReceiptToken(pay.receiptNo, pay.studentId, pay.total, t)) {
      return NextResponse.json({ valid: false });
    }
    return NextResponse.json({
      valid: true,
      receiptNo: pay.receiptNo,
      student: pay.student?.name || '',
      className: pay.student?.class?.name || null,
      amount: pay.total,
      date: pay.paidAt,
      voided: pay.voided,
    });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
