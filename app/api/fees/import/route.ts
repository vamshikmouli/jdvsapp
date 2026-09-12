import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { importFees } from '@/lib/services/feeImport';
import { importFeeSheet } from '@/lib/services/feeSheet';

// The wide "fee sheet" (from Export) has a Tuition Fee / Fees Date column and no
// "Fee Head" column; the classic long format has one row per (student, head).
function isWideFormat(rows: any[], format?: string): boolean {
  if (format === 'wide') return true;
  if (format === 'long') return false;
  const keys = rows.length ? Object.keys(rows[0]).map((k) => String(k).trim().toLowerCase()) : [];
  const hasHead = keys.includes('fee head') || keys.includes('feehead');
  const hasGroups = keys.some((k) => /[—-]\s*(assigned|paid|date)$/.test(k));
  return hasGroups && !hasHead;
}

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
    const dryRun = b.dryRun !== false;
    const result = isWideFormat(rows, b.format)
      ? await importFeeSheet(rows, { dryRun, yearId: year.id, userId })
      : await importFees(rows, { dryRun, yearId: year.id, userId });
    return NextResponse.json({ year: year.label, ...result });
  } catch (err) {
    console.error('fees/import', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed' }, { status: 400 });
  }
}
