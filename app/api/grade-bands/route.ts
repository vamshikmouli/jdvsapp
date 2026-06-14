import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';

// GET /api/grade-bands — the configurable grade scale (high → low).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const bands = await prisma.gradeBand.findMany({ orderBy: [{ order: 'asc' }, { minPercent: 'desc' }] });
  return NextResponse.json(bands);
}

// PUT /api/grade-bands — replace the whole scale in one save.
// Body: { bands: [{ label, minPercent, maxPercent }] }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const raw = Array.isArray(b.bands) ? b.bands : [];
  const bands = raw
    .map((x: any, i: number) => ({
      label: String(x.label || '').trim(),
      minPercent: Math.round(Number(x.minPercent)),
      maxPercent: Math.round(Number(x.maxPercent)),
      order: i,
    }))
    .filter((x: any) => x.label && Number.isFinite(x.minPercent) && Number.isFinite(x.maxPercent));

  for (const x of bands) {
    if (x.minPercent < 0 || x.maxPercent > 100 || x.minPercent > x.maxPercent) {
      return NextResponse.json({ error: `Band "${x.label}" has an invalid range (${x.minPercent}–${x.maxPercent})` }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.gradeBand.deleteMany({}),
    prisma.gradeBand.createMany({ data: bands }),
  ]);
  return NextResponse.json({ ok: true, count: bands.length });
}
