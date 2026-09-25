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

  // Also reflect the status on the two-way chat message (office replies), so the
  // WhatsApp inbox can show Sent / Delivered / Read ticks.
  const wa = await prisma.waMessage.findUnique({ where: { waMessageId: wamid }, select: { id: true, status: true } });
  if (wa) {
    const cur = STATUS_RANK[String(wa.status || '').toUpperCase()] || 0;
    if (!((STATUS_RANK[next] || 0) < cur && cur >= STATUS_RANK.DELIVERED)) {
      await prisma.waMessage.update({
        where: { id: wa.id },
        data: { status: next, error: next === 'FAILED' ? (error || 'Undeliverable') : null },
      });
    }
  }
}

// A WhatsApp reaction targets an earlier message by its wamid. It may live in the
// two-way chat log (WaMessage) or in a template we sent (MessageDelivery), so update
// both. `emoji` null means the parent removed their reaction.
async function applyReaction(targetWamid: string | undefined, emoji: string | null) {
  if (!targetWamid) return;
  await prisma.waMessage.updateMany({ where: { waMessageId: targetWamid }, data: { reaction: emoji } });
  await prisma.messageDelivery.updateMany({ where: { wamid: targetWamid }, data: { reaction: emoji } });
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
          // A reaction isn't a new message — it's an emoji the parent stuck on an
          // earlier message. Attach it to that message (or clear it) and move on.
          if (msg.type === 'reaction') {
            console.log(`[WA-INBOUND] from=${msg.from} type=reaction emoji=${msg.reaction?.emoji || '(removed)'} on=${msg.reaction?.message_id}`);
            await applyReaction(msg.reaction?.message_id, msg.reaction?.emoji || null)
              .catch((e) => console.log('[WA-REACTION] apply error:', e?.message));
            continue;
          }
          // Media messages (image/sticker/document/video/audio) carry a media id we
          // fetch on demand via the media proxy; any caption is the message text.
          const media = msg.image || msg.sticker || msg.document || msg.video || msg.audio;
          const inText = msg.text?.body || msg.button?.text || msg.interactive?.list_reply?.title
            || msg.interactive?.button_reply?.title || media?.caption || '';
          console.log(`[WA-INBOUND] from=${msg.from} type=${msg.type} text=${inText}${media?.id ? ` media=${media.id}` : ''}`);
          // Reverse login-verification: the user sent us their one-time code.
          if (msg.type === 'text' && msg.text?.body && msg.from) {
            await matchInboundVerification(msg.from, msg.text.body).catch((e) => console.log('[WA-VERIFY] match error:', e?.message));
          }
          // Capture the reply so the office can see & answer it in-app (Communications → Replies).
          if (msg.from) {
            await recordInboundMessage({ waMessageId: msg.id, from: msg.from, type: msg.type, text: inText || null, mediaId: media?.id || null })
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
