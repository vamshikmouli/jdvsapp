import { NextRequest, NextResponse } from 'next/server';
import { confirmWaVerify } from '@/lib/auth/waVerify';

export const dynamic = 'force-dynamic';

// GET /api/auth/wa-verify/confirm?id=...
// Polled by the client. Once the user has sent the code from their own number,
// returns { verified:true, grantToken, phone } to proceed to set-pin.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const out = await confirmWaVerify(id);
    return NextResponse.json(out);
  } catch (e: any) {
    console.error('[wa-verify/confirm]', e?.message);
    return NextResponse.json({ verified: false }, { status: 200 });
  }
}
