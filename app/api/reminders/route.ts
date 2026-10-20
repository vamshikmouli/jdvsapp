import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { listReminders, dueCount } from '@/lib/services/reminders';

export const dynamic = 'force-dynamic';

// GET /api/reminders?scope=mine|all&status=open|done — list; also returns `due` count.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  let scope = (sp.get('scope') as 'mine' | 'all') || 'mine';
  if (scope === 'all' && !canAny(session!, ['USERS_MANAGE', 'SETTINGS_MANAGE'])) scope = 'mine';
  const [items, due] = await Promise.all([
    listReminders(userId, { scope, status: sp.get('status') || undefined }),
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
  const r = await prisma.reminder.create({
    data: {
      title: title.slice(0, 200),
      note: b.note ? String(b.note).trim().slice(0, 2000) : null,
      dueAt,
      createdById: me,
      assignedToId: b.assignedToId ? String(b.assignedToId) : me,
      entityType: b.entityType ? String(b.entityType) : null,
      entityId: b.entityId ? String(b.entityId) : null,
      entityLabel: b.entityLabel ? String(b.entityLabel).slice(0, 160) : null,
      url: b.url ? String(b.url).slice(0, 400) : null,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: r.id }, { status: 201 });
}
