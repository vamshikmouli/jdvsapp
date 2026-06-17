import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

// GET /api/staff-attendance/[staffId]?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per-staff attendance history (day roll-ups) + raw punches in the range.
export async function GET(req: NextRequest, { params }: { params: { staffId: string } }) {
  try {
    await requirePermission('STAFF_ATTENDANCE_VIEW');
    const { staffId } = params;

    const sp = new URL(req.url).searchParams;
    const to = sp.get('to') ? new Date(`${sp.get('to')}T00:00:00Z`) : new Date();
    const from = sp.get('from')
      ? new Date(`${sp.get('from')}T00:00:00Z`)
      : new Date(to.getTime() - 30 * 24 * 3600_000);

    const [staff, days, punches] = await Promise.all([
      prisma.staff.findUnique({
        where: { id: staffId },
        select: {
          id: true,
          name: true,
          designation: true,
          pinHash: true,
          attCredentials: { where: { active: true }, select: { deviceName: true, lastUsedAt: true } },
        },
      }),
      prisma.staffAttendanceDay.findMany({
        where: { staffId, date: { gte: from, lte: to } },
        orderBy: { date: 'desc' },
      }),
      prisma.staffPunch.findMany({
        where: { staffId, at: { gte: from } },
        orderBy: { at: 'desc' },
        take: 200,
      }),
    ]);

    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });

    return NextResponse.json({
      staff: {
        id: staff.id,
        name: staff.name,
        designation: staff.designation,
        hasPin: !!staff.pinHash,
        device: staff.attCredentials[0] ?? null,
      },
      days,
      punches,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
