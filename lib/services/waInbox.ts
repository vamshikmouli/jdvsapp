import { prisma } from '@/lib/db';
import { sendWhatsAppText, toWaNumber, whatsappConfigured } from '@/lib/services/whatsapp';
import { sendPushToUsers } from '@/lib/push';
import { userIdsWithPermission } from '@/lib/notifications';

// WhatsApp "customer service window": you may send free-form (non-template) messages
// for 24 hours after the user's last inbound message. Replies from the office are
// only allowed inside this window.
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Last 10 digits — the stable part of an Indian number, for matching across formats. */
function last10(phone: string | null | undefined): string {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

/**
 * Best-effort: match an inbound WhatsApp number to a student's parent/guardian.
 * Returns the student + a human contact label (e.g. "Ramesh (Father)"), or nulls.
 */
export async function resolveContactByPhone(phone: string): Promise<{ studentId: string | null; studentName: string | null; contactName: string | null }> {
  const p = last10(phone);
  if (p.length < 10) return { studentId: null, studentName: null, contactName: null };
  const s = await prisma.student.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [
        { fatherPhone: { endsWith: p } },
        { motherPhone: { endsWith: p } },
        { guardianPhone: { endsWith: p } },
        { altGuardianPhone: { endsWith: p } },
      ],
    },
    select: {
      id: true, name: true,
      fatherName: true, fatherPhone: true,
      motherName: true, motherPhone: true,
      guardianName: true, guardianPhone: true,
      altGuardianName: true, altGuardianPhone: true,
    },
  });
  if (!s) return { studentId: null, studentName: null, contactName: null };
  let contactName: string | null = null;
  if (last10(s.fatherPhone) === p) contactName = `${s.fatherName || 'Father'} (Father)`;
  else if (last10(s.motherPhone) === p) contactName = `${s.motherName || 'Mother'} (Mother)`;
  else if (last10(s.guardianPhone) === p) contactName = `${s.guardianName || 'Guardian'} (Guardian)`;
  else if (last10(s.altGuardianPhone) === p) contactName = `${s.altGuardianName || 'Guardian'} (Guardian)`;
  return { studentId: s.id, studentName: s.name, contactName };
}

/**
 * Persist an inbound WhatsApp message (a parent reply). Idempotent on the Meta
 * message id, so webhook retries don't duplicate. Best-effort — never throws.
 */
export async function recordInboundMessage(opts: { waMessageId?: string; from: string; type?: string; text?: string | null }): Promise<void> {
  try {
    if (!opts.from) return;
    if (opts.waMessageId) {
      const exists = await prisma.waMessage.findUnique({ where: { waMessageId: opts.waMessageId }, select: { id: true } });
      if (exists) return;
    }
    const contact = await resolveContactByPhone(opts.from);
    await prisma.waMessage.create({
      data: {
        waMessageId: opts.waMessageId || null,
        direction: 'IN',
        phone: opts.from,
        type: opts.type || 'text',
        text: opts.text ?? null,
        studentId: contact.studentId,
        studentName: contact.studentName,
        contactName: contact.contactName,
      },
    });

    // Notify the office (anyone who can see Replies) with an app push. Skip a bare
    // numeric code (that's a login OTP the parent is confirming, not a real reply).
    const isOtpCode = /^\s*\d{4,8}\s*$/.test(opts.text || '');
    if (!isOtpCode) {
      try {
        const admins = await userIdsWithPermission('NOTICES_MANAGE');
        if (admins.length) {
          const who = contact.studentName
            ? `${contact.contactName || 'Parent'} · ${contact.studentName}`
            : (contact.contactName || opts.from);
          const preview = (opts.text || '').trim().slice(0, 120) || '(media message)';
          await sendPushToUsers(admins, {
            title: 'New parent reply',
            body: `${who}: ${preview}`,
            url: '/admin/communications?tab=replies',
            tag: `wa-reply-${opts.from}`,
          });
        }
      } catch (e) {
        console.error('[waInbox] push notify failed', e);
      }
    }
  } catch (e) {
    console.error('[waInbox] recordInbound failed', e);
  }
}

export interface ReplyThread {
  phone: string;
  studentId: string | null;
  studentName: string | null;
  contactName: string | null;
  lastText: string | null;
  lastAt: string;
  lastDirection: string;
  unread: number;             // inbound messages not yet marked handled
  canReply: boolean;          // inside the 24h window
  windowEndsAt: string | null;
}

