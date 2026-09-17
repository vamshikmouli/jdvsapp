import { NextRequest, NextResponse } from 'next/server';
import { matchInboundVerification } from '@/lib/auth/waVerify';
import { recordInboundMessage } from '@/lib/services/waInbox';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// WhatsApp Cloud API webhook.
//  GET  — verification handshake (Meta sends hub.challenge on setup)
//  POST — delivery status + inbound messages. We log statuses (sent/delivered/
//         read/failed with error detail) so we can diagnose message delivery.
// Configure in Meta: App → WhatsApp → Configuration → Callback URL =
//   https://jnanadeepika.app/api/whatsapp/webhook , Verify token = WHATSAPP_WEBHOOK_VERIFY_TOKEN
// then subscribe to the "messages" field.

// Delivery-status precedence: FAILED and READ are terminal; DELIVERED beats SENT.
// Meta can send statuses slightly out of order, so never downgrade a stronger state.
const STATUS_RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

async function updateDeliveryStatus(wamid: string | undefined, waStatus: string, error: string) {
  if (!wamid) return;
  const next = String(waStatus || '').toUpperCase(); // sent | delivered | read | failed
  if (!(next in STATUS_RANK)) return;
  const rows = await prisma.messageDelivery.findMany({ where: { wamid }, select: { id: true, status: true } });
  for (const row of rows) {
    const cur = STATUS_RANK[String(row.status || '').toUpperCase()] || 0;
    // Don't overwrite a stronger/terminal state with a weaker one (e.g. READ→DELIVERED).
    if ((STATUS_RANK[next] || 0) < cur && cur >= STATUS_RANK.DELIVERED) continue;
    await prisma.messageDelivery.update({
      where: { id: row.id },
      data: { status: next, error: next === 'FAILED' ? (error || 'Undeliverable (number may not be on WhatsApp)') : null },
    });
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('hub.mode');
  const token = sp.get('hub.verify_token');
  const challenge = sp.get('hub.challenge');
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    return new NextResponse(challenge || '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        for (const st of v.statuses || []) {
          const err = (st.errors || []).map((e: any) => `${e.code}:${e.title}${e.error_data?.details ? ` (${e.error_data.details})` : ''}`).join('; ');
          console.log(`[WA-STATUS] to=${st.recipient_id} status=${st.status} id=${st.id}${err ? ` ERROR=${err}` : ''}`);
          // Reflect the real delivery outcome in the saved reminder log (Analytics).
          // A number that isn't on WhatsApp is accepted (200) at send time and only
          // reported "failed" here — so this is what turns a false "Sent" into "Failed".
          await updateDeliveryStatus(st.id, st.status, err).catch((e) =>
            console.log('[WA-STATUS] log update error:', e?.message));
        }
        for (const msg of v.messages || []) {
          const inText = msg.text?.body || msg.button?.text || msg.interactive?.list_reply?.title || msg.interactive?.button_reply?.title || '';
          console.log(`[WA-INBOUND] from=${msg.from} type=${msg.type} text=${inText}`);
          // Reverse login-verification: the user sent us their one-time code.
          if (msg.type === 'text' && msg.text?.body && msg.from) {
            await matchInboundVerification(msg.from, msg.text.body).catch((e) => console.log('[WA-VERIFY] match error:', e?.message));
          }
          // Capture the reply so the office can see & answer it in-app (Communications → Replies).
          if (msg.from) {
            await recordInboundMessage({ waMessageId: msg.id, from: msg.from, type: msg.type, text: inText || null })
              .catch((e) => console.log('[WA-INBOUND] store error:', e?.message));
          }
        }
      }
    }
  } catch (e: any) {
    console.log('[WA-WEBHOOK] parse error:', e?.message);
  }
  // Always 200 so Meta doesn't retry/disable the webhook.
  return NextResponse.json({ ok: true });
}
