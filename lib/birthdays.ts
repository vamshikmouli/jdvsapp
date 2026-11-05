import { prisma } from '@/lib/db';
import { sendPushToUsers } from '@/lib/push';

// Birthday wishes: a push + bell row on the day (daily cron), and an in-app greeting
// popup for the signed-in staff member / parent. Dates of birth are @db.Date (stored
// as UTC midnight), so month/day are read with the UTC getters; "today" is IST.

export const istTodayKey = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Does this date of birth fall on `todayKey`? Feb-29 birthdays are wished on Feb 28 in non-leap years. */
export function isBirthdayOn(dob: Date | null | undefined, todayKey: string): boolean {
  if (!dob) return false;
  const m = dob.getUTCMonth() + 1, d = dob.getUTCDate();
  const [y, tm, td] = todayKey.split('-').map(Number);
  if (m === tm && d === td) return true;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return !leap && m === 2 && d === 29 && tm === 2 && td === 28;
}

/** Age turned today (students only — never shown for staff). null if the year looks wrong. */
function ageOn(dob: Date, todayKey: string): number | null {
  const age = Number(todayKey.slice(0, 4)) - dob.getUTCFullYear();
  return age > 0 && age < 30 ? age : null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export interface BirthdayWish {
  kind: 'STUDENT' | 'STAFF';
  id: string;
  name: string;
  firstName: string;
  age: number | null; // students only
}

async function schoolName(): Promise<string> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { schoolName: true } });
  return s?.schoolName || 'School';
}

/** Today's wishes for one signed-in user: their own birthday (staff) and their children's (parent). */
export async function birthdayWishesForUser(userId: string, todayKey = istTodayKey()): Promise<{ wishes: BirthdayWish[]; schoolName: string }> {
  const [staff, kids, school] = await Promise.all([
    prisma.staff.findUnique({ where: { userId }, select: { id: true, name: true, dob: true, archived: true } }),
    prisma.student.findMany({ where: { guardianUserId: userId, status: 'ACTIVE' }, select: { id: true, name: true, dob: true } }),
    schoolName(),
  ]);
  const wishes: BirthdayWish[] = [];
  if (staff && !staff.archived && isBirthdayOn(staff.dob, todayKey)) {
    wishes.push({ kind: 'STAFF', id: staff.id, name: staff.name, firstName: firstName(staff.name), age: null });
  }
  for (const k of kids) {
    if (k.dob && isBirthdayOn(k.dob, todayKey)) {
      wishes.push({ kind: 'STUDENT', id: k.id, name: k.name, firstName: firstName(k.name), age: ageOn(k.dob, todayKey) });
    }
  }
  return { wishes, schoolName: school };
}

export function wishText(w: Pick<BirthdayWish, 'kind' | 'name' | 'firstName' | 'age'>, school: string): { title: string; body: string } {
  if (w.kind === 'STUDENT') {
    const turns = w.age ? ` turns ${w.age} today` : `'s birthday is today`;
    return {
      title: `🎂 Happy Birthday, ${w.firstName}!`,
      body: `${w.firstName}${turns}! Wishing ${w.name} a joyful birthday and a wonderful year ahead. — ${school}`,
    };
  }
  return {
    title: `🎂 Happy Birthday, ${w.firstName}!`,
    body: `Wishing you a wonderful birthday and a great year ahead. Thank you for all you do. — ${school} family`,
  };
}

