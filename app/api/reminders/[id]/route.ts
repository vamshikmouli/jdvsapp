import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

// Can this user touch this reminder? Its assignee, its creator, or an admin.
async function allowed(session: any, id: string): Promise<boolean> {
  const me = session?.user?.id as string | undefined;
  if (!me) return false;
  if (canAny(session, ['USERS_MANAGE', 'SETTINGS_MANAGE'])) return true;
  const r = await prisma.reminder.findUnique({ where: { id }, select: { assignedToId: true, createdById: true } });
  return !!r && (r.assignedToId === me || r.createdById === me);
}

// Parse the editable shared fields (title / note / dueAt / linked students) from a body.
function buildSharedEdit(b: any): Record<string, any> {
  const data: Record<string, any> = {};
  if (typeof b.title === 'string') data.title = b.title.trim().slice(0, 200);
  if ('note' in b) data.note = b.note ? String(b.note).trim().slice(0, 2000) : null;
  if (b.dueAt) { const d = new Date(b.dueAt); if (!isNaN(d.getTime())) { data.dueAt = d; data.lastNotifiedOn = null; } }
  if ('students' in b) {
    const students = (Array.isArray(b.students) ? b.students : [])
      .filter((s: any) => s && s.id)
      .slice(0, 50)
      .map((s: any) => ({ id: String(s.id), name: String(s.name || s.id), className: s.className ? String(s.className) : null }));
    if (students.length) {
      data.entityType = 'Student';
      data.entityId = students[0].id;
      data.entityLabel = students.length === 1 ? `${students[0].name} (${students[0].id})` : `${students[0].name} +${students.length - 1} more`;
      data.students = students;
      data.url = '/admin/students';
    } else {
      data.entityType = null; data.entityId = null; data.entityLabel = null; data.url = null;
      data.students = Prisma.DbNull;
    }
  }
  return data;
}

// GET /api/reminders/[id] — the reminder plus ALL its group assignees (for the edit form).
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await allowed(session, params.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const r = await prisma.reminder.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, note: true, dueAt: true, students: true, groupId: true, assignedToId: true },
  });
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const siblings = r.groupId
    ? await prisma.reminder.findMany({ where: { groupId: r.groupId }, select: { assignedToId: true } })
    : [{ assignedToId: r.assignedToId }];
  const ids = Array.from(new Set(siblings.map((s) => s.assignedToId).filter(Boolean))) as string[];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: { select: { name: true } } } })
    : [];
  return NextResponse.json({
    id: r.id, title: r.title, note: r.note, dueAt: r.dueAt, students: r.students ?? [],
    assignees: users.map((u) => ({ id: u.id, name: u.name, role: u.role?.name || '' })),
  });
}

// PATCH /api/reminders/[id] — edit, or action: 'done' | 'reopen' | 'dismiss' | 'snooze'(+dueAt)
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  const me = (session?.user as any)?.id as string | undefined;
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await allowed(session, params.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const data: any = {};
  if (b.action === 'done') { data.status = 'DONE'; data.completedAt = new Date(); data.completedById = me; }
  else if (b.action === 'dismiss') { data.status = 'DISMISSED'; data.completedAt = new Date(); data.completedById = me; }
  else if (b.action === 'reopen') { data.status = 'OPEN'; data.completedAt = null; data.completedById = null; }
  else if (b.action === 'snooze') {
    const d = b.dueAt ? new Date(b.dueAt) : null;
    if (!d || isNaN(d.getTime())) return NextResponse.json({ error: 'A valid date is required' }, { status: 400 });
    data.dueAt = d; data.status = 'OPEN'; data.lastNotifiedOn = null;
  } else if (Array.isArray(b.assignees)) {
    // Group edit: one reminder shared by several staff — a copy per person, each
    // with its own done/snooze. Propagate shared-field edits to every copy and
    // add / remove copies as the assignee list changes.
    const shared = buildSharedEdit(b);
    const desired = Array.from(new Set((b.assignees as any[]).map((x) => String(x)).filter(Boolean)));
    const effective = desired.length ? desired : [me]; // never orphan a reminder

    const target = await prisma.reminder.findUnique({
      where: { id: params.id },
      select: {
        id: true, groupId: true, createdById: true, title: true, note: true, dueAt: true,
        entityType: true, entityId: true, entityLabel: true, students: true, url: true,
      },
    });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let groupId = target.groupId;
    if (!groupId) { groupId = randomUUID(); await prisma.reminder.update({ where: { id: target.id }, data: { groupId } }); }

    const siblings = await prisma.reminder.findMany({ where: { groupId }, select: { id: true, assignedToId: true } });
    const haveIds = new Set(siblings.map((s) => s.assignedToId).filter(Boolean) as string[]);
    const keep = siblings.filter((s) => s.assignedToId && effective.includes(s.assignedToId));
    const remove = siblings.filter((s) => !s.assignedToId || !effective.includes(s.assignedToId));
    const addIds = effective.filter((id) => !haveIds.has(id));

    // Push shared-field changes to the copies we're keeping.
    if (keep.length && Object.keys(shared).length) {
      await prisma.reminder.updateMany({ where: { id: { in: keep.map((s) => s.id) } }, data: shared });
    }
    // Drop copies for de-selected assignees.
    if (remove.length) {
      await prisma.reminder.deleteMany({ where: { id: { in: remove.map((s) => s.id) } } });
    }
    // Create copies for newly-added assignees (edited values over the target's).
    if (addIds.length) {
      const editedStudents = 'students' in shared;
      const baseCopy: any = {
        title: shared.title ?? target.title,
        note: 'note' in shared ? shared.note : target.note,
        dueAt: shared.dueAt ?? target.dueAt,
        createdById: target.createdById ?? me,
        groupId,
        status: 'OPEN',
        entityType: editedStudents ? (shared.entityType ?? null) : target.entityType,
        entityId: editedStudents ? (shared.entityId ?? null) : target.entityId,
        entityLabel: editedStudents ? (shared.entityLabel ?? null) : target.entityLabel,
        url: editedStudents ? (shared.url ?? null) : target.url,
      };
      const studentsVal = editedStudents
        ? (shared.students === Prisma.DbNull ? undefined : shared.students)
        : (target.students ?? undefined);
      if (studentsVal !== undefined) baseCopy.students = studentsVal;
      await prisma.reminder.createMany({ data: addIds.map((assignedToId) => ({ ...baseCopy, assignedToId })) });
    }
    return NextResponse.json({ ok: true });
  } else {
    // Plain single edit (no assignee change).
    Object.assign(data, buildSharedEdit(b));
    if ('assignedToId' in b) data.assignedToId = b.assignedToId ? String(b.assignedToId) : me;
  }
  await prisma.reminder.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
}

// DELETE /api/reminders/[id]
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await allowed(session, params.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await prisma.reminder.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
