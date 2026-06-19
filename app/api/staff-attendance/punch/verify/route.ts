import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { rpID, rpOrigin, consumeChallenge } from '@/lib/staffAttendance/webauthn';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { evaluateGeofence } from '@/lib/staffAttendance/geofence';
import { recordPunch } from '@/lib/staffAttendance/service';

function fenceMessage(reason: string | undefined, distanceM: number | null, radiusM: number, accuracy: number | null | undefined): string {
  if (reason === 'NO_SCHOOL_LOCATION') return 'Attendance location is not configured yet. Ask the office.';
  if (reason === 'POOR_ACCURACY') {
    const a = accuracy != null ? ` (your GPS is accurate to ~${Math.round(accuracy)} m)` : '';
    return `Your GPS signal is too weak${a}. Move to an open area, make sure precise location is on, and try again.`;
  }
  // OUTSIDE_FENCE — show how far off we measured so the office can tell whether
  // the radius is just too tight or the saved school location is wrong.
  const d = distanceM != null ? `${Math.round(distanceM)} m` : 'an unknown distance';
  return `You must be at school to punch. You're about ${d} from the saved school location (allowed: ${radiusM} m). If you really are at school, ask the office to re-set the school location.`;
}

// POST /api/staff-attendance/punch/verify
// Verify the biometric assertion + geofence, then record the punch.
// Body: { assertion, lat, lng, accuracy }
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) {
      return NextResponse.json({ error: 'No staff profile linked to this account' }, { status: 400 });
    }
    if ((session.user as any)?.roleKey === 'admin') {
      return NextResponse.json({ error: 'Attendance is not tracked for administrators.' }, { status: 403 });
    }

    const cfg = await loadStaffAttConfig();
    if (!cfg.enabled) {
      return NextResponse.json({ error: 'Staff attendance is turned off.' }, { status: 409 });
    }

    const { assertion, lat, lng, accuracy } = await req.json();
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

    // 2) Verify the biometric assertion against the bound credential.
    const cred = await prisma.staffCredential.findUnique({
      where: { credentialId: assertion?.id },
    });
    if (!cred || cred.staffId !== staffId || !cred.active) {
      return NextResponse.json({ error: 'This device is not registered for you.' }, { status: 403 });
    }

    const expectedChallenge = await consumeChallenge(staffId, 'authenticate');
    if (!expectedChallenge) {
      return NextResponse.json({ error: 'Punch expired, please try again.' }, { status: 400 });
    }

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: rpOrigin(),
      expectedRPID: rpID(),
      requireUserVerification: true,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: Number(cred.counter),
        transports: cred.transports ? (JSON.parse(cred.transports) as any) : undefined,
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: 'Biometric check failed.' }, { status: 403 });
    }

    // Update the signature counter (replay protection).
    await prisma.staffCredential.update({
      where: { id: cred.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    // 3) Record the punch (auto IN/OUT) + recompute the day.
    const result = await recordPunch({
      staffId,
      source: 'BIOMETRIC',
      lat,
      lng,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      distanceM: fence.distanceM,
      withinFence: true,
      credentialId: cred.credentialId,
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
