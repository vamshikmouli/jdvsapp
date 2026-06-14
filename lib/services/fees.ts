/**
 * Fee data service — all Prisma access for the fee module lives here.
 * Routes call these; the pure math is in `lib/fees.ts`.
 */
import { prisma } from '@/lib/db';
import {
  ChargeRow,
  AccountSummary,
  aggregateAccount,
  applyConcessions,
  chargeStatus,
  formatReceiptNo,
} from '@/lib/fees';
import { slugify } from '@/lib/utils';
import type { FeeBillingMode, Gender } from '@prisma/client';
import {
  uniformItemsFor,
  uniformPrice,
  softwareFee,
  ID_CARD_FEE,
  NEW_ADMISSION_FEE,
  UNIFORM_ITEMS,
} from '@/lib/feeStructure';
import type { PayMethod } from '@prisma/client';

function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The active academic year (everything fee-related is scoped to it). */
// The current academic year for this request: a per-session override (the
// `yearId` cookie set by the header switcher) wins, else the DB-active year.
export async function getActiveYear() {
  let selectedId: string | undefined;
  try {
    // Lazy import keeps this usable from non-request contexts (scripts) too.
    const { cookies } = await import('next/headers');
    selectedId = cookies().get('yearId')?.value;
  } catch { /* not in a request scope — ignore */ }

  if (selectedId) {
    const sel = await prisma.academicYear.findUnique({ where: { id: selectedId } });
    if (sel) return sel;
  }

  const year =
    (await prisma.academicYear.findFirst({ where: { isActive: true } })) ||
    (await prisma.academicYear.findFirst({ orderBy: { id: 'desc' } }));
  if (!year) throw new Error('No academic year configured');
  return year;
}

type ChargeWithAlloc = {
  id: string;
  label: string;
  amount: number;
  dueDate: Date | null;
  installmentNo: number | null;
  feeType: { key: string; name: string };
  allocations: { amount: number }[];
};

function toChargeRow(c: ChargeWithAlloc): ChargeRow {
  const paid = c.allocations.reduce((t, a) => t + a.amount, 0);
  const balance = Math.max(0, c.amount - paid);
  const dueDate = iso(c.dueDate);
  return {
    id: c.id,
    feeTypeKey: c.feeType.key,
    feeTypeName: c.feeType.name,
    label: c.label,
    amount: c.amount,
    paid,
    concession: 0,
    balance,
    dueDate,
    installmentNo: c.installmentNo,
    status: chargeStatus(c.amount, paid, dueDate),
  };
}

const chargeInclude = {
  feeType: { select: { key: true, name: true } },
  allocations: { select: { amount: true } },
} as const;

// Approved-concession amount per fee-type key, from a list of concession rows.
function approvedConcessionMap(concessions: { amount: number; status: string; feeType: { key: string } }[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const c of concessions) if (c.status === 'APPROVED') map[c.feeType.key] = (map[c.feeType.key] || 0) + c.amount;
  return map;
}

