import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getActiveYear, requestConcession, listConcessions } from '@/lib/services/fees';
import { logActivity } from '@/lib/activity';
import { feeMoney } from '@/lib/fees';

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
    if (!body.studentId) {
      return NextResponse.json({ error: 'studentId is required' }, { status: 400 });
    }

    // Accept either a single concession (feeTypeId/feeTypeKey + amount) or a batch
    // (`items: [{ feeTypeId|feeTypeKey, amount }]`) sharing one reason. Batching lets
    // the office waive several heads at once, e.g. Tuition 2000 + Old fee 3000 + Van 1000.
    const rawItems: any[] = Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ feeTypeId: body.feeTypeId, feeTypeKey: body.feeTypeKey, amount: body.amount }];

    // Resolve any fee-type keys to ids in one lookup.
    const keys = Array.from(new Set(rawItems.map((i) => i.feeTypeKey).filter(Boolean).map(String)));
    const byKey: Record<string, string> = {};
    if (keys.length) {
      const fts = await prisma.feeType.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
      for (const ft of fts) byKey[ft.key] = ft.id;
    }

    const reason = String(body.reason || '');
    const items = rawItems.map((i) => {
      const feeTypeId: string | undefined = i.feeTypeId || (i.feeTypeKey ? byKey[String(i.feeTypeKey)] : undefined);
      return { feeTypeId, amount: Math.round(Number(i.amount) || 0), reason: String(i.reason || reason) };
    });
    if (items.some((i) => !i.feeTypeId)) {
      return NextResponse.json({ error: 'Each concession needs a valid fee type' }, { status: 400 });
    }
    if (items.some((i) => !(i.amount > 0))) {
      return NextResponse.json({ error: 'Each concession needs an amount greater than 0' }, { status: 400 });
    }

    const year = await getActiveYear();
    const requestedById = (session.user as any)?.id || null;
    // Create sequentially so a bad row surfaces a clear error (the earlier rows
    // are valid concession requests and stay — they still need admin approval).
    const created = [];
    for (const it of items) {
      created.push(await requestConcession({
        studentId: String(body.studentId),
        yearId: year.id,
        feeTypeId: it.feeTypeId!,
        amount: it.amount,
        reason: it.reason,
        requestedById,
      }));
    }
    const concTotal = items.reduce((t, i) => t + i.amount, 0);
    void logActivity(session, { category: 'FEES', action: 'CONCESSION_REQUESTED', entityType: 'Student', entityId: String(body.studentId), summary: `Requested ${created.length} concession${created.length === 1 ? '' : 's'} totalling ${feeMoney(concTotal)}${reason ? ` — ${reason}` : ''}`, meta: { studentId: body.studentId, count: created.length }, req });
    return NextResponse.json({ count: created.length, items: created }, { status: 201 });
  } catch (err) {
    console.error('fees/concessions POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to request concession' }, { status: 400 });
  }
}
