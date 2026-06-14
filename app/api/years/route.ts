import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { getActiveYear } from '@/lib/services/fees';

// GET /api/years — list academic years + the one currently in effect for this session.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const years = await prisma.academicYear.findMany({
    orderBy: { id: 'desc' },
    select: { id: true, label: true, isActive: true, _count: { select: { enrollments: true } } },
  });
  const current = await getActiveYear();
  return NextResponse.json({
    years: years.map((y) => ({ id: y.id, label: y.label, isActive: y.isActive, enrollmentCount: y._count.enrollments })),
    currentId: current.id,
  });
}

// POST /api/years — choose the academic year for this browser session (sets a cookie).
// Body: { yearId }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { yearId } = await req.json().catch(() => ({}));
  if (!yearId) return NextResponse.json({ error: 'yearId required' }, { status: 400 });
  const year = await prisma.academicYear.findUnique({ where: { id: String(yearId) } });
  if (!year) return NextResponse.json({ error: 'Unknown year' }, { status: 400 });

  const res = NextResponse.json({ ok: true, currentId: year.id });
  res.cookies.set('yearId', year.id, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
