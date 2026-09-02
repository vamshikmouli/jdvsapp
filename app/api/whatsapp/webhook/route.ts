import { NextRequest, NextResponse } from 'next/server';
import { matchInboundVerification } from '@/lib/auth/waVerify';

export const dynamic = 'force-dynamic';

// WhatsApp Cloud API webhook.
//  GET  — verification handshake (Meta sends hub.challenge on setup)
//  POST — delivery status + inbound messages. We log statuses (sent/delivered/
//         read/failed with error detail) so we can diagnose message delivery.
// Configure in Meta: App → WhatsApp → Configuration → Callback URL =
//   https://jnanadeepika.app/api/whatsapp/webhook , Verify token = WHATSAPP_WEBHOOK_VERIFY_TOKEN
// then subscribe to the "messages" field.

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
        }
        for (const msg of v.messages || []) {
          console.log(`[WA-INBOUND] from=${msg.from} type=${msg.type} text=${msg.text?.body || ''}`);
          // Reverse login-verification: the user sent us their one-time code.
          if (msg.type === 'text' && msg.text?.body && msg.from) {
            await matchInboundVerification(msg.from, msg.text.body).catch((e) => console.log('[WA-VERIFY] match error:', e?.message));
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
