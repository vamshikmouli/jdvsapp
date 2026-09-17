import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

// GET /api/circulars/reminder-log — every WhatsApp message the app has sent,
// grouped into batches and then into separate lists by kind (fee reminders, fee
// receipts, staff attendance, login codes, …). Each row carries its live delivery
// status (SENT / DELIVERED / READ / FAILED). Newest first.
const MAX_BATCHES_PER_KIND = 20;

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, ['NOTICES_MANAGE', 'FEES_VIEW', 'FEES_VIEW_ALL'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Pull a generous window of recent deliveries and group client-side; cheap and
    // avoids N queries per kind. 600 rows comfortably covers recent activity.
    const rows = await prisma.messageDelivery.findMany({
      orderBy: { createdAt: 'desc' }, take: 600,
      select: { batchId: true, kind: true, title: true, studentName: true, className: true, recipient: true, phone: true, status: true, error: true, createdAt: true },
    });

    // Build batches (preserving newest-first order of first appearance).
    const map = new Map<string, any>();
    for (const r of rows) {
      const b = map.get(r.batchId) || { batchId: r.batchId, kind: r.kind || 'FEE_REMINDER', title: r.title, at: r.createdAt, sent: 0, failed: 0, rows: [] as any[] };
      if (r.status === 'FAILED') b.failed++; else b.sent++;
      if (r.createdAt > b.at) b.at = r.createdAt;
      // rows arrive newest-first; unshift so each batch reads oldest-first internally.
      b.rows.unshift({ student: r.studentName, className: r.className, recipient: r.recipient, phone: r.phone, status: r.status, error: r.error });
      map.set(r.batchId, b);
    }
    const batches = [...map.values()].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    // Group batches into per-kind lists, capping each so one high-volume kind
    // (e.g. login codes) can't crowd the others out.
    const groupMap = new Map<string, any[]>();
    for (const b of batches) {
      const list = groupMap.get(b.kind) || [];
      if (list.length < MAX_BATCHES_PER_KIND) { list.push(b); groupMap.set(b.kind, list); }
    }
    const groups = [...groupMap.entries()].map(([kind, list]) => ({
      kind,
      total: list.reduce((t, x) => t + x.sent + x.failed, 0),
      batches: list,
    }));

    // `batches` kept for backward-compat (flat, newest-first).
    return NextResponse.json({ groups, batches });
  } catch (err) {
    console.error('reminder-log GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
