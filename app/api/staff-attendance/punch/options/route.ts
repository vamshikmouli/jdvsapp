import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { rpID, saveChallenge } from '@/lib/staffAttendance/webauthn';

// POST /api/staff-attendance/punch/options
// Begin a WebAuthn authentication ceremony for the signed-in staff member.
export async function POST() {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) {
      return NextResponse.json({ error: 'No staff profile linked to this account' }, { status: 400 });
    }

    const creds = await prisma.staffCredential.findMany({
      where: { staffId, active: true },
      select: { credentialId: true, transports: true },
    });
    if (creds.length === 0) {
      return NextResponse.json({ error: 'NO_DEVICE' }, { status: 409 });
    }

    const options = await generateAuthenticationOptions({
      rpID: rpID(),
      userVerification: 'required',
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports ? (JSON.parse(c.transports) as any) : undefined,
      })),
    });

    await saveChallenge(staffId, options.challenge, 'authenticate');
    return NextResponse.json(options);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
