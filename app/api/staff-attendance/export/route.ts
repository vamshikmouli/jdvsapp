import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { fmtMins } from '@/lib/staffAttendance/display';

export const dynamic = 'force-dynamic';

const CODE: Record<string, string> = {
  PRESENT: 'P', HALF_DAY: 'H', ABSENT: 'A', LEAVE: 'L', HOLIDAY: 'Ho', WEEKLY_OFF: 'O',
};

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 366) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 3600_000);
  }
  return out;
}

// GET /api/staff-attendance/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Payroll-friendly workbook: a date matrix + a per-staff summary.
export async function GET(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_VIEW');
    const sp = new URL(req.url).searchParams;
    const to = sp.get('to') || new Date().toISOString().slice(0, 10);
    const from = sp.get('from') || `${to.slice(0, 7)}-01`;
    const dates = eachDate(from, to);

    const [staff, days] = await Promise.all([
      prisma.staff.findMany({ where: { archived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, designation: true } }),
      prisma.staffAttendanceDay.findMany({
        where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      }),
    ]);

    // index: staffId -> dateKey -> day
    const idx = new Map<string, Map<string, (typeof days)[number]>>();
    for (const d of days) {
      const key = d.date.toISOString().slice(0, 10);
      if (!idx.has(d.staffId)) idx.set(d.staffId, new Map());
      idx.get(d.staffId)!.set(key, d);
    }

    const wb = new ExcelJS.Workbook();

    // --- Matrix sheet ---
    const ws = wb.addWorksheet('Daily');
    ws.columns = [
      { header: 'Staff', key: 'name', width: 24 },
      { header: 'Designation', key: 'desig', width: 18 },
      ...dates.map((dk) => ({ header: dk.slice(8) + '/' + dk.slice(5, 7), key: dk, width: 6 })),
    ];
    ws.getRow(1).font = { bold: true };
    for (const s of staff) {
      const row: Record<string, any> = { name: s.name, desig: s.designation || '' };
      const m = idx.get(s.id);
      for (const dk of dates) {
        const day = m?.get(dk);
        row[dk] = day ? CODE[day.status] + (day.late ? '*' : '') : '';
      }
      ws.addRow(row);
    }
    ws.addRow({});
    ws.addRow({ name: 'Legend', desig: 'P=Present H=Half A=Absent L=Leave Ho=Holiday O=Off  (* = late)' });

    // --- Summary sheet ---
    const sum = wb.addWorksheet('Summary');
    sum.columns = [
      { header: 'Staff', key: 'name', width: 24 },
      { header: 'Present', key: 'present', width: 10 },
      { header: 'Half days', key: 'half', width: 10 },
      { header: 'Absent', key: 'absent', width: 10 },
      { header: 'Leave', key: 'leave', width: 10 },
      { header: 'Late count', key: 'late', width: 12 },
      { header: 'Total hours', key: 'hours', width: 14 },
    ];
    sum.getRow(1).font = { bold: true };
    for (const s of staff) {
      const m = idx.get(s.id);
      let present = 0, half = 0, absent = 0, leave = 0, late = 0, mins = 0;
      if (m) for (const d of m.values()) {
        if (d.status === 'PRESENT') present++;
        else if (d.status === 'HALF_DAY') half++;
        else if (d.status === 'ABSENT') absent++;
        else if (d.status === 'LEAVE') leave++;
        if (d.late) late++;
        mins += d.workedMinutes;
      }
      sum.addRow({ name: s.name, present, half, absent, leave, late, hours: fmtMins(mins) });
    }

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="staff-attendance-${from}_to_${to}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
