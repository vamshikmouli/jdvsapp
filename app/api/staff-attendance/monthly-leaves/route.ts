import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

// GET /api/staff-attendance/monthly-leaves?month=YYYY-MM
// Per-staff leave-day count for a month (leaveType-tagged days: approved leaves
// + admin Leave/Absent marks; half-day = 0.5). Sorted most-leaves-first so the
// dashboard can show who took the most and who took none.
export async function GET(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_VIEW');

    const monthParam = new URL(req.url).searchParams.get('month');
    const now = new Date();
    const month = /^\d{4}-\d{2}$/.test(monthParam || '')
      ? (monthParam as string)
      : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1) - 24 * 3600_000);

    const [staff, days] = await Promise.all([
      prisma.staff.findMany({
        where: { archived: false, NOT: { user: { role: { key: 'admin' } } } },
        select: { id: true, name: true, designation: true },
        orderBy: { name: 'asc' },
      }),
      prisma.staffAttendanceDay.findMany({
        where: { date: { gte: from, lte: to }, leaveType: { not: null } },
        select: { staffId: true, status: true, leaveType: true },
      }),
    ]);

    const acc = new Map<string, { leaveDays: number; byType: Record<string, number> }>();
    for (const d of days) {
      const w = d.status === 'HALF_DAY' ? 0.5 : 1;
      const cur = acc.get(d.staffId) ?? { leaveDays: 0, byType: {} };
      cur.leaveDays += w;
      cur.byType[d.leaveType!] = (cur.byType[d.leaveType!] ?? 0) + w;
      acc.set(d.staffId, cur);
    }

    const rows = staff
      .map((s) => ({
        staffId: s.id,
        name: s.name,
        designation: s.designation,
        leaveDays: acc.get(s.id)?.leaveDays ?? 0,
        byType: acc.get(s.id)?.byType ?? {},
      }))
      .sort((a, b) => b.leaveDays - a.leaveDays || a.name.localeCompare(b.name));

    return NextResponse.json({ month, rows });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
