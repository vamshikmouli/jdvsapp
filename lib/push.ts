import webpush from 'web-push';
import { prisma } from '@/lib/db';

// Configure VAPID once per process.
let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@jnanadeepika.edu';
  if (!pub || !priv) {
    console.warn('[push] VAPID keys missing — push disabled');
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string; // where to go when tapped (default /parent)
  tag?: string; // dedupe key
}

/**
 * Send a push notification to every device subscribed by the given users.
 * Dead subscriptions (410/404) are pruned automatically. Never throws — push
 * is best-effort and must not break the request that triggered it.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!ensureConfigured()) return { sent: 0, failed: 0 };
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return { sent: 0, failed: 0 };

  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: ids } } });
  if (subs.length === 0) return { sent: 0, failed: 0 };

  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/parent',
    tag: payload.tag,
  });

  let sent = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data
        );
        sent++;
      } catch (err: any) {
        failed++;
        const code = err?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // gone — prune
      }
    })
  );
  if (dead.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }).catch(() => {});
  }
  return { sent, failed };
}

/** Resolve the guardian (parent) user ids for a set of student ids. */
export async function parentUserIdsForStudents(studentIds: string[]): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const rows = await prisma.student.findMany({
    where: { id: { in: studentIds }, guardianUserId: { not: null } },
    select: { guardianUserId: true },
  });
  return Array.from(new Set(rows.map((r) => r.guardianUserId!).filter(Boolean)));
}

/** Resolve guardian user ids for whole-school / class / explicit-student audiences. */
export async function parentUserIdsForAudience(audience: 'SCHOOL' | 'CLASS' | 'STUDENT', opts: { classIds?: string[]; studentIds?: string[] }): Promise<string[]> {
  let where: any;
  if (audience === 'SCHOOL') where = { guardianUserId: { not: null } };
  else if (audience === 'CLASS') where = { guardianUserId: { not: null }, classId: { in: opts.classIds || [] } };
  else where = { guardianUserId: { not: null }, id: { in: opts.studentIds || [] } };
  const rows = await prisma.student.findMany({ where, select: { guardianUserId: true } });
  return Array.from(new Set(rows.map((r) => r.guardianUserId!).filter(Boolean)));
}
