// In-app + Web Push notifications for staff/admins.
//
// Each call fans an event out to every user who holds the relevant permission:
// a Notification row is written per recipient (for the top-bar bell) and a Web
// Push is sent to their subscribed devices. Both are best-effort and must never
// break the request that triggered them (e.g. a staff punch).
import { prisma } from '@/lib/db';
import type { Permission, PunchType } from '@prisma/client';
import { sendPushToUsers } from '@/lib/push';

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