/** Full ledger for one student in a year — heads, totals, payment history. */
export async function getStudentAccount(studentId: string, yearId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { class: { select: { id: true, name: true } }, section: { select: { name: true } } },
  });
  if (!student) return null;

  // Class/section shown reflects this year's enrollment (fallback to current).
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: { class: { select: { id: true, name: true } }, section: { select: { name: true } } },
  });

  const assignment = await prisma.studentFeeAssignment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: {
      charges: { include: chargeInclude, orderBy: { createdAt: 'asc' } },
      uniformSelections: { include: { uniformItem: { select: { name: true, price: true } } } },
      concessions: { include: { feeType: { select: { key: true, name: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });

  const concessions = assignment?.concessions || [];
  const rows: ChargeRow[] = applyConcessions((assignment?.charges || []).map(toChargeRow), approvedConcessionMap(concessions as any));
  const summary: AccountSummary = aggregateAccount(rows);

  const payments = await prisma.payment.findMany({
    where: { studentId, yearId },
    orderBy: { paidAt: 'desc' },
    include: {
      allocations: { include: { feeCharge: { select: { label: true, feeType: { select: { key: true, name: true } } } } } },
    },
  });

  return {
    student: {
      id: student.id,
      name: student.name,
      classId: enrollment?.classId ?? student.classId,
      className: enrollment?.class?.name ?? student.class?.name ?? null,
      section: enrollment?.section?.name ?? student.section?.name ?? null,
      roll: enrollment?.roll ?? student.roll,
      gender: student.gender,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      village: student.village,
    },
    assignment: assignment
      ? {
          id: assignment.id,
          oldDue: assignment.oldDue,
          concession: assignment.concession,
          concessionReason: assignment.concessionReason,
          note: assignment.note,
          uniformSelections: assignment.uniformSelections.map((u) => ({
            name: u.uniformItem.name,
            price: u.uniformItem.price,
            qty: u.qty,
          })),
        }
      : null,
    summary,
    payments: payments.map((p) => ({
      id: p.id,
      receiptNo: p.receiptNo,
      method: p.method,
      total: p.total,
      note: p.note,
      paidAt: p.paidAt.toISOString(),
      voided: p.voided,
      voidReason: p.voidReason,
      allocations: p.allocations.map((a) => ({
        amount: a.amount,
        label: a.feeCharge.label,
        feeTypeKey: a.feeCharge.feeType.key,
        feeTypeName: a.feeCharge.feeType.name,
      })),
    })),
    concessions: concessions.map((c) => ({
      id: c.id,
      feeTypeId: c.feeTypeId,
      feeTypeName: c.feeType.name,
      amount: c.amount,
      reason: c.reason,
      status: c.status,
      decisionNote: c.decisionNote,
      decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export interface AccountListRow {
  id: string;
  name: string;
  classId: string | null;
  className: string | null;
  village: string | null;
  totalCharged: number;
  totalPaid: number;
  totalBalance: number;
  status: AccountSummary['status'];
}

/** List students with derived fee totals, for the collection table + KPIs. */
export async function listAccounts(
  yearId: string,
  opts: { q?: string; classId?: string; filter?: string; classIds?: string[] | null }
): Promise<AccountListRow[]> {
  // Drive the roster off this year's ENROLLMENT — a student's class is the class
  // they were in that year. Class filter applies to the enrollment; the search
  // applies to the student's own fields.
  const enrWhere: any = { yearId, status: 'ACTIVE', student: { status: 'ACTIVE' } };
  if (opts.classId && opts.classId !== 'all') enrWhere.classId = opts.classId;
  if (opts.classIds) enrWhere.classId = enrWhere.classId ? enrWhere.classId : { in: opts.classIds };
  if (opts.q) {
    const q = opts.q.trim();
    const digits = q.replace(/\D/g, '');
    enrWhere.student = {
      status: 'ACTIVE',
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { id: { contains: q, mode: 'insensitive' } },
        { fatherName: { contains: q, mode: 'insensitive' } },
        { motherName: { contains: q, mode: 'insensitive' } },
        { guardianName: { contains: q, mode: 'insensitive' } },
        ...(digits
          ? [
              { fatherPhone: { contains: digits } },
              { motherPhone: { contains: digits } },
              { guardianPhone: { contains: digits } },
            ]
          : []),
      ],
    };
  }

  const enrollments = await prisma.enrollment.findMany({
    where: enrWhere,
    orderBy: { student: { name: 'asc' } },
    include: {
      class: { select: { name: true } },
      student: {
        include: {
          feeAssignments: {
            where: { yearId },
            include: {
              charges: { include: chargeInclude },
              concessions: { select: { amount: true, status: true, feeType: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });

  const rows = enrollments.map((e) => {
    const s = e.student;
    const a = s.feeAssignments[0];
    const charges = applyConcessions((a?.charges || []).map(toChargeRow), approvedConcessionMap((a?.concessions || []) as any));
    const sum = aggregateAccount(charges);
    return {
      id: s.id,
      name: s.name,
      classId: e.classId,
      className: e.class?.name || null,
      village: s.village,
      totalCharged: sum.totalCharged,
      totalPaid: sum.totalPaid,
      totalBalance: sum.totalBalance,
      status: sum.status,
    };
  });

  if (opts.filter === 'due') return rows.filter((r) => r.totalBalance > 0);
  if (opts.filter === 'paid') return rows.filter((r) => r.totalBalance <= 0 && r.totalCharged > 0);
  if (opts.filter === 'overdue') return rows.filter((r) => r.status === 'overdue');
  return rows;
}

/** Record a payment: writes Payment + allocations with a fresh receipt no. */
export async function recordPayment(input: {
  studentId: string;
  yearId: string;
  method: PayMethod;
  note?: string | null;
  collectedById?: string | null;
  allocations: { chargeId: string; amount: number }[];
}) {
  const allocs = input.allocations.filter((a) => a.amount > 0);
  if (allocs.length === 0) throw new Error('Nothing to allocate');
  const total = allocs.reduce((t, a) => t + a.amount, 0);

  // Load the whole assignment so approved concessions distribute correctly,
  // then validate each allocation against the concession-adjusted balance.
  const assignment = await prisma.studentFeeAssignment.findUnique({
    where: { studentId_yearId: { studentId: input.studentId, yearId: input.yearId } },
    include: {
      charges: { include: chargeInclude },
      concessions: { select: { amount: true, status: true, feeType: { select: { key: true } } } },
    },
  });
  if (!assignment) throw new Error('No fee assignment for this student');
  const resolved = applyConcessions(assignment.charges.map(toChargeRow), approvedConcessionMap(assignment.concessions as any));
  const byId = new Map(resolved.map((c) => [c.id, c]));
  for (const a of allocs) {
    const c = byId.get(a.chargeId);
    if (!c) throw new Error('Invalid charge in allocation');
    if (a.amount > c.balance) throw new Error(`Allocation exceeds payable balance for "${c.label}"`);
  }

  return prisma.$transaction(async (tx) => {
    // Next sequence = (highest existing receipt number for the year) + 1.
    // Robust to deleted payments — never reuses a number, unlike a count.
    const existing = await tx.payment.findMany({ where: { yearId: input.yearId }, select: { receiptNo: true } });
    let maxSeq = 0;
    for (const p of existing) {
      const n = parseInt(p.receiptNo.split('/').pop() || '0', 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
    let seq = maxSeq + 1;
    let receiptNo = formatReceiptNo(input.yearId, seq);
    for (let i = 0; i < 20 && (await tx.payment.findUnique({ where: { receiptNo } })); i++) {
      seq += 1;
      receiptNo = formatReceiptNo(input.yearId, seq);
    }

    return tx.payment.create({
      data: {
        studentId: input.studentId,
        yearId: input.yearId,
        receiptNo,
        method: input.method,
        total,
        note: input.note || null,
        collectedById: input.collectedById || null,
        allocations: { create: allocs.map((a) => ({ feeChargeId: a.chargeId, amount: a.amount })) },
      },
      select: { id: true, receiptNo: true },
    });
  });
}

/** Cancel a payment: keep the record (audit), drop its allocations so the
 *  balances go back up, and mark it voided. */
export async function voidPayment(paymentId: string, voidedById: string | null, reason: string) {
  const pay = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, voided: true } });
  if (!pay) throw new Error('Payment not found');
  if (pay.voided) throw new Error('This payment is already cancelled');
  return prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { paymentId } }); // restores charge balances
    return tx.payment.update({
      where: { id: paymentId },
      data: { voided: true, voidedAt: new Date(), voidReason: reason?.trim() || null, voidedById: voidedById || null },
      select: { id: true, voided: true },
    });
  });
}

/** Receipt data for a single payment. */
export async function getReceipt(paymentId: string) {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      student: { include: { class: { select: { name: true } }, section: { select: { name: true } } } },
      year: { select: { id: true, label: true } },
      allocations: { include: { feeCharge: { select: { label: true, feeType: { select: { name: true } } } } } },
    },
  });
  if (!p) return null;
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  // Account summary (year-aware class + current outstanding balance for the year).
  const acct = await getStudentAccount(p.studentId, p.yearId);
  return {
    receiptNo: p.receiptNo,
    paidAt: p.paidAt.toISOString(),
    method: p.method,
    total: p.total,
    note: p.note,
    voided: p.voided,
    voidReason: p.voidReason,
    year: p.year.label,
    // Fee position for the year (as of now).
    totalCharged: acct?.summary.totalCharged ?? null,
    concession: acct?.summary.concession ?? null,
    totalPaid: acct?.summary.totalPaid ?? null,
    balance: acct?.summary.totalBalance ?? null,
    school: { name: settings?.schoolName || 'Jnana Deepika', address: settings?.address || null, phone: settings?.phone || null },
    student: {
      id: p.student.id,
      name: p.student.name,
      className: acct?.student.className ?? p.student.class?.name ?? null,
      section: acct?.student.section ?? p.student.section?.name ?? null,
      guardianName: p.student.guardianName,
    },
    lines: p.allocations.map((a) => ({
      label: a.feeCharge.label,
      head: a.feeCharge.feeType.name,
      amount: a.amount,
    })),
  };
}

/** All fee config for the Setup tab. */
export async function getFeeConfig(yearId: string) {
  const [feeTypes, classes, classFees, vanFees, uniformItems] = await Promise.all([
    prisma.feeType.findMany({ orderBy: { order: 'asc' } }),
    prisma.schoolClass.findMany({ orderBy: { order: 'asc' }, select: { id: true, name: true, group: true } }),
    prisma.classFee.findMany({
      where: { yearId },
      include: { installments: { orderBy: { n: 'asc' } } },
    }),
    prisma.vanFee.findMany({ where: { yearId }, orderBy: { village: 'asc' }, include: { installments: { orderBy: { n: 'asc' } } } }),
    prisma.uniformItem.findMany({ where: { yearId }, orderBy: { order: 'asc' } }),
  ]);
  return {
    feeTypes,
    classes,
    classFees: classFees.map((cf) => ({
      id: cf.id,
      classId: cf.classId,
      feeTypeId: cf.feeTypeId,
      amount: cf.amount,
      installments: cf.installments.map((i) => ({ id: i.id, n: i.n, amount: i.amount, dueDate: iso(i.dueDate) })),
    })),
    vanFees: vanFees.map((v) => ({
      id: v.id,
      village: v.village,
      monthlyFee: v.monthlyFee,
      annualFee: v.annualFee,
      installments: v.installments.map((i) => ({ id: i.id, n: i.n, amount: i.amount, dueDate: iso(i.dueDate) })),
    })),
    uniformItems: uniformItems.map((u) => ({ id: u.id, name: u.name, price: u.price, defaultQty: u.defaultQty, active: u.active })),
  };
}

/* ---------- Fee-type management (admin) ---------- */

async function uniqueFeeTypeKey(name: string): Promise<string> {
  const base = slugify(name) || 'fee';
  let key = base;
  for (let i = 2; await prisma.feeType.findUnique({ where: { key } }); i++) key = `${base}-${i}`;
  return key;
}

/**
 * Create a new fee type. For CLASS_AMOUNT, seed a zero-amount ClassFee row for
 * every class in the active year so it shows up in the Class-fees editor.
 */
export async function createFeeType(input: {
  name: string;
  billingMode: FeeBillingMode;
  installmentable?: boolean;
  autoAssign?: boolean;
}) {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const max = await prisma.feeType.aggregate({ _max: { order: true } });
  const feeType = await prisma.feeType.create({
    data: {
      key: await uniqueFeeTypeKey(name),
      name,
      billingMode: input.billingMode,
      installmentable: !!input.installmentable,
      autoAssign: input.autoAssign ?? input.billingMode === 'CLASS_AMOUNT',
      order: (max._max.order || 0) + 1,
    },
  });

  if (feeType.billingMode === 'CLASS_AMOUNT') {
    const year = await getActiveYear();
    const classes = await prisma.schoolClass.findMany({ select: { id: true } });
    if (classes.length) {
      await prisma.classFee.createMany({
        data: classes.map((c) => ({ yearId: year.id, classId: c.id, feeTypeId: feeType.id, amount: 0 })),
        skipDuplicates: true,
      });
    }
  }
  return feeType;
}

export async function updateFeeType(
  id: string,
  patch: { name?: string; active?: boolean; installmentable?: boolean; autoAssign?: boolean }
) {
  const data: any = {};
  if (patch.name != null) data.name = String(patch.name).trim();
  if (patch.active != null) data.active = !!patch.active;
  if (patch.installmentable != null) data.installmentable = !!patch.installmentable;
  if (patch.autoAssign != null) data.autoAssign = !!patch.autoAssign;
  return prisma.feeType.update({ where: { id }, data });
}

export async function reorderFeeTypes(orderedIds: string[]) {
  await prisma.$transaction(orderedIds.map((id, i) => prisma.feeType.update({ where: { id }, data: { order: i } })));
}

/** Delete a fee type only if nothing has been billed under it yet. */
export async function deleteFeeType(id: string) {
  const charges = await prisma.feeCharge.count({ where: { feeTypeId: id } });
  if (charges > 0) throw new Error('This fee type already has charges/payments and cannot be deleted. Disable it instead.');
  await prisma.classFee.deleteMany({ where: { feeTypeId: id } });
  await prisma.feeType.delete({ where: { id } });
}

/* ---------- Per-student fee assignment (van toggle, uniform, extras) ---------- */

async function feeTypeIdsByKey(): Promise<Record<string, string>> {
  const types = await prisma.feeType.findMany({ select: { id: true, key: true } });
  return Object.fromEntries(types.map((t) => [t.key, t.id]));
}

/**
 * Options for the assignment editor: what optional heads a student can be
 * given, their suggested amounts, and which are already set (+ paid-lock).
 */
export async function getAssignableOptions(studentId: string, yearId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, name: true, classId: true, gender: true, village: true, class: { select: { name: true } } },
  });
  if (!student || !student.classId) return null;

  const assignment = await prisma.studentFeeAssignment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: {
      charges: { include: { feeType: { select: { key: true } }, allocations: { select: { amount: true } } } },
      uniformSelections: { include: { uniformItem: { select: { name: true } } } },
    },
  });

  const headOf = (key: string) => {
    const charges = (assignment?.charges || []).filter((c) => c.feeType.key === key);
    const amount = charges.reduce((t, c) => t + c.amount, 0);
    const paid = charges.reduce((t, c) => t + c.allocations.reduce((x, a) => x + a.amount, 0), 0);
    return { active: charges.length > 0, amount, locked: paid > 0 };
  };

  // Van suggestion from the student's village.
  const van = student.village
    ? await prisma.vanFee.findFirst({ where: { yearId, village: student.village } })
    : null;

  // Current uniform selection (by item key).
  const selByName = new Map((assignment?.uniformSelections || []).map((u) => [u.uniformItem.name, u.qty]));
  const uniformAvail = uniformItemsFor(student.classId, student.gender as Gender).map((it) => ({
    ...it,
    qty: selByName.get(UNIFORM_ITEMS.find((u) => u.key === it.key)?.name || '') || 0,
  }));

  return {
    student: { id: student.id, name: student.name, classId: student.classId, className: student.class?.name || null, gender: student.gender, village: student.village },
    van: { suggestedFee: van?.annualFee || 0, villageHasRate: !!van, ...headOf('van') },
    uniform: { items: uniformAvail, ...headOf('uniform') },
    idCard: { fee: ID_CARD_FEE, ...headOf('idcard') },
    newAdmission: { fee: NEW_ADMISSION_FEE, ...headOf('newadmission') },
  };
}

