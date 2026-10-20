import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/reminders/student-search?q= — top matches to link a reminder to a student.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'STUDENTS_VIEW')) return NextResponse.json({ items: [] });
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  const students = await prisma.student.findMany({
    where: { status: 'ACTIVE', OR: [{ name: { contains: q, mode: 'insensitive' } }, { id: { contains: q, mode: 'insensitive' } }] },
    orderBy: { name: 'asc' },
    take: 10,
    select: { id: true, name: true, class: { select: { name: true } } },
  });
  return NextResponse.json({ items: students.map((s) => ({ id: s.id, name: s.name, className: s.class?.name || null })) });
}
