import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { netBeforeStatutory } from '@/lib/payroll/compute';

export const dynamic = 'force-dynamic';

// PATCH /api/payroll/item/[id]
// Edit a single register row. Body may include:
//   otherDeductions?, bonus?, note?  -> recomputes netSalary
//   paid?: boolean                   -> mark this row paid/unpaid
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermission('PAYROLL_MANAGE');
    const item = await prisma.payrollItem.findUnique({ where: { id: params.id } });
    if (!item) return NextResponse.json({ error: 'Row not found' }, { status: 404 });

    const b = await req.json();
    const data: any = {};

    if (b.otherDeductions !== undefined || b.bonus !== undefined) {
      if (item.status === 'PAID') return NextResponse.json({ error: 'This row is already paid — reopen it to edit' }, { status: 409 });
      const otherDeductions = b.otherDeductions !== undefined ? Math.max(0, Math.round(Number(b.otherDeductions) || 0)) : item.otherDeductions;
      const bonus = b.bonus !== undefined ? Math.max(0, Math.round(Number(b.bonus) || 0)) : item.bonus;
      data.otherDeductions = otherDeductions;
      data.bonus = bonus;
      // ESI is charged on the Net (after LOP + other deductions like LIC), so it
      // must be recomputed whenever those change. PF is fixed.
      const net = netBeforeStatutory(item.grossSalary, item.lopAmount, otherDeductions, bonus);
      const esiAmount = item.esiApplicable ? Math.round(0.0075 * net) : 0;
      data.esiAmount = esiAmount;
      data.netSalary = Math.max(0, net - item.pfAmount - esiAmount);
    }
    if (b.note !== undefined) data.note = String(b.note || '') || null;

    if (b.paid !== undefined) {
      data.status = b.paid ? 'PAID' : 'APPROVED';
      data.paidAt = b.paid ? new Date() : null;
    }

    const updated = await prisma.payrollItem.update({ where: { id: item.id }, data });

    // Keep the run status roughly in sync when rows are toggled paid.
    if (b.paid !== undefined) {
      const remaining = await prisma.payrollItem.count({ where: { runId: item.runId, status: { not: 'PAID' } } });
      await prisma.payrollRun.update({
        where: { id: item.runId },
        data: { status: remaining === 0 ? 'PAID' : (b.paid ? 'APPROVED' : undefined) },
      }).catch(() => {});
    }

    return NextResponse.json(updated);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
