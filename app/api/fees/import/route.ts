import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { importFees } from '@/lib/services/feeImport';

// POST /api/fees/import — bulk fee upload. Body { rows: [...], dryRun: boolean }.
// dryRun returns a preview (matched/unmatched/totals); apply writes the data.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  // Overrides fee state in bulk — admin only.
  if (!session || !can(session, 'SETTINGS_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const b = await req.json();
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    const year = await getActiveYear();
    const userId = (session.user as any)?.id || null;
    const result = await importFees(rows, { dryRun: b.dryRun !== false, yearId: year.id, userId });
    return NextResponse.json({ year: year.label, ...result });
  } catch (err) {
    console.error('fees/import', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed' }, { status: 400 });
  }
}
