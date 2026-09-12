import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { updatePaymentDate } from '@/lib/services/fees';

// PATCH /api/fees/payments/[id] — change a receipt's date (FEES_COLLECT).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const date = String(body?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    const result = await updatePaymentDate(params.id, date);
    return NextResponse.json(result);
  } catch (err) {
    console.error('fees/payments/[id] PATCH', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update date' }, { status: 400 });
  }
}
