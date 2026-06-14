import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getReceipt } from '@/lib/services/fees';

export async function GET(_req: NextRequest, { params }: { params: { paymentId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const receipt = await getReceipt(params.paymentId);
    if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    return NextResponse.json(receipt);
  } catch (err) {
    console.error('fees/receipts/[id] GET', err);
    return NextResponse.json({ error: 'Failed to load receipt' }, { status: 500 });
  }
}
