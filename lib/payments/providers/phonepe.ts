// PhonePe PG adapter (collect via the hosted Pay Page + server webhook + status API).
//
// Built to PhonePe's documented PG API. Credentials come from env (never the DB):
//   PHONEPE_MERCHANT_ID   - the Business merchant id
//   PHONEPE_SALT_KEY      - the salt/secret key
//   PHONEPE_SALT_INDEX    - the key index (default "1")
//   PHONEPE_ENV           - "SANDBOX" (default) | "PROD"
//   PAYMENTS_PUBLIC_URL   - public origin for redirect/callback (falls back to NEXTAUTH_URL)
//
// Nothing here is school-specific; it is money-rail plumbing only.
import crypto from 'crypto';
import QRCode from 'qrcode';
import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider, ProviderStatus, StatusResult, WebhookResult } from './index';

const HOSTS: Record<string, string> = {
  SANDBOX: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  PROD: 'https://api.phonepe.com/apis/hermes',
};

function cfg() {
  const merchantId = process.env.PHONEPE_MERCHANT_ID || '';
  const saltKey = process.env.PHONEPE_SALT_KEY || '';
  const saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
  const host = HOSTS[(process.env.PHONEPE_ENV || 'SANDBOX').toUpperCase()] || HOSTS.SANDBOX;
  const publicUrl = (process.env.PAYMENTS_PUBLIC_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  return { merchantId, saltKey, saltIndex, host, publicUrl };
}

/** X-VERIFY = sha256(payloadToSign + saltKey) + "###" + saltIndex */
function xVerify(payloadToSign: string, saltKey: string, saltIndex: string): string {
  const hash = crypto.createHash('sha256').update(payloadToSign + saltKey).digest('hex');
  return `${hash}###${saltIndex}`;
}

function mapStatus(code?: string | null): ProviderStatus {
  const c = (code || '').toUpperCase();
  if (c === 'PAYMENT_SUCCESS' || c === 'COMPLETED' || c === 'SUCCESS') return 'PAID';
  if (c === 'PAYMENT_PENDING' || c === 'PENDING') return 'PENDING';
  return 'FAILED';
}

/** Dig the bank/UPI reference out of a PhonePe payment-detail payload (best-effort). */
function extractUtr(data: any): string | null {
  const details = data?.paymentInstrument || data?.data?.paymentInstrument;
  return (
    details?.utr ||
    data?.utr ||
    data?.data?.transactionId ||
    null
  );
}

export const phonePeProvider: PaymentProvider = {
  key: 'PHONEPE',

  isConfigured() {
    const { merchantId, saltKey } = cfg();
    return Boolean(merchantId && saltKey);
  },

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { merchantId, saltKey, saltIndex, host, publicUrl } = cfg();
    if (!merchantId || !saltKey) throw new Error('PhonePe is not configured');

    const payload = {
      merchantId,
      merchantTransactionId: input.ref,
      merchantUserId: (input.userId || 'guest').slice(0, 36),
      amount: Math.round(input.amount) * 100, // paise
      redirectUrl: `${publicUrl}/parent?pay=${encodeURIComponent(input.ref)}`,
      redirectMode: 'REDIRECT',
      callbackUrl: `${publicUrl}/api/payments/webhook`,
      paymentInstrument: { type: 'PAY_PAGE' },
    };
    const base64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const checksum = xVerify(base64 + '/pg/v1/pay', saltKey, saltIndex);

    const res = await fetch(`${host}/pg/v1/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VERIFY': checksum, accept: 'application/json' },
      body: JSON.stringify({ request: base64 }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      throw new Error(`PhonePe create failed: ${json?.code || res.status} ${json?.message || ''}`.trim());
    }
    const redirectUrl: string | null = json?.data?.instrumentResponse?.redirectInfo?.url || null;
    const providerTxnId: string | null = json?.data?.transactionId || null;
    // A QR of the hosted page lets a desktop user scan + pay from their phone.
    let qrDataUrl: string | null = null;
    if (redirectUrl) {
      try { qrDataUrl = await QRCode.toDataURL(redirectUrl, { margin: 1, width: 256 }); } catch { /* non-fatal */ }
    }
    return { providerTxnId, redirectUrl, qrDataUrl, raw: json };
  },

  async verifyWebhook(headers, rawBody): Promise<WebhookResult> {
    const { saltKey, saltIndex } = cfg();
    // PhonePe posts { response: base64(json) } with an X-VERIFY header.
    let base64 = '';
    try {
      const body = JSON.parse(rawBody || '{}');
      base64 = body?.response || '';
    } catch {
      base64 = '';
    }
    if (!base64) throw new Error('Empty PhonePe callback');
    const got = (headers['x-verify'] || headers['X-VERIFY'] || '') as string;
    const expected = xVerify(base64 + saltKey, saltKey, saltIndex).split('###')[0] + '###' + saltIndex;
    // X-VERIFY on the callback is sha256(base64 + saltKey)###index
    const expectedCb = crypto.createHash('sha256').update(base64 + saltKey).digest('hex') + '###' + saltIndex;
    if (got !== expectedCb && got !== expected) throw new Error('PhonePe webhook signature mismatch');

    const decoded: any = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    const d = decoded?.data || {};
    return {
      ref: d?.merchantTransactionId || decoded?.merchantTransactionId || '',
      providerTxnId: d?.transactionId || null,
      status: mapStatus(decoded?.code || d?.state || d?.responseCode),
      amount: typeof d?.amount === 'number' ? Math.round(d.amount / 100) : null,
      utr: extractUtr(d),
      raw: decoded,
    };
  },

  async fetchStatus(ref: string): Promise<StatusResult> {
    const { merchantId, saltKey, saltIndex, host } = cfg();
    if (!merchantId || !saltKey) throw new Error('PhonePe is not configured');
    const path = `/pg/v1/status/${merchantId}/${ref}`;
    const checksum = xVerify(path, saltKey, saltIndex);
    const res = await fetch(`${host}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-VERIFY': checksum, 'X-MERCHANT-ID': merchantId, accept: 'application/json' },
    });
    const json: any = await res.json().catch(() => ({}));
    const d = json?.data || {};
    return {
      status: mapStatus(json?.code || d?.state || d?.responseCode),
      providerTxnId: d?.transactionId || null,
      utr: extractUtr(d),
      raw: json,
    };
  },
};
