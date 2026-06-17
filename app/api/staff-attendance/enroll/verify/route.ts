import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { rpID, rpOrigin, consumeChallenge } from '@/lib/staffAttendance/webauthn';
import { parseUA } from '@/lib/ua';

// POST /api/staff-attendance/enroll/verify
// Finish registration: verify the attestation and store the bound credential.
// Device binding: a new credential deactivates any previous one for this staff.
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) {
      return NextResponse.json({ error: 'No staff profile linked to this account' }, { status: 400 });
    }

    const body = await req.json();
    const expectedChallenge = await consumeChallenge(staffId, 'register');
    if (!expectedChallenge) {
      return NextResponse.json({ error: 'Enrollment expired, please try again' }, { status: 400 });
    }

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: rpOrigin(),
      expectedRPID: rpID(),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Could not verify this device' }, { status: 400 });
    }

    const { credential } = verification.registrationInfo;
    const ua = req.headers.get('user-agent') || undefined;

    await prisma.$transaction([
      // Enforce single bound device.
      prisma.staffCredential.updateMany({
        where: { staffId, active: true },
        data: { active: false },
      }),
      prisma.staffCredential.create({
        data: {
          staffId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ? JSON.stringify(credential.transports) : null,
          deviceName: parseUA(ua).label,
          active: true,
        },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
