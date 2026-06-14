import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'CLASSES_MANAGE')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json();
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.room !== undefined) data.room = body.room || null;
    if (body.group !== undefined) data.group = body.group;

    // Optional: set the class teachers (replace the set)
    if (Array.isArray(body.teacherIds)) {
      data.teachers = { set: body.teacherIds.map((id: string) => ({ id })) };
    }

    const updated = await prisma.schoolClass.update({
      where: { id: params.id },
      data,
      include: {
        teachers: { select: { id: true, name: true } },
        sections: { select: { id: true, name: true } },
        _count: { select: { students: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating class:', error);
    return NextResponse.json({ error: 'Failed to update class' }, { status: 500 });
  }
}

// "Delete" is a soft archive: hide the class everywhere (pickers, lists) without
// losing it or its students/history. Body { restore: true } reactivates.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'CLASSES_MANAGE')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const restore = !!((await req.json().catch(() => ({})))?.restore);
    await prisma.schoolClass.update({ where: { id: params.id }, data: { archived: !restore } });
    return NextResponse.json({ ok: true, archived: !restore });
  } catch (error) {
    console.error('Error archiving class:', error);
    return NextResponse.json({ error: 'Failed to archive class' }, { status: 500 });
  }
}
