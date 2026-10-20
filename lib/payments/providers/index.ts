// Payment provider abstraction.
//
// A provider turns an abstract PaymentOrder into a real UPI collect at a *Business
// merchant* account (PhonePe / Paytm today; a bank-email or SMS engine could be added
// later behind the same interface). The payments core only ever talks to this
// interface, so swapping or adding a provider never touches the orders/fulfillment code.
//
// Money never flows through us: the provider is the licensed aggregator and settles to
// the school's own account. We only initiate the request and learn the outcome (webhook
// + status API).

export type ProviderStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface CreatePaymentInput {
  ref: string; // our merchant transaction reference (unique per order)
  amount: number; // whole rupees
  userId?: string | null; // opaque payer id passed through to the provider
  purpose: string;
  note?: string | null;
}

export interface CreatePaymentResult {
  providerTxnId?: string | null;
  // One (or more) of these is returned depending on the provider/instrument:
  redirectUrl?: string | null; // hosted checkout / pay page (universal; works web + mobile)
  intentUrl?: string | null; // upi:// deep link (opens the UPI app directly, amount pre-filled)
  qrDataUrl?: string | null; // a scannable QR (data: URL) for desktop
  raw?: unknown;
}

export interface WebhookResult {
  ref: string; // our order ref, recovered from the payload
  providerTxnId?: string | null;
  status: ProviderStatus;
  amount?: number | null; // whole rupees, when the provider reports it
  utr?: string | null;
  raw?: unknown;
}

export interface StatusResult {
  status: ProviderStatus;
  providerTxnId?: string | null;
  utr?: string | null;
  raw?: unknown;
}

export interface PaymentProvider {
  /** Stable key stored on the order, e.g. "PHONEPE". */
  readonly key: string;
  /** True when the server has the credentials this provider needs. */
  isConfigured(): boolean;
  /** Initiate a collect; returns the links/QR the payer uses to pay. */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Validate + decode a provider webhook callback. Throws on a bad signature. */
  verifyWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<WebhookResult>;
  /** Authoritative status, re-checked server-side before any fulfillment. */
  fetchStatus(ref: string, providerTxnId?: string | null): Promise<StatusResult>;
}

import { phonePeProvider } from './phonepe';
import { paytmProvider } from './paytm';

const REGISTRY: Record<string, PaymentProvider> = {
  PHONEPE: phonePeProvider,
  PAYTM: paytmProvider,
};

/**
 * Resolve the active provider. `name` normally comes from Settings.paymentProvider;
 * falls back to the PAYMENTS_PROVIDER env var, then PhonePe.
 */
export function getProvider(name?: string | null): PaymentProvider {
  const key = (name || process.env.PAYMENTS_PROVIDER || 'PHONEPE').toUpperCase();
  const p = REGISTRY[key];
  if (!p) throw new Error(`Unknown payment provider "${key}"`);
  return p;
}
