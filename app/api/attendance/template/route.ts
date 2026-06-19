import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { rosterForClass } from '@/lib/services/enrollment';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/attendance/template?classId=&date=&slot= — a friendly Excel template:
// each student (Admission No + Name) with a Status dropdown (Present/Absent/Leave).
// Fill it and upload on the attendance page — no IDs to deal with.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['ATTENDANCE_VIEW', 'ATTENDANCE_MARK'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const classId = req.nextUrl.searchParams.get('classId') || '';
  const date = req.nextUrl.searchParams.get('date') || '';
  const slot = req.nextUrl.searchParams.get('slot') || '';
  if (!classId) return NextResponse.json({ error: 'classId is required' }, { status: 400 });

  try {
    const year = await getActiveYear();
    const [roster, klass] = await Promise.all([
      rosterForClass(year.id, classId, null),
      prisma.schoolClass.findUnique({ where: { id: classId }, select: { name: true } }),
    ]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Attendance');
    ws.columns = [
      { header: 'Student ID', key: 'adm', width: 18 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Status', key: 'status', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    roster.forEach((s) => ws.addRow({ adm: s.id, name: s.name, status: 'Present' }));

    // Real Excel dropdown on every data row's Status cell.
    for (let r = 2; r <= roster.length + 1; r++) {
      ws.getCell(`C${r}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"Present,DA,Absent,Leave"'],
        showErrorMessage: true,
        errorTitle: 'Invalid status',
        error: 'Pick Present, DA (delayed arrival), Absent or Leave from the list.',
      };
    }

    const buf = await wb.xlsx.writeBuffer();
    const cls = (klass?.name || classId).replace(/\s+/g, '_');
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="attendance-${cls}-${date || 'template'}${slot ? '-' + slot : ''}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('attendance/template', err);
    return NextResponse.json({ error: 'Failed to build template' }, { status: 500 });
  }
}
