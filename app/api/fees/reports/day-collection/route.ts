import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getDayCollection } from '@/lib/services/fees';

// GET /api/fees/reports/day-collection?date=YYYY-MM-DD
// Who paid on a given day (receipts + payment-mode totals) — powers the Daily
// collection drill-down in Reports.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const date = new URL(req.url).searchParams.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    const year = await getActiveYear();
    return NextResponse.json(await getDayCollection(year.id, date));
  } catch (err) {
    console.error('fees/reports/day-collection GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
