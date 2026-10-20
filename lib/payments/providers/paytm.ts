// Paytm (for Business) adapter — same PaymentProvider interface as PhonePe.
//
// Scaffolded against Paytm's documented flow (Initiate Transaction + JS/Txn-Status
// webhook + Transaction Status API, with AES/checksum signing). It is intentionally
// left unwired until the school opens a Paytm Business account — at that point fill the
// three methods below using PAYTM_MID / PAYTM_KEY / PAYTM_WEBSITE from env. The rest of
// the payments core needs no changes to switch to it (set Settings.paymentProvider =
// "PAYTM").
import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider, StatusResult, WebhookResult } from './index';

function cfg() {
  return {
    mid: process.env.PAYTM_MID || '',
    key: process.env.PAYTM_KEY || '',
    website: process.env.PAYTM_WEBSITE || 'DEFAULT',
  };
}

const NOT_WIRED = 'Paytm provider is selected but not yet wired — add the Paytm Business credentials and implement lib/payments/providers/paytm.ts.';

export const paytmProvider: PaymentProvider = {
  key: 'PAYTM',

  isConfigured() {
    const { mid, key } = cfg();
    return Boolean(mid && key);
  },

  async createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    throw new Error(NOT_WIRED);
  },

  async verifyWebhook(_headers, _rawBody): Promise<WebhookResult> {
    throw new Error(NOT_WIRED);
  },

  async fetchStatus(_ref: string): Promise<StatusResult> {
    throw new Error(NOT_WIRED);
  },
};
