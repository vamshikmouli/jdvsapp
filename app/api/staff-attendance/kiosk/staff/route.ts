import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, canAny, AuthError, authErrorResponse } from '@/lib/rbac/roles';

// GET /api/staff-attendance/kiosk/staff
// Minimal staff list for the kiosk: active, non-admin staff who have a PIN set.
// Gated by the dedicated kiosk permission (or full manage) so a low-privilege
// kiosk-device account can run it without board/view access.
export async function GET() {
  try {
    const session = await requireSession();
    if (!canAny(session, ['STAFF_ATTENDANCE_KIOSK', 'STAFF_ATTENDANCE_MANAGE'])) {
      throw new AuthError('Forbidden', 403);
    }

    const staff = await prisma.staff.findMany({
      where: {
        archived: false,
        pinHash: { not: null },
        NOT: { user: { role: { key: 'admin' } } },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, designation: true },
    });

    return NextResponse.json(staff.map((s) => ({ staffId: s.id, name: s.name, designation: s.designation, hasPin: true })));
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
