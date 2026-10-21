import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

// Can this user touch this reminder? Its assignee, its creator, or an admin.
async function allowed(session: any, id: string): Promise<boolean> {
  const me = session?.user?.id as string | undefined;
  if (!me) return false;
  if (canAny(session, ['USERS_MANAGE', 'SETTINGS_MANAGE'])) return true;
  const r = await prisma.reminder.findUnique({ where: { id }, select: { assignedToId: true, createdById: true } });
  return !!r && (r.assignedToId === me || r.createdById === me);
}

// PATCH /api/reminders/[id] — edit, or action: 'done' | 'reopen' | 'dismiss' | 'snooze'(+dueAt)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
  } else {
    // Plain edit of fields.
    if (typeof b.title === 'string') data.title = b.title.trim().slice(0, 200);
    if ('note' in b) data.note = b.note ? String(b.note).trim().slice(0, 2000) : null;
    if (b.dueAt) { const d = new Date(b.dueAt); if (!isNaN(d.getTime())) { data.dueAt = d; data.lastNotifiedOn = null; } }
    if ('assignedToId' in b) data.assignedToId = b.assignedToId ? String(b.assignedToId) : me;
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
  }
  await prisma.reminder.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
}

// DELETE /api/reminders/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await allowed(session, params.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await prisma.reminder.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
