import { prisma } from '@/lib/db';

// Central audit trail. Call after a successful mutation to record who did what.
// Best-effort: never throws into the caller.
export type ActivityCategory = 'FEES' | 'STUDENTS' | 'STAFF' | 'PAYROLL' | 'ROLES' | 'CONFIG' | 'MARKS' | 'OTHER';

type SessionLike = { user?: { id?: string; name?: string | null; email?: string | null; roleKey?: string | null } } | null | undefined;
type ReqLike = { headers: { get(name: string): string | null } } | undefined;

function ipFrom(req?: ReqLike): string | null {
  if (!req) return null;
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : null) || req.headers.get('x-real-ip') || null;
}

export async function logActivity(session: SessionLike, entry: {
  category: ActivityCategory;
  action: string;
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: any;
  req?: ReqLike;
}): Promise<void> {
  try {
    const u = session?.user || {};
    await prisma.activityLog.create({
      data: {
        userId: (u as any).id || null,
        userName: u.name || u.email || 'Unknown',
        roleKey: (u as any).roleKey || null,
        category: entry.category,
        action: entry.action,
        summary: entry.summary,
        entityType: entry.entityType || null,
        entityId: entry.entityId || null,
        meta: entry.meta ?? undefined,
        ip: ipFrom(entry.req),
      },
    });
  } catch (e) {
    console.error('[activity] log failed', e);
  }
}