export interface AssignmentInput {
  village?: string | null;
  van: { enabled: boolean; fee?: number };
  uniform: { key: string; qty: number }[];
  idCard: boolean;
  newAdmission: boolean;
}

/** Save the optional heads for a student, with guards: a head that already has
 *  payments can't be changed or removed. Tuition/software are untouched. */
export async function setAssignment(studentId: string, yearId: string, input: AssignmentInput) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { classId: true, gender: true, village: true } });
  if (!student || !student.classId) throw new Error('Student or class not found');

  // Persist village choice (drives the van-fee suggestion + village reports).
  if (input.village !== undefined) {
    const v = input.village || null;
    if (v !== student.village) await prisma.student.update({ where: { id: studentId }, data: { village: v } });
  }

  const assignment = await prisma.studentFeeAssignment.upsert({
    where: { studentId_yearId: { studentId, yearId } },
    update: {},
    create: { studentId, yearId },
  });
  const ids = await feeTypeIdsByKey();

  const existing = await prisma.feeCharge.findMany({
    where: { assignmentId: assignment.id, feeTypeId: { in: [ids.van, ids.uniform, ids.idcard, ids.newadmission].filter(Boolean) } },
    include: { feeType: { select: { key: true } }, allocations: { select: { amount: true } } },
  });
  const byKey = (key: string) => existing.find((c) => c.feeType.key === key);
  const paidOf = (c?: (typeof existing)[number]) => (c ? c.allocations.reduce((t, a) => t + a.amount, 0) : 0);

  async function reconcile(key: string, feeTypeId: string, desired: { amount: number; label: string } | null) {
    const cur = byKey(key);
    const paid = paidOf(cur);
    if (!desired) {
      if (!cur) return;
      if (paid > 0) throw new Error(`"${cur.label}" has payments and can't be removed. Refund/adjust first.`);
      await prisma.feeCharge.delete({ where: { id: cur.id } });
      return;
    }
    if (cur) {
      if (cur.amount === desired.amount && cur.label === desired.label) return;
      if (paid > 0) throw new Error(`"${cur.label}" has payments; its amount can't be changed.`);
      await prisma.feeCharge.update({ where: { id: cur.id }, data: { amount: desired.amount, label: desired.label } });
    } else {
      await prisma.feeCharge.create({ data: { assignmentId: assignment.id, feeTypeId, label: desired.label, amount: desired.amount } });
    }
  }

  // Van — never auto; only what the operator set.
  const vanFee = Math.max(0, Math.round(input.van.fee || 0));
  await reconcile('van', ids.van, input.van.enabled && vanFee > 0 ? { amount: vanFee, label: 'Van / Transport' } : null);

  // Uniform — sum of selected items priced by class + gender; sync selections.
  const picks = (input.uniform || []).filter((u) => u.qty > 0);
  const uniformTotal = picks.reduce((t, u) => t + (uniformPrice(u.key, student.classId!, student.gender as Gender) || 0) * u.qty, 0);
  await reconcile('uniform', ids.uniform, picks.length > 0 ? { amount: uniformTotal, label: 'Uniform' } : null);
  // selections (only safe to rewrite when uniform head is unpaid — reconcile already guarded amount)
  if (paidOf(byKey('uniform')) === 0) {
    const uniformRows = await prisma.uniformItem.findMany({ where: { yearId }, select: { id: true, name: true } });
    const idByName = new Map(uniformRows.map((r) => [r.name, r.id]));
    await prisma.uniformSelection.deleteMany({ where: { assignmentId: assignment.id } });
    for (const u of picks) {
      const name = UNIFORM_ITEMS.find((x) => x.key === u.key)?.name;
      const uid = name ? idByName.get(name) : undefined;
      if (uid) await prisma.uniformSelection.create({ data: { assignmentId: assignment.id, uniformItemId: uid, qty: u.qty } });
    }
  }

  await reconcile('idcard', ids.idcard, input.idCard ? { amount: ID_CARD_FEE, label: 'ID Card' } : null);
  await reconcile('newadmission', ids.newadmission, input.newAdmission ? { amount: NEW_ADMISSION_FEE, label: 'New Admission Fee' } : null);

  return { ok: true };
}

