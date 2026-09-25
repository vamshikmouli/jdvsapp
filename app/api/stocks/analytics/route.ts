import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { getStockAnalytics } from '@/lib/services/uniformStock';

export const dynamic = 'force-dynamic';

// GET /api/stocks/analytics?from=yyyy-mm-dd&to=yyyy-mm-dd
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, ['STOCK_VIEW', 'STOCK_MANAGE', 'SETTINGS_MANAGE'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const sp = new URL(req.url).searchParams;
    const year = await getActiveYear();
    return NextResponse.json(await getStockAnalytics(year.id, { from: sp.get('from') || undefined, to: sp.get('to') || undefined }));
  } catch (err) {
    console.error('stocks/analytics GET', err);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
