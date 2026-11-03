import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { findDuplicateReceipts } from '@/lib/services/duplicateReceipts';

// GET /api/fees/duplicate-receipts — likely duplicate receipts left by repeated fee-sheet
// uploads, for the office to review (read-only; cancelling uses the normal void action).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['FEES_REPORTS', 'FEES_VOID', 'SETTINGS_MANAGE'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const year = await getActiveYear();
  return NextResponse.json({ year: year.label, ...(await findDuplicateReceipts(year.id)) });
}
