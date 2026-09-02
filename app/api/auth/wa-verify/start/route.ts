import { NextRequest, NextResponse } from 'next/server';
import { startWaVerify } from '@/lib/auth/waVerify';
import { OtpError } from '@/lib/auth/otp';

export const dynamic = 'force-dynamic';

// POST /api/auth/wa-verify/start  { phone }
// Returns a one-time code + wa.me link the user taps to send it to the school.
export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    const out = await startWaVerify(String(phone || ''));
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof OtpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[wa-verify/start]', e?.message);
    return NextResponse.json({ error: 'Could not start verification.' }, { status: 500 });
  }
}
