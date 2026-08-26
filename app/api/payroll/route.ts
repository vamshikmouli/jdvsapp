import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { periodInfo, countDays, computeSalary } from '@/lib/payroll/compute';

export const dynamic = 'force-dynamic';

// GET /api/payroll — list payroll runs (newest first), with a light summary.
export async function GET() {
  try {
    await requirePermission('PAYROLL_VIEW');
    const runs = await prisma.payrollRun.findMany({
      orderBy: { periodMonth: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    // net + paid totals per run
    const totals = await prisma.payrollItem.groupBy({
      by: ['runId', 'status'],
      _sum: { netSalary: true },
      _count: { _all: true },
    });
    const byRun = new Map<string, { net: number; paidCount: number; total: number }>();
    for (const r of runs) byRun.set(r.id, { net: 0, paidCount: 0, total: 0 });
    for (const t of totals) {
      const agg = byRun.get(t.runId); if (!agg) continue;
      agg.net += t._sum.netSalary || 0;
      agg.total += t._count._all;
      if (t.status === 'PAID') agg.paidCount += t._count._all;
    }
    return NextResponse.json(runs.map((r) => ({
      id: r.id, periodMonth: r.periodMonth, status: r.status, creditOn: r.creditOn,
      staffCount: r._count.items, netTotal: byRun.get(r.id)?.net || 0,
      paidCount: byRun.get(r.id)?.paidCount || 0,
    })));
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// POST /api/payroll — generate a run for { periodMonth: "YYYY-MM" }.
// Builds a PayrollItem per active staff from that month's attendance.
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('PAYROLL_MANAGE');
    const adminId = (session.user as any)?.id as string | undefined;
    const { periodMonth } = await req.json();
    if (!/^\d{4}-\d{2}$/.test(periodMonth || '')) {
      return NextResponse.json({ error: 'periodMonth must be "YYYY-MM"' }, { status: 400 });
    }

    const existing = await prisma.payrollRun.findUnique({ where: { periodMonth } });
    if (existing) return NextResponse.json({ error: 'A run already exists for this month', runId: existing.id }, { status: 409 });

    const { from, to, creditOn, label } = periodInfo(periodMonth);

    const staff = await prisma.staff.findMany({
      where: { archived: false, salaryActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, designation: true, bankAccountNo: true, bankIfsc: true, grossSalary: true, monthlyDeduction: true, monthlyBonus: true, pfApplicable: true, pfWage: true, esiApplicable: true, attendanceTracked: true },
    });
    // All attendance days for the period in one query, grouped by staff.
    const days = await prisma.staffAttendanceDay.findMany({
      where: { date: { gte: from, lte: to } },
      select: { staffId: true, status: true, leaveType: true },
    });
    const byStaff = new Map<string, { status: string; leaveType: string | null }[]>();
    for (const d of days) { const a = byStaff.get(d.staffId) || []; a.push(d); byStaff.set(d.staffId, a); }

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: { periodMonth, status: 'DRAFT', creditOn, note: label },
      });
      for (const s of staff) {
        // Drivers / off-campus staff aren't tracked → no attendance, no LOP, full pay.
        const counts = s.attendanceTracked ? countDays(byStaff.get(s.id) || []) : countDays([]);
        const money = computeSalary(counts, {
          grossSalary: s.grossSalary || 0,
          pfApplicable: s.pfApplicable,
          pfWage: s.pfWage,
          esiApplicable: s.esiApplicable,
          otherDeductions: s.monthlyDeduction || 0,
          bonus: s.monthlyBonus || 0,
        });
        await tx.payrollItem.create({
          data: {
            runId: created.id, staffId: s.id,
            staffName: s.name, designation: s.designation, accountNo: s.bankAccountNo, ifsc: s.bankIfsc,
            attendanceTracked: s.attendanceTracked,
            presentDays: counts.presentDays, halfDays: counts.halfDays,
            paidLeaveDays: counts.paidLeaveDays, unpaidLeaveDays: counts.unpaidLeaveDays,
            absentDays: counts.absentDays, holidayDays: counts.holidayDays, weeklyOffDays: counts.weeklyOffDays,
            lopDays: money.lopDays,
            grossSalary: Math.round(s.grossSalary || 0),
            lopAmount: money.lopAmount, pfAmount: money.pfAmount,
            esiApplicable: s.esiApplicable, esiAmount: money.esiAmount,
            otherDeductions: money.otherDeductions, bonus: money.bonus, netSalary: money.netSalary,
            status: 'DRAFT',
          },
        });
      }
      return created;
    });

    return NextResponse.json({ id: run.id, periodMonth, staffCount: staff.length, creditOn });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
