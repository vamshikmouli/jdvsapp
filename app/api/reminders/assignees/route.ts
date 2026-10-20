import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/reminders/assignees — staff logins a reminder can be assigned to.
// Any signed-in staff may read this (needed to pick who follows up). Parents excluded.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { key: { not: 'parent' } } },
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, role: { select: { name: true } } },
  });
  return NextResponse.json({ items: users.map((u) => ({ id: u.id, name: u.name, role: u.role?.name || '' })) });
}
