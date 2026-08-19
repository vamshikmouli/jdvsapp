import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { getActiveYear } from '@/lib/services/fees';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

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

// PUT /api/years — create a new academic year (admin only). Body: { id, label? }.
// Created inactive; use PATCH to make it the current year.
export async function PUT(req: NextRequest) {
  try {
    await requirePermission('SETTINGS_MANAGE');
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    const label = String(body.label || id).trim();
    if (!/^\d{4}-\d{2}$/.test(id)) return NextResponse.json({ error: 'Year must look like 2027-28.' }, { status: 400 });
    const existing = await prisma.academicYear.findUnique({ where: { id }, select: { id: true } });
    if (existing) return NextResponse.json({ error: `${id} already exists.` }, { status: 409 });
    await prisma.academicYear.create({ data: { id, label } });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// PATCH /api/years — set the school-wide current (active) year (admin only).
// Body: { yearId }. Exactly one year stays active.
export async function PATCH(req: NextRequest) {
  try {
    await requirePermission('SETTINGS_MANAGE');
    const { yearId } = await req.json().catch(() => ({}));
    if (!yearId) return NextResponse.json({ error: 'yearId required' }, { status: 400 });
    const year = await prisma.academicYear.findUnique({ where: { id: String(yearId) }, select: { id: true } });
    if (!year) return NextResponse.json({ error: 'Unknown year' }, { status: 400 });
    await prisma.$transaction([
      prisma.academicYear.updateMany({ where: { isActive: true, NOT: { id: year.id } }, data: { isActive: false } }),
      prisma.academicYear.update({ where: { id: year.id }, data: { isActive: true } }),
    ]);
    return NextResponse.json({ ok: true, activeId: year.id });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
