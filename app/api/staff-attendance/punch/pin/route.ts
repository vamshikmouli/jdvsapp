import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { verifyPassword } from '@/lib/auth/password';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { evaluateGeofence } from '@/lib/staffAttendance/geofence';
import { recordPunch } from '@/lib/staffAttendance/service';

function fenceMessage(reason: string | undefined, distanceM: number | null, radiusM: number, accuracy: number | null | undefined): string {
  if (reason === 'NO_SCHOOL_LOCATION') return 'Attendance location is not configured yet. Ask the office.';
  if (reason === 'POOR_ACCURACY') {
    const a = accuracy != null ? ` (your GPS is accurate to ~${Math.round(accuracy)} m)` : '';
    return `Your GPS signal is too weak${a}. Move to an open area, make sure precise location is on, and try again.`;
  }
  const d = distanceM != null ? `${Math.round(distanceM)} m` : 'an unknown distance';
  return `You must be at school to punch. You're about ${d} from the saved school location (allowed: ${radiusM} m). If you really are at school, ask the office to re-set the school location.`;
}

// POST /api/staff-attendance/punch/pin
// Self-service punch from the staff member's OWN phone using their PIN, for
// staff whose phone can't enroll a biometric (e.g. older Android). Unlike the
// admin-hosted kiosk, the device is NOT trusted, so the GPS geofence is enforced
// exactly like the biometric path.
// Body: { pin, lat, lng, accuracy }
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) {
      return NextResponse.json({ error: 'No staff profile linked to this account' }, { status: 400 });
    }

    const cfg = await loadStaffAttConfig();
    if (!cfg.enabled) {
      return NextResponse.json({ error: 'Staff attendance is turned off.' }, { status: 409 });
    }

    const { pin, lat, lng, accuracy } = await req.json();
    if (!pin) {
      return NextResponse.json({ error: 'PIN is required.' }, { status: 400 });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'Location is required to punch.' }, { status: 400 });
    }

    // 1) Geofence first — cheap and the most common rejection.
    const fence = evaluateGeofence({ lat, lng }, accuracy, cfg.geofence);
    if (!fence.ok) {
      return NextResponse.json(
        {
          error: fenceMessage(fence.reason, fence.distanceM, cfg.geofence.geofenceRadiusM, accuracy),
          reason: fence.reason,
          distanceM: fence.distanceM,
        },
        { status: 403 }
      );
    }

    // 2) Verify the PIN against the staff member's stored hash.
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, name: true, pinHash: true, archived: true, pinAttempts: true, pinLockedUntil: true },
    });
    if (!staff || staff.archived || !staff.pinHash) {
      return NextResponse.json(
        { error: 'No PIN set up for you yet. Ask the office to set your attendance PIN.' },
        { status: 403 }
      );
    }

    // Lockout after repeated wrong PINs (mirrors the kiosk path).
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

    // 3) Record the punch (auto IN/OUT) + recompute the day.
    const result = await recordPunch({
      staffId,
      source: 'PIN',
      lat,
      lng,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      distanceM: fence.distanceM,
      withinFence: true,
      deviceInfo: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      ok: true,
      type: result.type,
      day: result.day,
      at: result.punch.at,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
