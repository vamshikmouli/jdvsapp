import { prisma } from '@/lib/db';
import { sendPushToUsers } from '@/lib/push';

export interface ReminderDTO {
  id: string;
  title: string;
  note: string | null;
  dueAt: string;
  status: 'OPEN' | 'DONE' | 'DISMISSED';
  assignedToId: string | null;
  assignedToName: string | null;
  createdById: string | null;
  createdByName: string | null;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  url: string | null;
  completedAt: string | null;
}

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Resolve a set of user ids → names (for assignee / creator display). */
async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean) as string[]));
  if (!uniq.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

function toDTO(r: any, names: Map<string, string>): ReminderDTO {
  return {
    id: r.id, title: r.title, note: r.note, dueAt: r.dueAt.toISOString(), status: r.status,
    assignedToId: r.assignedToId, assignedToName: r.assignedToId ? names.get(r.assignedToId) || null : null,
    createdById: r.createdById, createdByName: r.createdById ? names.get(r.createdById) || null : null,
    entityType: r.entityType, entityId: r.entityId, entityLabel: r.entityLabel, url: r.url,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  };
}

/** List reminders. scope 'mine' = assigned to or created by me; 'all' = everyone (admins). */
export async function listReminders(userId: string, opts: { scope?: 'mine' | 'all'; status?: string } = {}): Promise<ReminderDTO[]> {
  const where: any = {};
  if (opts.scope !== 'all') where.OR = [{ assignedToId: userId }, { AND: [{ assignedToId: null }, { createdById: userId }] }];
  if (opts.status === 'open') where.status = 'OPEN';
  else if (opts.status === 'done') where.status = { in: ['DONE', 'DISMISSED'] };
  const rows = await prisma.reminder.findMany({ where, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 500 });
  const names = await nameMap(rows.flatMap((r) => [r.assignedToId, r.createdById]));
  return rows.map((r) => toDTO(r, names));
}

/** Count of OPEN reminders due today or overdue, for a user (bell badge). */
export async function dueCount(userId: string): Promise<number> {
  const end = new Date(`${istToday()}T23:59:59.999+05:30`);
  return prisma.reminder.count({
    where: { status: 'OPEN', dueAt: { lte: end }, OR: [{ assignedToId: userId }, { AND: [{ assignedToId: null }, { createdById: userId }] }] },
  });
}

/**
 * Daily digest: for each person with OPEN reminders due today or overdue (not yet
 * notified today), drop an in-app notification + push. Returns how many people
 * were notified. Run once each morning from a cron.
 */
export async function sendRemindersDigest(): Promise<{ people: number; reminders: number }> {
  const today = istToday();
  const end = new Date(`${today}T23:59:59.999+05:30`);
  const due = await prisma.reminder.findMany({
    where: { status: 'OPEN', dueAt: { lte: end }, NOT: { lastNotifiedOn: today } },
    orderBy: { dueAt: 'asc' },
  });
  if (!due.length) return { people: 0, reminders: 0 };

  // Group by the person who should act (assignee, else creator).
  const byUser = new Map<string, typeof due>();
  for (const r of due) {
    const uid = r.assignedToId || r.createdById;
    if (!uid) continue;
    (byUser.get(uid) || byUser.set(uid, []).get(uid)!).push(r);
  }

  let people = 0;
  for (const [uid, list] of byUser) {
    const overdue = list.filter((r) => r.dueAt.toISOString().slice(0, 10) < today).length;
    const title = `${list.length} follow-up${list.length === 1 ? '' : 's'} due${overdue ? ` · ${overdue} overdue` : ''}`;
    const body = list.slice(0, 5).map((r) => `• ${r.title}`).join('\n') + (list.length > 5 ? `\n…and ${list.length - 5} more` : '');
    try {
      await prisma.notification.create({ data: { userId: uid, type: 'REMINDER_DUE', title, body, url: '/admin/reminders' } });
      await sendPushToUsers([uid], { title, body: list[0].title, url: '/admin/reminders', tag: `reminders-${today}` });
      people++;
    } catch (e) { console.error('reminder digest', uid, e); }
  }
  await prisma.reminder.updateMany({ where: { id: { in: due.map((r) => r.id) } }, data: { lastNotifiedOn: today } });
  return { people, reminders: due.length };
}
