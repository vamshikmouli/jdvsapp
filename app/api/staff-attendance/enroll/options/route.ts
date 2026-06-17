import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { rpID, RP_NAME, saveChallenge } from '@/lib/staffAttendance/webauthn';

// POST /api/staff-attendance/enroll/options
// Begin a WebAuthn registration ceremony for the signed-in staff member.
export async function POST() {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) {
      return NextResponse.json({ error: 'No staff profile linked to this account' }, { status: 400 });
    }

    const existing = await prisma.staffCredential.findMany({
      where: { staffId, active: true },
      select: { credentialId: true },
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpID(),
      userID: new TextEncoder().encode(staffId),
      userName: session.user?.email || staffId,
      userDisplayName: session.user?.name || 'Staff',
      attestationType: 'none',
      // One bound device: exclude any already-registered credential.
      excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required', // force the biometric / device PIN
      },
    });

    await saveChallenge(staffId, options.challenge, 'register');
    return NextResponse.json(options);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
