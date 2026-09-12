import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getActiveYear } from '@/lib/services/fees';
import { buildFeeSheet } from '@/lib/services/feeSheet';

export const dynamic = 'force-dynamic';

// GET /api/fees/export?yearId=&classId= — wide fee sheet (one row per student:
// Tuition/Software/ID card + a column per uniform item, with paid amounts and
// dates). Round-trippable — edit and re-upload via Bulk import.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['FEES_VIEW_ALL', 'REPORTS_EXPORT', 'SETTINGS_MANAGE'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const classId = sp.get('classId') || '';
    const year = sp.get('yearId')
      ? await prisma.academicYear.findUnique({ where: { id: sp.get('yearId')! } }) || (await getActiveYear())
      : await getActiveYear();

    const { header, rows } = await buildFeeSheet(year.id, classId || undefined);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fees');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="fees-${year.id}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('fees/export', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