/** One row per parent (phone), newest activity first, with unread + reply-window state. */
export async function listReplyThreads(limit = 200): Promise<ReplyThread[]> {
  // Pull a recent window of messages and fold into threads client-side (cheap).
  const rows = await prisma.waMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 800 });
  const byPhone = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byPhone.get(r.phone) || [];
    list.push(r); byPhone.set(r.phone, list);
  }
  const now = Date.now();
  const threads: ReplyThread[] = [];
  for (const [phone, list] of byPhone) {
    const latest = list[0]; // rows are newest-first
    const lastIn = list.find((m) => m.direction === 'IN');
    const windowEnd = lastIn ? lastIn.createdAt.getTime() + REPLY_WINDOW_MS : 0;
    threads.push({
      phone,
      studentId: latest.studentId,
      studentName: latest.studentName,
      contactName: latest.contactName,
      lastText: latest.text,
      lastAt: latest.createdAt.toISOString(),
      lastDirection: latest.direction,
      unread: list.filter((m) => m.direction === 'IN' && !m.handled).length,
      canReply: windowEnd > now,
      windowEndsAt: windowEnd ? new Date(windowEnd).toISOString() : null,
    });
  }
  threads.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return threads.slice(0, limit);
}

interface ThreadMessage {
  id: string; direction: string; text: string | null; type: string; at: string;
  error: string | null; handled: boolean; studentName: string | null; contactName: string | null;
  system: boolean; kind: string | null; status: string | null;
}

/**
 * Full conversation with one parent (phone), oldest first. Merges the two-way
 * WaMessage log (parent replies + office replies) with everything the app SENT to
 * that number (fee reminders, absence/leave alerts, receipts, monthly attendance…
 * from MessageDelivery), so the office sees exactly what a reply is responding to.
 */
export async function getThread(phone: string): Promise<ThreadMessage[]> {
  const [waRows, sent] = await Promise.all([
    prisma.waMessage.findMany({ where: { phone }, orderBy: { createdAt: 'asc' } }),
    prisma.messageDelivery.findMany({
      where: { phone },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, title: true, status: true, error: true, createdAt: true, studentName: true },
    }),
  ]);
  const merged: (ThreadMessage & { _at: Date })[] = [
    ...waRows.map((r) => ({
      id: r.id, direction: r.direction, text: r.text, type: r.type, at: r.createdAt.toISOString(),
      error: r.error, handled: r.handled, studentName: r.studentName, contactName: r.contactName,
      system: false, kind: null, status: null, _at: r.createdAt,
    })),
    ...sent.map((d) => ({
      id: `md_${d.id}`, direction: 'OUT', text: d.title || null, type: 'template', at: d.createdAt.toISOString(),
      error: d.error, handled: true, studentName: d.studentName, contactName: null,
      system: true, kind: d.kind, status: d.status, _at: d.createdAt,
    })),
  ].sort((a, b) => a._at.getTime() - b._at.getTime());
  return merged.map(({ _at, ...m }) => m);
}

/** Mark every inbound message from a phone as handled (read). */
export async function markThreadHandled(phone: string, userId?: string | null): Promise<void> {
  await prisma.waMessage.updateMany({
    where: { phone, direction: 'IN', handled: false },
    data: { handled: true, handledById: userId || null, handledAt: new Date() },
  });
}

/**
 * Send a free-form reply to a parent. Only allowed inside the 24h customer-service
 * window (there must be an inbound message from them within the last 24h). Records
 * the outbound message and marks the thread handled.
 */
export async function sendReply(opts: { phone: string; text: string; sentById?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const text = (opts.text || '').trim();
  if (!text) return { ok: false, error: 'Message is empty.' };
  if (!whatsappConfigured()) return { ok: false, error: 'WhatsApp is not configured.' };

  const to = toWaNumber(opts.phone);
  if (!to) return { ok: false, error: 'Invalid phone number.' };

  const lastIn = await prisma.waMessage.findFirst({ where: { phone: opts.phone, direction: 'IN' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (!lastIn || Date.now() - lastIn.createdAt.getTime() > REPLY_WINDOW_MS) {
    return { ok: false, error: 'The 24-hour reply window has closed. The parent must message again before you can reply freely.' };
  }

  const res = await sendWhatsAppText({ to, text });
  const contact = await resolveContactByPhone(opts.phone);
  await prisma.waMessage.create({
    data: {
      waMessageId: res.id || null,
      direction: 'OUT',
      phone: opts.phone,
      type: 'text',
      text,
      studentId: contact.studentId,
      studentName: contact.studentName,
      contactName: contact.contactName,
      sentById: opts.sentById || null,
      error: res.ok ? null : (res.error || 'Send failed'),
    },
  });
  if (res.ok) await markThreadHandled(opts.phone, opts.sentById);
  return res.ok ? { ok: true } : { ok: false, error: res.error || 'Send failed' };
}
