import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { setStockCell, type StockGender } from '@/lib/services/uniformStock';

export const dynamic = 'force-dynamic';
const GENDERS = new Set(['M', 'F', 'ANY']);

// PATCH /api/stocks/cell  Body: { itemKey, classId, gender, qty?, lowThreshold? }
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAny(session, ['STOCK_MANAGE', 'SETTINGS_MANAGE'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const itemKey = String(b.itemKey || ''), classId = String(b.classId || ''), gender = String(b.gender || '');
    if (!itemKey || !classId || !GENDERS.has(gender)) return NextResponse.json({ error: 'itemKey, classId and gender are required' }, { status: 400 });
    if (b.qty == null && b.lowThreshold == null) return NextResponse.json({ error: 'Nothing to set' }, { status: 400 });

    const year = await getActiveYear();
    const res = await setStockCell(year.id, {
      itemKey, classId, gender: gender as StockGender,
      qty: b.qty != null ? Number(b.qty) : undefined,
      lowThreshold: b.lowThreshold != null ? Number(b.lowThreshold) : undefined,
    }, (session.user as any)?.id ?? null);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    console.error('stocks/cell PATCH', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save' }, { status: 400 });
  }
}
