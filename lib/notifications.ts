// In-app + Web Push notifications for staff/admins.
//
// Each call fans an event out to every user who holds the relevant permission:
// a Notification row is written per recipient (for the top-bar bell) and a Web
// Push is sent to their subscribed devices. Both are best-effort and must never
// break the request that triggered them (e.g. a staff punch).
import { prisma } from '@/lib/db';
import type { Permission, PunchType } from '@prisma/client';
import { sendPushToUsers } from '@/lib/push';
import { whatsappConfigured, toWaNumber, sendTextTemplate } from '@/lib/services/whatsapp';

/** User ids of active users whose active role grants `permission`. */
export async function userIdsWithPermission(permission: Permission): Promise<string[]> {
  const roles = await prisma.role.findMany({
    where: { isActive: true, permissions: { some: { permission } } },
    select: { users: { where: { isActive: true }, select: { id: true } } },
  });
  return Array.from(new Set(roles.flatMap((r) => r.users.map((u) => u.id))));
}

/** Format a punch time in the configured school timezone, e.g. "9:04 AM". */
function fmtClock(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
  }
}

/**
 * Notify staff-attendance watchers that a staff member punched in/out.
 * Recipients = everyone who can view the staff-attendance board.
 */
export async function notifyStaffPunch(input: {
  staffId: string;
  type: PunchType;
  at: Date;
  timezone: string;
}): Promise<void> {
  try {
    const [staff, recipients] = await Promise.all([
      prisma.staff.findUnique({ where: { id: input.staffId }, select: { name: true, designation: true } }),
      userIdsWithPermission('STAFF_ATTENDANCE_VIEW'),
    ]);
    if (!staff || recipients.length === 0) return;

    const verb = input.type === 'IN' ? 'punched IN' : 'punched OUT';
    const time = fmtClock(input.at, input.timezone);
    const title = `${staff.name} ${verb}`;
    const body = `${staff.designation ? `${staff.designation} · ` : ''}${time}`;
    const url = '/admin/staff-attendance';

    await prisma.notification.createMany({
      data: recipients.map((userId) => ({ userId, type: 'STAFF_PUNCH', title, body, url })),
    });
    // Web Push to any devices these users have enabled. `tag` collapses rapid
    // repeat punches into a single OS notification slot.
    await sendPushToUsers(recipients, { title, body, url, tag: 'staff-punch' });
  } catch (err) {
    console.error('[notifications] notifyStaffPunch failed', err);
  }
}

/** Format a calendar date in the school timezone, e.g. "24 Aug 2026". */
function fmtDate(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Notify attendance managers that a staff member filed a missed-punch
 * (regularization) request. Fans out to the in-app bell + Web Push for everyone
 * who can manage requests, and — if WhatsApp is configured — pings the admin
 * WhatsApp recipients so they see it even when not in the app.
 *
 * Best-effort: never throws into the caller (the staff's submit must still 200).
 */
export async function notifyRegularizationRequest(input: {
  staffId: string;
  staffName: string;
  date: Date;
  punchType: PunchType;
  punchTime: Date;
  reason?: string | null;
  timezone: string;
}): Promise<void> {
  const dateLabel = fmtDate(input.date, input.timezone);
  const punchDesc = `${input.punchType} at ${fmtClock(input.punchTime, input.timezone)}`;
  const reasonText = (input.reason || '').trim() || '—';

  // 1) In-app bell + Web Push for managers.
  try {
    const recipients = await userIdsWithPermission('STAFF_ATTENDANCE_MANAGE');
    if (recipients.length) {
      const title = `${input.staffName} · missed-punch request`;
      const body = `${dateLabel} — punch ${punchDesc}. Tap to review.`;
      const url = '/admin/staff-attendance/regularization';
      await prisma.notification.createMany({
        data: recipients.map((userId) => ({ userId, type: 'REGULARIZATION', title, body, url })),
      });
      await sendPushToUsers(recipients, { title, body, url, tag: 'regularization' });
    }
  } catch (err) {
    console.error('[notifications] notifyRegularizationRequest (in-app) failed', err);
  }

  // 2) WhatsApp to the admin recipient list (same source as the daily digest).
  await sendWhatsAppToAdmins({
    template: process.env.WHATSAPP_REGULARIZATION_TEMPLATE_NAME || 'regularization_request',
    bodyParams: [input.staffName, dateLabel, punchDesc, reasonText],
    context: 'notifyRegularizationRequest',
  });
}

/** Admin WhatsApp recipients (settings list, falling back to env), as wa_ids. */
async function adminWaNumbers(): Promise<string[]> {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { waAdminRecipients: true } });
  const src = settings?.waAdminRecipients || process.env.WHATSAPP_ADMIN_RECIPIENTS || '';
  return src.split(',').map((s) => s.trim()).filter(Boolean).map(toWaNumber).filter(Boolean) as string[];
}

/** Fire an approved WhatsApp template to every admin recipient. Best-effort. */
async function sendWhatsAppToAdmins(opts: { template: string; bodyParams: string[]; context: string }): Promise<void> {
  try {
    if (!whatsappConfigured()) return;
    const numbers = await adminWaNumbers();
    if (!numbers.length) return;
    const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
    for (const to of numbers) {
      await sendTextTemplate({ to, templateName: opts.template, lang, bodyParams: opts.bodyParams });
    }
  } catch (err) {
    console.error(`[notifications] ${opts.context} (whatsapp) failed`, err);
  }
}

/**
 * Notify leave approvers that a staff member applied for leave.
 * In-app bell + Web Push for everyone who can approve leave, plus a WhatsApp
 * ping to the admin recipients. Best-effort: never throws into the caller.
 */
export async function notifyLeaveRequest(input: {
  staffName: string;
  type: string;
  fromDate: Date;
  toDate: Date;
  halfDay: boolean;
  halfSession?: string | null;
  days: number;
  reason?: string | null;
  timezone: string;
}): Promise<void> {
  const from = fmtDate(input.fromDate, input.timezone);
  const to = fmtDate(input.toDate, input.timezone);
  const range = from === to ? from : `${from} – ${to}`;
  const half = input.halfDay ? ` (half day${input.halfSession ? ` · ${input.halfSession.toLowerCase()}` : ''})` : '';
  const span = `${range}${half} — ${input.days} day${input.days === 1 ? '' : 's'}`;
  const reasonText = (input.reason || '').trim() || '—';

  // 1) In-app bell + Web Push for leave approvers.
  try {
    const recipients = await userIdsWithPermission('LEAVE_APPROVE');
    if (recipients.length) {
      const title = `${input.staffName} · leave request`;
      const body = `${input.type} · ${span}. Tap to review.`;
      const url = '/admin/leave';
      await prisma.notification.createMany({
        data: recipients.map((userId) => ({ userId, type: 'LEAVE_REQUEST', title, body, url })),
      });
      await sendPushToUsers(recipients, { title, body, url, tag: 'leave-request' });
    }
  } catch (err) {
    console.error('[notifications] notifyLeaveRequest (in-app) failed', err);
  }

  // 2) WhatsApp to the admin recipients.
  await sendWhatsAppToAdmins({
    template: process.env.WHATSAPP_LEAVE_TEMPLATE_NAME || 'leave_request',
    bodyParams: [input.staffName, input.type, span, reasonText],
    context: 'notifyLeaveRequest',
  });
}
