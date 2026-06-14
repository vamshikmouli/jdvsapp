import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';

// PUT /api/subjects/reorder — body { ids: string[] } sets order = position.
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String) : [];
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  await prisma.$transaction(ids.map((id, i) => prisma.subject.update({ where: { id }, data: { order: i + 1 } })));
  return NextResponse.json({ ok: true });
}
