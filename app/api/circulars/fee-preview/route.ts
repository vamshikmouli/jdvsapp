import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, studentsForFeeReminder, type FeeReminderRecency } from '@/lib/services/fees';

const RECENCY = new Set(['none', '1m', '3m', 'never']);

// GET /api/circulars/fee-preview?mode=all|overdue|above&minBalance=&classId=&recency=none|1m|3m|never
// Returns how many students (and total due) a fee reminder would reach.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const sp = new URL(req.url).searchParams;
    const mode = (sp.get('mode') || 'all') as 'all' | 'overdue' | 'above';
    const minBalance = Number(sp.get('minBalance')) || 0;
    const classId = sp.get('classId') || undefined;
    const recency = (RECENCY.has(sp.get('recency') || '') ? sp.get('recency') : 'none') as FeeReminderRecency;

    const year = await getActiveYear();
    const { count, totalDue } = await studentsForFeeReminder(year.id, { mode, minBalance, classId, recency });
    return NextResponse.json({ count, totalDue });
  } catch (err) {
    console.error('fee-preview GET', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
