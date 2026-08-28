import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, OtpError } from '@/lib/auth/otp';

// POST /api/auth/otp/verify  { phone, code }
// On success returns a one-time grantToken to spend at POST /api/auth/set-pin.
export async function POST(req: NextRequest) {
  try {
    const { phone, code } = await req.json();
    const { grantToken } = await verifyOtp(String(phone || ''), String(code || ''));
    return NextResponse.json({ ok: true, grantToken });
  } catch (err) {
    if (err instanceof OtpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('otp/verify error:', err);
    return NextResponse.json({ error: 'Could not verify code' }, { status: 500 });
  }
}