/** The six fee reports (§10). */
export async function getReports(yearId: string, opts: { from?: string; to?: string }) {
  const paidWhere: any = { yearId, voided: false };
  if (opts.from || opts.to) {
    paidWhere.paidAt = {};
    if (opts.from) paidWhere.paidAt.gte = new Date(opts.from);
    if (opts.to) {
      const t = new Date(opts.to);
      t.setHours(23, 59, 59, 999);
      paidWhere.paidAt.lte = t;
    }
  }

  const payments = await prisma.payment.findMany({
    where: paidWhere,
    include: {
      student: { include: { class: { select: { name: true } } } },
      allocations: { include: { feeCharge: { select: { feeType: { select: { key: true, name: true } } } } } },
    },
    orderBy: { paidAt: 'desc' },
  });

  // Collection grouped by day + by fee head.
  const byDay = new Map<string, number>();
  const byHead = new Map<string, { name: string; amount: number }>();
  const byClass = new Map<string, number>();
  const byVillage = new Map<string, number>();
  let collectedTotal = 0;
  for (const p of payments) {
    collectedTotal += p.total;
    const day = p.paidAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + p.total);
    const cls = p.student.class?.name || 'Unassigned';
    byClass.set(cls, (byClass.get(cls) || 0) + p.total);
    const vil = p.student.village || '—';
    byVillage.set(vil, (byVillage.get(vil) || 0) + p.total);
    for (const a of p.allocations) {
      const key = a.feeCharge.feeType.key;
      const cur = byHead.get(key) || { name: a.feeCharge.feeType.name, amount: 0 };
      cur.amount += a.amount;
      byHead.set(key, cur);
    }
  }

  // Outstanding + old-due, from assignments.
  const assignments = await prisma.studentFeeAssignment.findMany({
    where: { yearId },
    include: {
      student: { include: { class: { select: { name: true } } } },
      charges: { include: chargeInclude },
      concessions: { select: { amount: true, status: true, feeType: { select: { key: true } } } },
    },
  });
  const outstanding: { id: string; name: string; className: string | null; balance: number }[] = [];
  const oldDue: { id: string; name: string; className: string | null; amount: number; balance: number }[] = [];
  for (const a of assignments) {
    const rows = applyConcessions(a.charges.map(toChargeRow), approvedConcessionMap(a.concessions as any));
    const sum = aggregateAccount(rows);
    if (sum.totalBalance > 0)
      outstanding.push({ id: a.student.id, name: a.student.name, className: a.student.class?.name || null, balance: sum.totalBalance });
    const oldHead = sum.heads.find((h) => h.key === 'olddue');
    if (oldHead && oldHead.charged > 0)
      oldDue.push({ id: a.student.id, name: a.student.name, className: a.student.class?.name || null, amount: oldHead.charged, balance: oldHead.balance });
  }
  outstanding.sort((x, y) => y.balance - x.balance);

  // Installment due — tuition/van installments not fully paid, with due date.
  const instCharges = await prisma.feeCharge.findMany({
    where: { assignment: { yearId }, installmentNo: { not: null } },
    include: { ...chargeInclude, assignment: { include: { student: { include: { class: { select: { name: true } } } } } } },
    orderBy: { dueDate: 'asc' },
  });
  const installmentDue = instCharges
    .map((c) => {
      const row = toChargeRow(c as any);
      return {
        id: c.assignment.student.id,
        name: c.assignment.student.name,
        className: c.assignment.student.class?.name || null,
        label: c.label,
        dueDate: iso(c.dueDate),
        balance: row.balance,
        status: row.status,
      };
    })
    .filter((c) => c.balance > 0);

  return {
    collectedTotal,
    paymentCount: payments.length,
    byDay: [...byDay.entries()].map(([day, amount]) => ({ day, amount })).sort((a, b) => (a.day < b.day ? 1 : -1)),
    byHead: [...byHead.values()].sort((a, b) => b.amount - a.amount),
    byClass: [...byClass.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    byVillage: [...byVillage.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    outstanding: outstanding.slice(0, 200),
    outstandingTotal: outstanding.reduce((t, o) => t + o.balance, 0),
    oldDue,
    installmentDue,
  };
}

/**
 * Auto-assign the auto-applied CLASS_AMOUNT fee types (Tuition, Software, …) to a
 * student, based on their class. Tuition is materialized as one charge per
 * installment. Idempotent-ish: skips a fee head that already has charges.
 */
export async function autoAssignClassFees(studentId: string, classId: string, yearId: string) {
  const feeTypes = await prisma.feeType.findMany({
    where: { autoAssign: true, billingMode: 'CLASS_AMOUNT', active: true },
  });
  if (feeTypes.length === 0) return;

  const assignment = await prisma.studentFeeAssignment.upsert({
    where: { studentId_yearId: { studentId, yearId } },
    update: {},
    create: { studentId, yearId },
    include: { charges: { select: { feeTypeId: true } } },
  });
  const already = new Set(assignment.charges.map((c) => c.feeTypeId));

  for (const ft of feeTypes) {
    if (already.has(ft.id)) continue;
    const cf = await prisma.classFee.findUnique({
      where: { yearId_classId_feeTypeId: { yearId, classId, feeTypeId: ft.id } },
      include: { installments: { orderBy: { n: 'asc' } } },
    });
    if (!cf) continue;
    if (ft.installmentable && cf.installments.length > 0) {
      await prisma.feeCharge.createMany({
        data: cf.installments.map((inst) => ({
          assignmentId: assignment.id,
          feeTypeId: ft.id,
          label: `${ft.name} — Installment ${inst.n}`,
          amount: inst.amount,
          dueDate: inst.dueDate,
          installmentNo: inst.n,
        })),
      });
    } else {
      await prisma.feeCharge.create({
        data: { assignmentId: assignment.id, feeTypeId: ft.id, label: ft.name, amount: cf.amount },
      });
    }
  }
}

/**
 * Resolve which students a fee reminder targets, by filter.
 * mode 'all' = any balance>0; 'above' = balance>=minBalance; 'overdue' = has a
 * past-due installment still unpaid. Returns ids + count + total due (snapshot).
 */
export async function studentsForFeeReminder(
  yearId: string,
  opts: { mode: 'all' | 'overdue' | 'above'; minBalance?: number; classId?: string }
) {
  const assignments = await prisma.studentFeeAssignment.findMany({
    where: { yearId, ...(opts.classId ? { student: { classId: opts.classId } } : {}) },
    include: {
      student: { select: { id: true, status: true } },
      charges: { include: chargeInclude },
      concessions: { select: { amount: true, status: true, feeType: { select: { key: true } } } },
    },
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const studentIds: string[] = [];
  let totalDue = 0;
  for (const a of assignments) {
    if (a.student.status !== 'ACTIVE') continue;
    const rows = applyConcessions(a.charges.map(toChargeRow), approvedConcessionMap(a.concessions as any));
    const sum = aggregateAccount(rows);
    if (sum.totalBalance <= 0) continue;
    let match = false;
    if (opts.mode === 'all') match = true;
    else if (opts.mode === 'above') match = sum.totalBalance >= (opts.minBalance || 0);
    else match = rows.some((r) => r.installmentNo != null && r.balance > 0 && r.dueDate != null && new Date(r.dueDate).getTime() < today.getTime());
    if (match) { studentIds.push(a.student.id); totalDue += sum.totalBalance; }
  }
  return { studentIds, count: studentIds.length, totalDue };
}

/* ---------- Concessions (request → admin approval) ---------- */

export async function requestConcession(input: {
  studentId: string;
  yearId: string;
  feeTypeId: string;
  amount: number;
  reason: string;
  requestedById?: string | null;
}) {
  if (!(input.amount > 0)) throw new Error('Concession amount must be greater than zero');
  if (!input.reason?.trim()) throw new Error('A reason is required');
  const ft = await prisma.feeType.findUnique({ where: { id: input.feeTypeId }, select: { id: true } });
  if (!ft) throw new Error('Invalid fee type');
  const assignment = await prisma.studentFeeAssignment.upsert({
    where: { studentId_yearId: { studentId: input.studentId, yearId: input.yearId } },
    update: {},
    create: { studentId: input.studentId, yearId: input.yearId },
  });
  return prisma.concession.create({
    data: {
      assignmentId: assignment.id,
      feeTypeId: input.feeTypeId,
      amount: Math.round(input.amount),
      reason: input.reason.trim(),
      requestedById: input.requestedById || null,
    },
    select: { id: true, status: true },
  });
}

export async function decideConcession(id: string, approve: boolean, approvedById?: string | null, note?: string | null) {
  const existing = await prisma.concession.findUnique({ where: { id } });
  if (!existing) throw new Error('Concession not found');
  if (existing.status !== 'PENDING') throw new Error('This concession has already been decided');
  return prisma.concession.update({
    where: { id },
    data: {
      status: approve ? 'APPROVED' : 'REJECTED',
      approvedById: approvedById || null,
      decisionNote: note || null,
      decidedAt: new Date(),
    },
    select: { id: true, status: true },
  });
}

export async function deleteConcession(id: string) {
  const existing = await prisma.concession.findUnique({ where: { id } });
  if (!existing) throw new Error('Concession not found');
  if (existing.status === 'APPROVED') throw new Error('Approved concessions cannot be deleted — reject is not available after approval.');
  await prisma.concession.delete({ where: { id } });
}

export async function listConcessions(opts: { status?: string; yearId?: string }) {
  const where: any = {};
  if (opts.status && opts.status !== 'all') where.status = opts.status;
  if (opts.yearId) where.assignment = { yearId: opts.yearId };
  const items = await prisma.concession.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      feeType: { select: { name: true } },
      assignment: { include: { student: { select: { id: true, name: true, class: { select: { name: true } } } } } },
    },
  });
  const userIds = [...new Set(items.flatMap((c) => [c.requestedById, c.approvedById]).filter(Boolean) as string[])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = (uid: string | null) => (uid ? users.find((u) => u.id === uid)?.name || null : null);
  return items.map((c) => ({
    id: c.id,
    studentId: c.assignment.student.id,
    studentName: c.assignment.student.name,
    className: c.assignment.student.class?.name || null,
    feeTypeName: c.feeType.name,
    amount: c.amount,
    reason: c.reason,
    status: c.status,
    requestedBy: nameOf(c.requestedById),
    approvedBy: nameOf(c.approvedById),
    decisionNote: c.decisionNote,
    createdAt: c.createdAt.toISOString(),
    decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
  }));
}
