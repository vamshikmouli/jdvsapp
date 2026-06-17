import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { verifyPassword } from '@/lib/auth/password';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { recordPunch } from '@/lib/staffAttendance/service';

// POST /api/staff-attendance/kiosk/punch
// Shared on-campus kiosk: a staff member without a phone punches with their
// staff ID + personal PIN. The kiosk page is hosted by a signed-in admin
// (STAFF_ATTENDANCE_MANAGE), so the device is trusted to be on campus and the
// geofence is treated as satisfied.
// Body: { staffId, pin }
export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');

    const cfg = await loadStaffAttConfig();
    if (!cfg.enabled) {
      return NextResponse.json({ error: 'Staff attendance is turned off.' }, { status: 409 });
    }

    const { staffId, pin } = await req.json();
    if (!staffId || !pin) {
      return NextResponse.json({ error: 'Staff and PIN are required.' }, { status: 400 });
    }

    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, name: true, pinHash: true, archived: true, pinAttempts: true, pinLockedUntil: true },
    });
    if (!staff || staff.archived || !staff.pinHash) {
      return NextResponse.json({ error: 'PIN not set up for this staff member.' }, { status: 403 });
    }

    // Lockout after repeated wrong PINs.
    const MAX_ATTEMPTS = 5;
    const LOCK_MINS = 10;
    if (staff.pinLockedUntil && staff.pinLockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((staff.pinLockedUntil.getTime() - Date.now()) / 60000);
      return NextResponse.json({ error: `Too many wrong PINs. Try again in ${mins} min.` }, { status: 429 });
    }

    const ok = await verifyPassword(String(pin), staff.pinHash);
    if (!ok) {
      const attempts = staff.pinAttempts + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await prisma.staff.update({
        where: { id: staff.id },
        data: {
          pinAttempts: lock ? 0 : attempts,
          pinLockedUntil: lock ? new Date(Date.now() + LOCK_MINS * 60000) : null,
        },
      });
      return NextResponse.json(
        { error: lock ? `Too many wrong PINs. Locked for ${LOCK_MINS} min.` : 'Incorrect PIN.' },
        { status: lock ? 429 : 403 }
      );
    }

    // Success — clear any failed-attempt state.
    if (staff.pinAttempts || staff.pinLockedUntil) {
      await prisma.staff.update({ where: { id: staff.id }, data: { pinAttempts: 0, pinLockedUntil: null } });
    }

    const result = await recordPunch({
      staffId: staff.id,
      source: 'KIOSK',
      withinFence: true,
      deviceInfo: 'Kiosk',
    });

    return NextResponse.json({
      ok: true,
      staffName: staff.name,
      type: result.type,
      at: result.punch.at,
      day: result.day,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
