import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getActiveYear, upsertHeadCharge, deleteHeadCharge } from '@/lib/services/fees';

// POST /api/fees/accounts/[studentId]/charge — add/adjust one demand charge
// (Van fee, Old fee, …) on a student. Body: { feeTypeId, amount, label? }
export async function POST(req: NextRequest, { params }: { params: { studentId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    if (!body?.feeTypeId) return NextResponse.json({ error: 'feeTypeId is required' }, { status: 400 });
    const year = await getActiveYear();
    const result = await upsertHeadCharge(
      params.studentId, year.id, String(body.feeTypeId), Number(body.amount) || 0,
      body.label ? String(body.label) : null,
      { append: !!body.append },
    );
    // Adding a van fee by village also records that village on the student.
    if (body.village && String(body.village).trim()) {
      await prisma.student.update({ where: { id: params.studentId }, data: { village: String(body.village).trim() } });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('fees/accounts/[id]/charge POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to add charge' }, { status: 400 });
  }
}

// DELETE /api/fees/accounts/[studentId]/charge?chargeId=... — remove a mistaken demand line.
export async function DELETE(req: NextRequest, { params }: { params: { studentId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const chargeId = new URL(req.url).searchParams.get('chargeId');
    if (!chargeId) return NextResponse.json({ error: 'chargeId is required' }, { status: 400 });
    const year = await getActiveYear();
    const result = await deleteHeadCharge(params.studentId, year.id, chargeId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('fees/accounts/[id]/charge DELETE', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to remove charge' }, { status: 400 });
  }
}
