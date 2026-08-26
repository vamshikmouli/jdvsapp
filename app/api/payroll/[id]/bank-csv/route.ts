import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

// GET /api/payroll/[id]/bank-csv
// Canara Bank bulk-transfer file for this run. One row per staff who has bank
// details and a payable amount > 0. Columns are the common bulk-NEFT layout;
// adjust to your exact Canara upload template if needed.
function cell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermission('PAYROLL_VIEW');
    const run = await prisma.payrollRun.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { staffName: 'asc' } } },
    });
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const header = ['Sl No', 'Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Narration'];
    const rows: string[] = [header.map(cell).join(',')];
    let sl = 0;
    for (const it of run.items) {
      if (!it.accountNo || !it.ifsc || it.netSalary <= 0) continue; // skip incomplete
      sl++;
      rows.push([
        sl,
        cell(it.staffName),
        cell(it.accountNo),
        cell(it.ifsc),
        it.netSalary.toFixed(2),
        cell(`SAL ${run.periodMonth}`),
      ].join(','));
    }

    const csv = rows.join('\r\n') + '\r\n';
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="canara-salary-${run.periodMonth}.csv"`,
      },
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
