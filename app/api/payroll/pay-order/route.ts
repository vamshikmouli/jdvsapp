import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

// POST /api/payroll/pay-order  { order: string[] }  — staffIds in the desired
// salary pay-order. Writes staff.payOrder = 1..N so the register + Canara CSV
// list in exactly this order. Order is per-staff and carries across months.
export async function POST(req: NextRequest) {
  try {
    await requirePermission('PAYROLL_UPDATE');
    const { order } = await req.json();
    if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
      return NextResponse.json({ error: 'order must be an array of staff ids' }, { status: 400 });
    }
    await prisma.$transaction(
      order.map((staffId, i) =>
        prisma.staff.update({ where: { id: staffId }, data: { payOrder: i + 1 } })
      )
    );
    return NextResponse.json({ ok: true, count: order.length });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
