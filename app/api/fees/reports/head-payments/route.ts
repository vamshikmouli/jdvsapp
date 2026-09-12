import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getHeadPayments } from '@/lib/services/fees';

// GET /api/fees/reports/head-payments?headKey=&from=&to=
// Students who paid toward one fee head, by date (Reports drill-down).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const headKey = searchParams.get('headKey') || '';
    if (!headKey) return NextResponse.json({ error: 'headKey is required' }, { status: 400 });
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    const year = await getActiveYear();
    const data = await getHeadPayments(year.id, headKey, { from, to });
    return NextResponse.json(data);
  } catch (err) {
    console.error('fees/reports/head-payments GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
