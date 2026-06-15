import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { Permission } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { restoreBackup, type BackupGroup } from '@/lib/services/backup';

export const dynamic = 'force-dynamic';
// Large workbooks need a bigger body limit than the default.
export const maxDuration = 300;

// Per-group import permission. A full (no-group) import needs SETTINGS_MANAGE;
// a scoped import (e.g. ?group=attendance) also accepts the page's own perm.
const GROUP_PERMS: Record<BackupGroup, Permission[]> = {
  students: ['STUDENTS_MANAGE'],
  classes: ['CLASSES_MANAGE'],
  fees: ['FEES_COLLECT'],
  attendance: ['ATTENDANCE_MARK', 'ATTENDANCE_LOCK'],
  staff: ['STAFF_MANAGE'],
  marks: ['MARKS_SETUP', 'MARKS_APPROVE'],
};
const ALL_GROUPS = Object.keys(GROUP_PERMS) as BackupGroup[];

// POST /api/backup/import — body is the raw .xlsx file bytes. Parses every sheet
// and upserts rows by id (FK-safe order), restoring the DB to match the workbook.
// Optional ?group=attendance restricts the restore to that page's tables.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const raw = req.nextUrl.searchParams.get('group') || '';
  const groups = raw.split(',').map((g) => g.trim()).filter((g): g is BackupGroup => ALL_GROUPS.includes(g as BackupGroup));

  // SETTINGS_MANAGE may import anything; otherwise every requested group must be
  // covered by one of the user's permissions. A full (no-group) import is admin-only.
  const allowed =
    canAny(session, ['SETTINGS_MANAGE']) ||
    (groups.length > 0 && groups.every((g) => canAny(session, GROUP_PERMS[g])));
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const sheets: Record<string, any[]> = {};
    for (const name of wb.SheetNames) {
      sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
    }

    const results = await restoreBackup(sheets, groups.length ? groups : undefined);
    const totals = results.reduce(
      (a, r) => ({ upserted: a.upserted + r.upserted, failed: a.failed + r.failed }),
      { upserted: 0, failed: 0 },
    );

    return NextResponse.json({ ok: totals.failed === 0, totals, results });
  } catch (err) {
    console.error('backup/import', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed' }, { status: 400 });
  }
}
