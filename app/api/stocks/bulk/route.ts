import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { bulkSetStock, type StockGender } from '@/lib/services/uniformStock';

export const dynamic = 'force-dynamic';
const GENDERS = new Set(['M', 'F', 'ANY', 'ALL']);

// POST /api/stocks/bulk  Body: { itemKey, gender?: 'M'|'F'|'ANY'|'ALL', field: 'qty'|'lowThreshold', value }
// Sets a value across every class for one item (optionally one gender).
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, ['STOCK_MANAGE', 'SETTINGS_MANAGE'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const itemKey = String(b.itemKey || '');
    const gender = b.gender ? String(b.gender) : 'ALL';
    const field = b.field === 'lowThreshold' ? 'lowThreshold' : 'qty';
    if (!itemKey || !GENDERS.has(gender) || b.value == null) return NextResponse.json({ error: 'itemKey, gender and value are required' }, { status: 400 });

    const year = await getActiveYear();
    const res = await bulkSetStock(year.id, { itemKey, gender: gender as StockGender | 'ALL', field, value: Number(b.value) }, (session.user as any)?.id ?? null);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    console.error('stocks/bulk POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 400 });
  }
}
