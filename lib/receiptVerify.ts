import crypto from 'crypto';

// Secret for signing receipt verification tokens. Prefer a dedicated env var; fall
// back to NEXTAUTH_SECRET so verification works out of the box (still server-only).
const SECRET = process.env.RECEIPT_VERIFY_SECRET || process.env.NEXTAUTH_SECRET || 'jdvs-receipt-verify';

// A short HMAC over the immutable receipt facts. Printed (in the QR) on the receipt;
// a forged receipt can't produce a matching token without the server secret.
export function receiptToken(receiptNo: string, studentId: string, total: number): string {
  return crypto.createHmac('sha256', SECRET).update(`${receiptNo}|${studentId}|${total}`).digest('hex').slice(0, 16);
}

export function verifyReceiptToken(receiptNo: string, studentId: string, total: number, token: string): boolean {
  const expected = receiptToken(receiptNo, studentId, total);
  if (!token || token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

// The public verification URL printed as a QR on the receipt.
export function receiptVerifyUrl(baseUrl: string, receiptNo: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/verify?r=${encodeURIComponent(receiptNo)}&t=${token}`;
}
