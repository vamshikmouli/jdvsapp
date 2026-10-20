import { prisma } from '@/lib/db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Deliver a push to every native (Expo) device registered by the given users,
 * via Expo's push service. Best-effort: never throws, and prunes tokens Expo
 * reports as DeviceNotRegistered. Separate from Web Push (see lib/push.ts).
 */
export async function sendExpoPush(userIds: string[], payload: ExpoPushPayload): Promise<{ sent: number; failed: number }> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return { sent: 0, failed: 0 };

  const rows = await prisma.expoPushToken.findMany({ where: { userId: { in: ids } } });
  if (rows.length === 0) return { sent: 0, failed: 0 };

  const messages = rows.map((r) => ({
    to: r.token,
    title: payload.title,
    body: payload.body,
    sound: 'default' as const,
    data: { url: payload.url || '/parent', tag: payload.tag },
  }));

  let sent = 0, failed = 0;
  const dead: string[] = [];

  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      const json: any = await res.json().catch(() => null);
      const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
      if (tickets.length !== chunk.length) {
        failed += chunk.length;
        continue;
      }
      tickets.forEach((t, idx) => {
        if (t?.status === 'ok') {
          sent++;
        } else {
          failed++;
          if (t?.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx].to);
        }
      });
    } catch {
      failed += chunk.length;
    }
  }

  if (dead.length) {
    await prisma.expoPushToken.deleteMany({ where: { token: { in: dead } } }).catch(() => {});
  }
  return { sent, failed };
}
