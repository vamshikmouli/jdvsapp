import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, studentsForFeeReminder } from '@/lib/services/fees';
import { sendPushToUsers, parentUserIdsForAudience } from '@/lib/push';
import type { CircularAudience } from '@prisma/client';

// GET /api/circulars — admin list of all circulars/reminders with recipient counts.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const showArchived = new URL(req.url).searchParams.get('archived') === '1';
    const items = await prisma.circular.findMany({ where: { archived: showArchived }, orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }], take: 200 });
    const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true } });
    const nameOf = Object.fromEntries(classes.map((c) => [c.id, c.name]));
    return NextResponse.json({
      items: items.map((c) => ({
        id: c.id, title: c.title, body: c.body, category: c.category, kind: c.kind,
        audience: c.audience, pinned: c.pinned, archived: c.archived, publishedAt: c.publishedAt.toISOString(),
        classNames: c.classIds.map((id) => nameOf[id] || id),
        recipients: c.audience === 'SCHOOL' ? 'Whole school' : c.audience === 'CLASS' ? `${c.classIds.length} class(es)` : `${c.studentIds.length} student(s)`,
      })),
    });
  } catch (err) {
    console.error('circulars GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

// POST /api/circulars — create a circular or send a fee reminder.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const b = await req.json();
    const title = String(b.title || '').trim();
    const body = String(b.body || '').trim();
    if (!title || !body) return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });

    const kind = b.kind === 'FEE_REMINDER' ? 'FEE_REMINDER' : 'CIRCULAR';
    let audience: CircularAudience = 'SCHOOL';
    let classIds: string[] = [];
    let studentIds: string[] = [];

    if (kind === 'FEE_REMINDER') {
      const scope = String(b.feeScope || 'school'); // school | students | all | overdue | above
      if (scope === 'school') {
        audience = 'SCHOOL';
      } else if (scope === 'students') {
        // explicit student list (e.g. notifying one student's parent with their balance)
        studentIds = Array.isArray(b.studentIds) ? b.studentIds.map(String) : [];
        if (studentIds.length === 0) return NextResponse.json({ error: 'Pick at least one student' }, { status: 400 });
        audience = 'STUDENT';
      } else {
        const year = await getActiveYear();
        const { studentIds: ids } = await studentsForFeeReminder(year.id, {
          mode: scope === 'above' ? 'above' : scope === 'overdue' ? 'overdue' : 'all',
          minBalance: Number(b.minBalance) || 0,
          classId: b.classId || undefined,
        });
        if (ids.length === 0) return NextResponse.json({ error: 'No students match that filter — nothing to send' }, { status: 400 });
        audience = 'STUDENT';
        studentIds = ids;
      }
    } else {
      audience = b.audience === 'CLASS' ? 'CLASS' : b.audience === 'STUDENT' ? 'STUDENT' : 'SCHOOL';
      if (audience === 'CLASS') {
        classIds = Array.isArray(b.classIds) ? b.classIds.map(String) : [];
        if (classIds.length === 0) return NextResponse.json({ error: 'Pick at least one class' }, { status: 400 });
      } else if (audience === 'STUDENT') {
        studentIds = Array.isArray(b.studentIds) ? b.studentIds.map(String) : [];
        if (studentIds.length === 0) return NextResponse.json({ error: 'Pick at least one student' }, { status: 400 });
      }
    }

    const created = await prisma.circular.create({
      data: {
        title, body, kind, audience, classIds, studentIds,
        category: kind === 'FEE_REMINDER' ? 'Fees' : (b.category || null),
        pinned: !!b.pinned,
        createdById: (session.user as any)?.id || null,
      },
      select: { id: true, audience: true },
    });

    // Push the notice to parents' phones (best-effort — never blocks success).
    let pushed = { sent: 0, failed: 0 };
    try {
      const recipients = await parentUserIdsForAudience(audience, { classIds, studentIds });
      pushed = await sendPushToUsers(recipients, {
        title: kind === 'FEE_REMINDER' ? `Fee reminder: ${title}` : title,
        body: body.length > 160 ? body.slice(0, 157) + '…' : body,
        url: '/parent',
        tag: `circular-${created.id}`,
      });
    } catch (e) {
      console.error('circular push', e);
    }

    const reach = audience === 'SCHOOL' ? 'whole school' : audience === 'CLASS' ? `${classIds.length} class(es)` : `${studentIds.length} student(s)`;
    return NextResponse.json({ ...created, reach, pushed }, { status: 201 });
  } catch (err) {
    console.error('circulars POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send' }, { status: 400 });
  }
}

// PATCH /api/circulars — edit a circular's content (recipients unchanged).
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json();
    if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const title = String(b.title || '').trim();
    const body = String(b.body || '').trim();
    if (!title || !body) return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });
    await prisma.circular.update({
      where: { id: b.id },
      data: { title, body, category: b.category ?? undefined, pinned: typeof b.pinned === 'boolean' ? b.pinned : undefined },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('circulars PATCH', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 400 });
  }
}

// DELETE /api/circulars?id=&restore=1 — soft archive (hide from parents) / restore.
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const sp = new URL(req.url).searchParams;
    const id = sp.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const restore = sp.get('restore') === '1';
    await prisma.circular.update({ where: { id }, data: { archived: !restore } });
    return NextResponse.json({ ok: true, archived: !restore });
  } catch (err) {
    console.error('circulars DELETE', err);
    return NextResponse.json({ error: 'Failed to archive' }, { status: 400 });
  }
}
