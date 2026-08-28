import { NextRequest, NextResponse } from 'next/server';
import { requestOtp, OtpError } from '@/lib/auth/otp';

// POST /api/auth/otp/request  { phone }
// Sends a WhatsApp login code. Always returns { ok: true } for valid-looking
// numbers (never reveals whether a number is registered).
export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    await requestOtp(String(phone || ''));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof OtpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('otp/request error:', err);
    return NextResponse.json({ error: 'Could not send code' }, { status: 500 });
  }
}