/** "A, B, C +2 more" — keeps a push body short. */
function nameList(names: string[], max = 6): string {
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

/**
 * Daily job (morning cron):
 *  1. Wish the birthday person — push + bell to the parent of each birthday student
 *     and to each birthday staff member.
 *  2. A heads-up digest so they can wish in person — admins get every birthday today
 *     (students with class, and staff); class teachers get their own class's students.
 * Idempotent — a wish (same user + title) or a digest (one per user) already sent
 * today isn't sent again, so the cron can safely run more than once. `dry` only counts.
 */
export async function runBirthdayWishes(opts: { dry?: boolean; todayKey?: string } = {}) {
  const todayKey = opts.todayKey ?? istTodayKey();
  const [students, staff, school] = await Promise.all([
    prisma.student.findMany({
      where: { status: 'ACTIVE', dob: { not: null } },
      select: { id: true, name: true, dob: true, guardianUserId: true, classId: true, class: { select: { name: true } } },
    }),
    prisma.staff.findMany({
      where: { archived: false, dob: { not: null } },
      select: { id: true, name: true, dob: true, userId: true },
    }),
    schoolName(),
  ]);
  const kidsToday = students.filter((s) => isBirthdayOn(s.dob, todayKey));
  const staffToday = staff.filter((s) => isBirthdayOn(s.dob, todayKey));

  type Send = { userId: string; type: 'BIRTHDAY' | 'BIRTHDAY_DIGEST'; title: string; body: string; url: string };
  const sends: Send[] = [];

  // 1) Wishes to the birthday person.
  for (const s of kidsToday) {
    if (!s.guardianUserId) continue;
    const t = wishText({ kind: 'STUDENT', name: s.name, firstName: firstName(s.name), age: ageOn(s.dob!, todayKey) }, school);
    sends.push({ userId: s.guardianUserId, type: 'BIRTHDAY', ...t, url: '/parent' });
  }
  for (const s of staffToday) {
    if (!s.userId) continue;
    const t = wishText({ kind: 'STAFF', name: s.name, firstName: firstName(s.name), age: null }, school);
    sends.push({ userId: s.userId, type: 'BIRTHDAY', ...t, url: '/admin/dashboard' });
  }

  // 2) Heads-up digests to admins and class teachers.
  if (kidsToday.length || staffToday.length) {
    const kidLabel = (s: (typeof kidsToday)[number]) => `${s.name}${s.class?.name ? ` (${s.class.name})` : ''}`;
    const classIds = Array.from(new Set(kidsToday.map((s) => s.classId).filter((c): c is string => !!c)));
    const [admins, classes] = await Promise.all([
      prisma.user.findMany({ where: { isActive: true, role: { key: 'admin' } }, select: { id: true } }),
      classIds.length
        ? prisma.schoolClass.findMany({
            where: { id: { in: classIds } },
            select: { id: true, teachers: { where: { archived: false, userId: { not: null } }, select: { userId: true } } },
          })
        : Promise.resolve([]),
    ]);
    const adminIds = new Set(admins.map((a) => a.id));

    for (const userId of adminIds) {
      // An admin isn't told about their own birthday — they get the wish instead.
      const staffNames = staffToday.filter((s) => s.userId !== userId).map((s) => s.name);
      const count = kidsToday.length + staffNames.length;
      if (!count) continue;
      const parts = [
        kidsToday.length ? `Students: ${nameList(kidsToday.map(kidLabel))}` : '',
        staffNames.length ? `Staff: ${nameList(staffNames)}` : '',
      ].filter(Boolean);
      sends.push({
        userId, type: 'BIRTHDAY_DIGEST',
        title: `🎂 ${count} birthday${count === 1 ? '' : 's'} today`,
        body: `${parts.join(' · ')}. Don't forget to wish them!`,
        url: '/admin/dashboard',
      });
    }

    // Class teachers — their class's students (admins already have the full list).
    const byTeacher = new Map<string, string[]>();
    for (const c of classes) {
      const kids = kidsToday.filter((s) => s.classId === c.id).map(kidLabel);
      for (const t of c.teachers) {
        if (!t.userId || adminIds.has(t.userId)) continue;
        byTeacher.set(t.userId, [...(byTeacher.get(t.userId) || []), ...kids]);
      }
    }
    for (const [userId, kids] of byTeacher) {
      sends.push({
        userId, type: 'BIRTHDAY_DIGEST',
        title: kids.length === 1 ? '🎂 Birthday in your class today' : `🎂 ${kids.length} birthdays in your class today`,
        body: `${nameList(kids)} — wish ${kids.length === 1 ? 'them' : 'them all'} today!`,
        url: '/admin/dashboard',
      });
    }
  }

  // Skip anything already sent today (IST day): a wish = same user + title, a digest = one per user.
  const since = new Date(`${todayKey}T00:00:00+05:30`);
  const already = sends.length
    ? await prisma.notification.findMany({
        where: { type: { in: ['BIRTHDAY', 'BIRTHDAY_DIGEST'] }, createdAt: { gte: since }, userId: { in: sends.map((s) => s.userId) } },
        select: { userId: true, type: true, title: true },
      })
    : [];
  const key = (s: { userId: string; type: string; title: string }) => (s.type === 'BIRTHDAY_DIGEST' ? `${s.userId}|digest` : `${s.userId}|${s.title}`);
  const done = new Set(already.map(key));
  const pending = sends.filter((s) => !done.has(key(s)));

  const summary = {
    todayKey,
    students: kidsToday.map((s) => s.name),
    staff: staffToday.map((s) => s.name),
    wishes: sends.filter((s) => s.type === 'BIRTHDAY').length,
    digests: sends.filter((s) => s.type === 'BIRTHDAY_DIGEST').length,
    alreadySent: sends.length - pending.length,
    sent: 0,
    dry: !!opts.dry,
  };
  if (opts.dry || !pending.length) return summary;

  await prisma.notification.createMany({
    data: pending.map((s) => ({ userId: s.userId, type: s.type, title: s.title, body: s.body, url: s.url })),
  });
  for (const s of pending) {
    await sendPushToUsers([s.userId], { title: s.title, body: s.body, url: s.url, tag: `${s.type === 'BIRTHDAY' ? 'birthday' : 'birthday-digest'}-${todayKey}` });
  }
  summary.sent = pending.length;
  return summary;
}
