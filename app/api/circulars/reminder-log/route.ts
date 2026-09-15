import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

// GET /api/circulars/reminder-log — recent fee-reminder sends with each number's
// WhatsApp delivery status (SENT / FAILED), grouped into batches. Newest first.
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, ['NOTICES_MANAGE', 'FEES_VIEW', 'FEES_VIEW_ALL'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const recent = await prisma.messageDelivery.findMany({
      distinct: ['batchId'], orderBy: { createdAt: 'desc' }, take: 40, select: { batchId: true },
    });
    const ids = recent.map((r) => r.batchId);
    if (ids.length === 0) return NextResponse.json({ batches: [] });

    const rows = await prisma.messageDelivery.findMany({
      where: { batchId: { in: ids } },
      orderBy: [{ createdAt: 'asc' }],
      select: { batchId: true, title: true, studentName: true, className: true, recipient: true, phone: true, status: true, error: true, createdAt: true },
    });

    const map = new Map<string, any>();
    for (const r of rows) {
      const b = map.get(r.batchId) || { batchId: r.batchId, title: r.title, at: r.createdAt, sent: 0, failed: 0, rows: [] as any[] };
      if (r.status === 'FAILED') b.failed++; else b.sent++;
      if (r.createdAt > b.at) b.at = r.createdAt;
      b.rows.push({ student: r.studentName, className: r.className, recipient: r.recipient, phone: r.phone, status: r.status, error: r.error });
      map.set(r.batchId, b);
    }
    // Preserve the recency order from `recent`.
    const batches = ids.map((id) => map.get(id)).filter(Boolean);
    return NextResponse.json({ batches });
  } catch (err) {
    console.error('reminder-log GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
