import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { periodInfo, countDays, computeSalary, usedByType } from '@/lib/payroll/compute';
import { leaveYearOf, parseQuotas } from '@/lib/staffAttendance/leaveBalance';

export const dynamic = 'force-dynamic';

const PAID_LEAVE_TYPES = ['EARNED', 'SICK'] as const;
// Only these leave types become LOP once their yearly balance is exhausted.
// EARNED is always paid (never LOP), regardless of how many are taken.
const BALANCE_LOP_TYPES = ['SICK'] as const;

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

    // --- Leave balance: paid leave beyond the yearly quota becomes LOP. ---
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { leaveQuotas: true, leaveYearStartMonth: true } });
    const quotas = parseQuotas(settings?.leaveQuotas);
    const ly = leaveYearOf(from, settings?.leaveYearStartMonth ?? 6);
    // Paid-leave days already used earlier in the leave year (before this month).
    const priorDays = await prisma.staffAttendanceDay.findMany({
      where: { date: { gte: ly.from, lt: from }, leaveType: { in: [...PAID_LEAVE_TYPES] } },
      select: { staffId: true, status: true, leaveType: true },
    });
    const priorByStaff = new Map<string, { status: string; leaveType: string | null }[]>();
    for (const d of priorDays) { const a = priorByStaff.get(d.staffId) || []; a.push(d); priorByStaff.set(d.staffId, a); }
    // Per-staff quota overrides for this leave year.
    const overrides = await prisma.leaveEntitlement.findMany({ where: { leaveYear: ly.startYear, type: { in: [...PAID_LEAVE_TYPES] } }, select: { staffId: true, type: true, days: true } });
    const overrideByStaff = new Map<string, Record<string, number>>();
    for (const o of overrides) { const m = overrideByStaff.get(o.staffId) || {}; m[o.type] = o.days; overrideByStaff.set(o.staffId, m); }

    // Over-quota leave days for one staff this month (per type, year-to-date aware).
    const overBalanceFor = (staffId: string, counts: ReturnType<typeof countDays>): number => {
      const prior = priorByStaff.get(staffId) || [];
      const ov = overrideByStaff.get(staffId) || {};
      let over = 0;
      for (const type of BALANCE_LOP_TYPES) { // SICK only — EARNED is always paid
        const entitlement = ov[type] ?? quotas[type as 'SICK'];
        if (!entitlement || entitlement <= 0) continue; // 0 = unlimited → never LOP
        const usedBefore = usedByType(prior, type);
        const thisMonth = counts.sickDays;
        const remaining = Math.max(0, entitlement - usedBefore);
        over += Math.max(0, thisMonth - remaining);
      }
      return over;
    };

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: { periodMonth, status: 'DRAFT', creditOn, note: label },
      });
      for (const s of staff) {
        // Drivers / off-campus staff aren't tracked → no attendance, no LOP, full pay.
        const counts = s.attendanceTracked ? countDays(byStaff.get(s.id) || []) : countDays([]);
        const overBalance = s.attendanceTracked ? overBalanceFor(s.id, counts) : 0;
        const money = computeSalary(counts, {
          grossSalary: s.grossSalary || 0,
          pfApplicable: s.pfApplicable,
          pfWage: s.pfWage,
          esiApplicable: s.esiApplicable,
          otherDeductions: s.monthlyDeduction || 0,
          bonus: s.monthlyBonus || 0,
          overBalanceLeaveDays: overBalance,
        });
        await tx.payrollItem.create({
          data: {
            runId: created.id, staffId: s.id,
            staffName: s.name, designation: s.designation, accountNo: s.bankAccountNo, ifsc: s.bankIfsc,
            attendanceTracked: s.attendanceTracked,
            presentDays: counts.presentDays, halfDays: counts.halfDays,
            // paidLeaveDays shown = leave actually paid (within balance); over-quota goes to LOP.
            paidLeaveDays: Math.round(counts.paidLeaveDays - overBalance), unpaidLeaveDays: Math.round(counts.unpaidLeaveDays),
            absentDays: counts.absentDays, holidayDays: counts.holidayDays, weeklyOffDays: counts.weeklyOffDays,
            overBalanceDays: overBalance,
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
