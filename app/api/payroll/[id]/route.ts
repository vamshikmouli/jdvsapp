import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

// GET /api/payroll/[id] — run header + all items (register rows).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermission('PAYROLL_VIEW');
    const run = await prisma.payrollRun.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { staffName: 'asc' } } },
    });
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json(run);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// POST /api/payroll/[id] — run-level actions.
//   { action: 'approve' | 'reopen' | 'payAll' | 'delete' }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requirePermission('PAYROLL_MANAGE');
    const adminId = (session.user as any)?.id as string | undefined;
    const { action } = await req.json();
    const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    if (action === 'approve') {
      await prisma.$transaction([
        prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED', approvedById: adminId, approvedAt: new Date() } }),
        prisma.payrollItem.updateMany({ where: { runId: run.id, status: 'DRAFT' }, data: { status: 'APPROVED' } }),
      ]);
      return NextResponse.json({ ok: true, status: 'APPROVED' });
    }

    if (action === 'reopen') {
      if (run.status === 'PAID') return NextResponse.json({ error: 'Cannot reopen a fully paid run' }, { status: 409 });
      await prisma.$transaction([
        prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT', approvedById: null, approvedAt: null } }),
        prisma.payrollItem.updateMany({ where: { runId: run.id, status: 'APPROVED' }, data: { status: 'DRAFT' } }),
      ]);
      return NextResponse.json({ ok: true, status: 'DRAFT' });
    }

    if (action === 'payAll') {
      const now = new Date();
      await prisma.$transaction([
        prisma.payrollItem.updateMany({ where: { runId: run.id, status: { not: 'PAID' } }, data: { status: 'PAID', paidAt: now } }),
        prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'PAID' } }),
      ]);
      return NextResponse.json({ ok: true, status: 'PAID' });
    }

    if (action === 'delete') {
      if (run.status === 'PAID') return NextResponse.json({ error: 'Cannot delete a paid run' }, { status: 409 });
      await prisma.payrollRun.delete({ where: { id: run.id } }); // cascades to items
      return NextResponse.json({ ok: true, deleted: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
