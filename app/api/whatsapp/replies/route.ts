import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { listReplyThreads, getThread, sendReply, markThreadHandled } from '@/lib/services/waInbox';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

// GET /api/whatsapp/replies            → threads (one per parent, newest first)
// GET /api/whatsapp/replies?phone=…    → full conversation with that parent
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const phone = new URL(req.url).searchParams.get('phone');
    if (phone) {
      await markThreadHandled(phone, (session.user as any)?.id ?? null);
      return NextResponse.json({ messages: await getThread(phone) });
    }
    return NextResponse.json({ threads: await listReplyThreads() });
  } catch (err) {
    console.error('whatsapp/replies GET', err);
    return NextResponse.json({ error: 'Failed to load replies' }, { status: 500 });
  }
}

// POST /api/whatsapp/replies  Body: { phone, text } — reply within the 24h window.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const phone = String(body.phone || '');
    const text = String(body.text || '');
    if (!phone || !text.trim()) return NextResponse.json({ error: 'phone and text are required' }, { status: 400 });

    const res = await sendReply({ phone, text, sentById: (session.user as any)?.id ?? null });
    if (!res.ok) return NextResponse.json({ error: res.error || 'Could not send' }, { status: 400 });
    void logActivity(session, { category: 'OTHER', action: 'WA_REPLY_SENT', summary: `Replied to ${phone} on WhatsApp`, meta: { phone }, req });
    return NextResponse.json({ ok: true, messages: await getThread(phone) });
  } catch (err) {
    console.error('whatsapp/replies POST', err);
    return NextResponse.json({ error: 'Failed to send reply' }, { status: 500 });
  }
}

// PATCH /api/whatsapp/replies  Body: { phone } — mark a thread handled without replying.
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const phone = String(body.phone || '');
    if (!phone) return NextResponse.json({ error: 'phone is required' }, { status: 400 });
    await markThreadHandled(phone, (session.user as any)?.id ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('whatsapp/replies PATCH', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
