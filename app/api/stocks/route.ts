import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { getStockOverview } from '@/lib/services/uniformStock';
import { logActivity } from '@/lib/activity';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// SETTINGS_MANAGE is the admin fallback so admins see Stocks with no data migration.
const VIEW = ['STOCK_VIEW', 'STOCK_MANAGE', 'SETTINGS_MANAGE'] as const;
const MANAGE = ['STOCK_MANAGE', 'SETTINGS_MANAGE'] as const;

// GET /api/stocks — uniform stock overview (SKU levels + the deduction gate).
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, [...VIEW])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const year = await getActiveYear();
    return NextResponse.json({ year: { id: year.id, label: year.label }, ...(await getStockOverview(year.id)) });
  } catch (err) {
    console.error('stocks GET', err);
    return NextResponse.json({ error: 'Failed to load stock' }, { status: 500 });
  }
}

// PATCH /api/stocks  Body: { deductionEnabled: boolean } — flip the global gate.
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, [...MANAGE])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const enabled = !!body.deductionEnabled;
    await prisma.settings.update({ where: { id: 'singleton' }, data: { uniformStockDeductionEnabled: enabled } });
    void logActivity(session, { category: 'OTHER', action: 'STOCK_DEDUCTION_TOGGLED', summary: `Uniform stock auto-deduction ${enabled ? 'ON' : 'OFF'}`, meta: { enabled }, req });
    return NextResponse.json({ ok: true, deductionEnabled: enabled });
  } catch (err) {
    console.error('stocks PATCH', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
