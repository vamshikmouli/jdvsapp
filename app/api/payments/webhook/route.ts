import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getProvider, confirmFromWebhook } from '@/lib/payments';

// POST /api/payments/webhook — the provider's server-to-server callback.
//
// We verify the signature, then confirmFromWebhook re-checks the provider's status API
// (the source of truth) before fulfilling. Always ACK 200 so the provider doesn't
// hammer retries; errors are logged, not thrown back.
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const headers: Record<string, string | undefined> = {};
    req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { paymentProvider: true } });
    const provider = getProvider(settings?.paymentProvider);

    const result = await provider.verifyWebhook(headers, rawBody);
    await confirmFromWebhook({ ref: result.ref, providerTxnId: result.providerTxnId, status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // A bad signature or malformed body lands here — log and still 200 (we never fulfill
    // on the webhook alone; the status re-check inside confirmFromWebhook is the gate).
    console.error('payments/webhook', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true });
  }
}
