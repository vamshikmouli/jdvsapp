import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getQuickEntryMeta, quickEntryPay, quickEntryMulti } from '@/lib/services/fees';

// Quick entry (line-by-line dated payments).
//  GET  ?classId=  → { year, heads, classes, students }
//  POST { studentId, feeTypeId, amount, date?, note? } → { ok, receiptNo, amount }

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const classId = req.nextUrl.searchParams.get('classId') || undefined;
    const year = await getActiveYear();
    const data = await getQuickEntryMeta(year.id, classId);
    return NextResponse.json({ year: { id: year.id, label: year.label }, ...data });
  } catch (err) {
    console.error('fees/grid GET', err);
    return NextResponse.json({ error: 'Failed to load quick entry' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();
    if (!body?.studentId) {
      return NextResponse.json({ error: 'Student is required.' }, { status: 400 });
    }
    const userId = (session.user as any)?.id as string | undefined;
    const year = await getActiveYear();

    // Multi-head panel: several heads paid on one date → one receipt.
    if (Array.isArray(body.lines)) {
      const lines = body.lines
        .filter((l: any) => l && l.feeTypeId)
        .map((l: any) => ({ feeTypeId: String(l.feeTypeId), amount: Number(l.amount) || 0, note: l.note ? String(l.note) : null }));
      const result = await quickEntryMulti(String(body.studentId), year.id, body.date ? String(body.date) : null, lines, userId || null);
      return NextResponse.json({ ok: true, ...result });
    }

    // Single head (legacy path).
    if (!body?.feeTypeId) return NextResponse.json({ error: 'Fee head is required.' }, { status: 400 });
    const result = await quickEntryPay(
      {
        studentId: String(body.studentId),
        feeTypeId: String(body.feeTypeId),
        amount: Number(body.amount) || 0,
        date: body.date ? String(body.date) : null,
        note: body.note ? String(body.note) : null,
      },
      year.id,
      userId || null,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('fees/grid POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to record entry' }, { status: 400 });
  }
}
