import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET            → JSON: recent slow queries + a grouped summary (for the in-app view).
// GET ?format=csv → downloads the full slow-query log as a CSV file.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'SETTINGS_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const format = new URL(req.url).searchParams.get('format');

  if (format === 'csv') {
    const rows = await prisma.slowQueryLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20000 });
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = 'createdAt,model,operation,durationMs,argKeys\n'
      + rows.map((r) => [r.createdAt.toISOString(), r.model ?? '', r.operation, r.durationMs, r.argKeys ?? ''].map(esc).join(',')).join('\n') + '\n';
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="slow-queries-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const [rows, grouped, total] = await Promise.all([
    prisma.slowQueryLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.slowQueryLog.groupBy({ by: ['model', 'operation'], _count: { _all: true }, _avg: { durationMs: true }, _max: { durationMs: true } }),
    prisma.slowQueryLog.count(),
  ]);
  const summary = grouped
    .map((g) => ({ key: `${g.model ?? 'raw'}.${g.operation}`, count: g._count._all, avgMs: Math.round(g._avg.durationMs || 0), maxMs: g._max.durationMs || 0 }))
    .sort((a, b) => b.maxMs - a.maxMs);
  return NextResponse.json({
    total,
    thresholdMs: Number(process.env.SLOW_QUERY_MS ?? 500),
    summary,
    rows: rows.map((r) => ({ id: r.id, model: r.model, operation: r.operation, durationMs: r.durationMs, argKeys: r.argKeys, at: r.createdAt.toISOString() })),
  });
}

// DELETE → clear the whole slow-query log.
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'SETTINGS_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await prisma.slowQueryLog.deleteMany({});
  return NextResponse.json({ ok: true });
}
