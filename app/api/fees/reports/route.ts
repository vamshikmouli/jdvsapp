import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getReports } from '@/lib/services/fees';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    const year = await getActiveYear();
    const reports = await getReports(year.id, { from, to });
    return NextResponse.json({ year: { id: year.id, label: year.label }, ...reports });
  } catch (err) {
    console.error('fees/reports GET', err);
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
  }
}
