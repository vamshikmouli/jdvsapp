import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getActiveYear, requestConcession, listConcessions } from '@/lib/services/fees';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const year = await getActiveYear();
    const items = await listConcessions({ status, yearId: year.id });
    return NextResponse.json({ canApprove: can(session, 'FEES_CONCESSION_APPROVE'), items });
  } catch (err) {
    console.error('fees/concessions GET', err);
    return NextResponse.json({ error: 'Failed to load concessions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();

    let feeTypeId: string | undefined = body.feeTypeId;
    if (!feeTypeId && body.feeTypeKey) {
      const ft = await prisma.feeType.findUnique({ where: { key: String(body.feeTypeKey) }, select: { id: true } });
      feeTypeId = ft?.id;
    }
    if (!body.studentId || !feeTypeId) {
      return NextResponse.json({ error: 'studentId and a fee type are required' }, { status: 400 });
    }

    const year = await getActiveYear();
    const result = await requestConcession({
      studentId: String(body.studentId),
      yearId: year.id,
      feeTypeId,
      amount: Math.round(Number(body.amount) || 0),
      reason: String(body.reason || ''),
      requestedById: (session.user as any)?.id || null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('fees/concessions POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to request concession' }, { status: 400 });
  }
}
