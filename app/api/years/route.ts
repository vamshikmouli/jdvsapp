import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
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

// POST /api/years —
//   { action: 'create', id, label } → create a new academic year (admin only)
//   { yearId }                      → choose the year for this browser session (cookie)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (body?.action === 'create') {
    if (!can(session, 'SETTINGS_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const id = String(body.id || '').trim();
    const label = String(body.label || id).trim();
    // Expect a session id like "2025-26" (4 digits, dash, 2 digits).
    if (!/^\d{4}-\d{2}$/.test(id)) {
      return NextResponse.json({ error: 'Use the format YYYY-YY, e.g. 2025-26.' }, { status: 400 });
    }
    const exists = await prisma.academicYear.findUnique({ where: { id } });
    if (exists) return NextResponse.json({ error: `Year ${id} already exists.` }, { status: 409 });
    // Blank year (no fee structure, not made active) — set fees under Fee setup.
    const year = await prisma.academicYear.create({ data: { id, label: label || id, isActive: false } });
    return NextResponse.json({ ok: true, year: { id: year.id, label: year.label } });
  }

  const { yearId } = body;
  if (!yearId) return NextResponse.json({ error: 'yearId required' }, { status: 400 });
  const year = await prisma.academicYear.findUnique({ where: { id: String(yearId) } });
  if (!year) return NextResponse.json({ error: 'Unknown year' }, { status: 400 });

  const res = NextResponse.json({ ok: true, currentId: year.id });
  res.cookies.set('yearId', year.id, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
