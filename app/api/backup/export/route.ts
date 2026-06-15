import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { buildBackup, type BackupGroup } from '@/lib/services/backup';

export const dynamic = 'force-dynamic';

const GROUPS: BackupGroup[] = ['students', 'classes', 'fees', 'attendance', 'staff', 'marks'];

// GET /api/backup/export — download a data backup as one .xlsx workbook (one
// sheet per table, with real ids/foreign keys). Re-import via /api/backup/import.
// Optional ?group=students,fees limits it to specific pages; omit for everything.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['REPORTS_EXPORT', 'SETTINGS_MANAGE'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const raw = req.nextUrl.searchParams.get('group') || '';
    const requested = raw.split(',').map((g) => g.trim()).filter(Boolean) as BackupGroup[];
    const groups = requested.filter((g) => GROUPS.includes(g));
    const data = await buildBackup(groups.length ? groups : undefined);
    const wb = XLSX.utils.book_new();
    for (const { sheet, header, rows } of data) {
      // Always write the header row so empty tables still round-trip.
      const ws = rows.length
        ? XLSX.utils.json_to_sheet(rows, { header })
        : XLSX.utils.aoa_to_sheet([header]);
      XLSX.utils.book_append_sheet(wb, ws, sheet);
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const stamp = new Date().toISOString().slice(0, 10);
    const label = groups.length === 1 ? groups[0] : 'backup';

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="jnana-${label}-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('backup/export', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
