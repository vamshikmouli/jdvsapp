import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/staff/[id]/activity — this staff member's change history (newest first).
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'STAFF_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await prisma.activityLog.findMany({
    where: { entityType: 'Staff', entityId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, action: true, summary: true, userName: true, meta: true, createdAt: true },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id, action: r.action, summary: r.summary, user: r.userName,
      changed: (r.meta as any)?.changed || null,
      at: r.createdAt.toISOString(),
    })),
  });
}
