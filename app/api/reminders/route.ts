import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { listReminders, dueCount } from '@/lib/services/reminders';
import { sendPushToUsers } from '@/lib/push';

export const dynamic = 'force-dynamic';

// GET /api/reminders?scope=mine|all&status=open|done — list; also returns `due` count.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  let view = (sp.get('view') || sp.get('scope') || 'mine') as 'mine' | 'assigned' | 'all';
  if (view === 'all' && !canAny(session!, ['USERS_MANAGE', 'SETTINGS_MANAGE'])) view = 'mine';
  const [items, due] = await Promise.all([
    listReminders(userId, { scope: view, status: sp.get('status') || undefined }),
    dueCount(userId),
  ]);
  return NextResponse.json({ items, due, canSeeAll: canAny(session!, ['USERS_MANAGE', 'SETTINGS_MANAGE']) });
}

// POST /api/reminders — create a reminder (any signed-in staff).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const me = (session?.user as any)?.id as string | undefined;
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const title = String(b.title || '').trim();
  const dueAt = b.dueAt ? new Date(b.dueAt) : null;
  if (!title) return NextResponse.json({ error: 'A title is required' }, { status: 400 });
  if (!dueAt || isNaN(dueAt.getTime())) return NextResponse.json({ error: 'A valid due date/time is required' }, { status: 400 });

  // Assignees: a copy per person. Accept assignedToIds[] (new) or assignedToId (legacy);
  // empty → assign to the creator.
  const rawIds: string[] = Array.isArray(b.assignedToIds)
    ? b.assignedToIds.map((x: any) => String(x)).filter(Boolean)
    : (b.assignedToId ? [String(b.assignedToId)] : []);
  const assigneeIds = Array.from(new Set(rawIds.length ? rawIds : [me]));

  // Linked students: one reminder references many. Keep the first in entityId for the
  // existing link/index; store the full list in `students`.
  const students: { id: string; name: string; className?: string | null }[] = Array.isArray(b.students)
    ? b.students
        .filter((s: any) => s && s.id)
        .slice(0, 50)
        .map((s: any) => ({ id: String(s.id), name: String(s.name || s.id), className: s.className ? String(s.className) : null }))
    : [];
  const hasStudents = students.length > 0;
  const entityLabel = hasStudents
    ? (students.length === 1 ? `${students[0].name} (${students[0].id})` : `${students[0].name} +${students.length - 1} more`)
    : null;

  const base = {
    title: title.slice(0, 200),
    note: b.note ? String(b.note).trim().slice(0, 2000) : null,
    dueAt,
    createdById: me,
    entityType: hasStudents ? 'Student' : null,
    entityId: hasStudents ? students[0].id : null,
    entityLabel,
    students: hasStudents ? (students as any) : undefined,
    url: hasStudents ? '/admin/students' : null,
  };

  await prisma.reminder.createMany({
    data: assigneeIds.map((assignedToId) => ({ ...base, assignedToId })),
  });

  // Assigning work to someone else: notify them now (in-app + push), not just in the
  // next morning's digest. Best-effort — never fails the create.
  const notifyIds = assigneeIds.filter((id) => id !== me);
  if (notifyIds.length) {
    try {
      const creator = await prisma.user.findUnique({ where: { id: me }, select: { name: true } });
      const from = creator?.name || 'A colleague';
      const whenStr = dueAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const nTitle = `New task from ${from}`;
      const nBody = `${base.title} · due ${whenStr}`;
      await prisma.notification.createMany({
        data: notifyIds.map((userId) => ({ userId, type: 'REMINDER_ASSIGNED', title: nTitle, body: nBody, url: '/admin/reminders' })),
      });
      await sendPushToUsers(notifyIds, { title: nTitle, body: base.title, url: '/admin/reminders', tag: 'reminder-assigned' });
    } catch (e) {
      console.error('reminder assign notify', e);
    }
  }
  return NextResponse.json({ count: assigneeIds.length }, { status: 201 });
}
