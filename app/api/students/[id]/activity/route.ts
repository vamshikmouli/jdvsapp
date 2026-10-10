import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/students/[id]/activity — this student's change history (newest first).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'STUDENTS_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await prisma.activityLog.findMany({
    where: { entityType: 'Student', entityId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, action: true, summary: true, userName: true, meta: true, createdAt: true },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id, action: r.action, summary: r.summary, user: r.userName,
      changed: (r.meta as any)?.changed || null, verified: (r.meta as any)?.verified ?? null,
      at: r.createdAt.toISOString(),
    })),
  });
}
