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
  autoAllocate,
  chargeStatus,
  formatReceiptNo,
} from '@/lib/fees';
import { slugify } from '@/lib/utils';
import type { FeeBillingMode, Gender } from '@prisma/client';
import {
  softwareFee,
  ID_CARD_FEE,
  NEW_ADMISSION_FEE,
  UNIFORM_ITEMS,
} from '@/lib/feeStructure';
import { itemsForFromMatrix, priceFromMatrix, type UniformMatrix } from '@/lib/uniformMatrix';
import type { PayMethod } from '@prisma/client';

// The editable uniform price matrix for a year (falls back to the static file).
// Tolerant of the column not existing yet (before the prod schema migration).
async function getUniformMatrix(yearId: string): Promise<UniformMatrix | null> {
  try {
    const y = await prisma.academicYear.findUnique({ where: { id: yearId }, select: { uniformPrices: true } });
    return (y?.uniformPrices as UniformMatrix | null) ?? null;
  } catch {
    return null;
  }
}

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
      fatherName: student.fatherName,
      fatherPhone: student.fatherPhone,
      motherName: student.motherName,
      motherPhone: student.motherPhone,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      feeContactPhone: student.feeContactPhone,
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
  fatherName: string | null;
  phone: string | null;
  classId: string | null;
  className: string | null;
  village: string | null;
  totalCharged: number;
  totalPaid: number;
  totalBalance: number;
  status: AccountSummary['status'];
  hasVan: boolean;
  lastPaidAt: string | null;
  lastSeq: number;
  heads: { name: string; balance: number }[];
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
          // Latest non-voided payment this year — ordered by receiptNo (the true
          // entry sequence; paidAt is only the accounting date and can tie / be future).
          payments: { where: { yearId, voided: false }, orderBy: { receiptNo: 'desc' }, take: 1, select: { receiptNo: true, paidAt: true } },
        },
      },
    },
  });

  const rows = enrollments.map((e) => {
    const s = e.student;
    const a = s.feeAssignments[0];
    const charges = applyConcessions((a?.charges || []).map(toChargeRow), approvedConcessionMap((a?.concessions || []) as any));
    const sum = aggregateAccount(charges);
    const hasVan = charges.some((c) => (c.feeTypeKey || '').toLowerCase().includes('van'));
    return {
      id: s.id,
      name: s.name,
      fatherName: s.fatherName || null,
      phone: s.guardianPhone || s.fatherPhone || s.motherPhone || null,
      classId: e.classId,
      className: e.class?.name || null,
      // Only the student's own village (set via the Collect-screen van dropdown) —
      // no address fallback, which can hold the school/other address.
      village: s.village || null,
      totalCharged: sum.totalCharged,
      totalPaid: sum.totalPaid,
      totalBalance: sum.totalBalance,
      status: sum.status,
      hasVan,
      lastPaidAt: s.payments[0]?.paidAt ? s.payments[0].paidAt.toISOString() : null,
      lastSeq: s.payments[0] ? (parseInt((s.payments[0].receiptNo.match(/(\d+)\s*$/) || [])[1] || '0', 10) || 0) : 0,
      heads: sum.heads.filter((h) => h.balance > 0).map((h) => ({ name: h.name, balance: h.balance })),
    };
  });

  if (opts.filter === 'due') return rows.filter((r) => r.totalBalance > 0);
  if (opts.filter === 'paid') return rows.filter((r) => r.totalBalance <= 0 && r.totalCharged > 0);
  if (opts.filter === 'overdue') return rows.filter((r) => r.status === 'overdue');
  if (opts.filter === 'van') return rows.filter((r) => r.hasVan);
  return rows;
}

/** Record a payment: writes Payment + allocations with a fresh receipt no. */
export async function recordPayment(input: {
  studentId: string;
  yearId: string;
  method: PayMethod;
  note?: string | null;
  collectedById?: string | null;
  date?: string | null; // payment date (yyyy-mm-dd); defaults to now
  allocations: { chargeId: string; amount: number }[];
  // Items sold at the counter (e.g. a Uniform item) — a charge is created for each
  // and paid in full by this same receipt. Lets Collect payment sell repeatables.
  newItems?: { feeTypeId: string; label: string; amount: number }[];
}) {
  const allocs = input.allocations.filter((a) => a.amount > 0);
  const items = (input.newItems || [])
    .map((i) => ({ feeTypeId: String(i.feeTypeId), label: String(i.label || 'Item'), amount: Math.max(0, Math.round(Number(i.amount) || 0)) }))
    .filter((i) => i.feeTypeId && i.amount > 0);
  if (allocs.length === 0 && items.length === 0) throw new Error('Nothing to allocate');
  const total = allocs.reduce((t, a) => t + a.amount, 0) + items.reduce((t, i) => t + i.amount, 0);
  const parsed = input.date ? new Date(input.date) : null;
  const paidAt = parsed && !isNaN(parsed.getTime()) ? parsed : new Date();

  // Load the whole assignment so approved concessions distribute correctly,
  // then validate each allocation against the concession-adjusted balance.
  const assignment = await prisma.studentFeeAssignment.findUnique({
    where: { studentId_yearId: { studentId: input.studentId, yearId: input.yearId } },
    include: {
      charges: { include: chargeInclude },
      concessions: { select: { amount: true, status: true, feeType: { select: { key: true } } } },
    },
  });
  if (allocs.length && !assignment) throw new Error('No fee assignment for this student');
  if (assignment) {
    const resolved = applyConcessions(assignment.charges.map(toChargeRow), approvedConcessionMap(assignment.concessions as any));
    const byId = new Map(resolved.map((c) => [c.id, c]));
    for (const a of allocs) {
      const c = byId.get(a.chargeId);
      if (!c) throw new Error('Invalid charge in allocation');
      if (a.amount > c.balance) throw new Error(`Allocation exceeds payable balance for "${c.label}"`);
    }
  }

  return prisma.$transaction(async (tx) => {
    // Counter-sold items: create a charge for each, then pay it in full below.
    let assignmentId = assignment?.id;
    if (items.length && !assignmentId) {
      const up = await tx.studentFeeAssignment.upsert({
        where: { studentId_yearId: { studentId: input.studentId, yearId: input.yearId } },
        update: {}, create: { studentId: input.studentId, yearId: input.yearId },
      });
      assignmentId = up.id;
    }
    const itemAllocs: { chargeId: string; amount: number }[] = [];
    for (const it of items) {
      const c = await tx.feeCharge.create({ data: { assignmentId: assignmentId!, feeTypeId: it.feeTypeId, label: it.label, amount: it.amount } });
      itemAllocs.push({ chargeId: c.id, amount: it.amount });
    }

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
        paidAt,
        allocations: { create: [...allocs, ...itemAllocs].map((a) => ({ feeChargeId: a.chargeId, amount: a.amount })) },
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

// Change a receipt's date (YYYY-MM-DD). Allocations/amounts are unaffected.
export async function updatePaymentDate(paymentId: string, dateStr: string) {
  const pay = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, voided: true } });
  if (!pay) throw new Error('Receipt not found');
  if (pay.voided) throw new Error('Cannot change the date of a cancelled receipt');
  const d = new Date(dateStr + 'T00:00:00.000Z');
  if (isNaN(d.getTime())) throw new Error('Invalid date');
  await prisma.payment.update({ where: { id: paymentId }, data: { paidAt: d } });
  return { id: paymentId, paidAt: d.toISOString() };
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
  const uniformMatrix = await getUniformMatrix(yearId); // tolerant of pre-migration
  return {
    feeTypes,
    classes,
    uniformMatrix,
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

// The assignment editor works with fixed "heads" (van/uniform/idcard/newadmission),
// but FeeTypes are created through the admin UI, so their `key` is a slug of
// whatever the admin named them (e.g. "Van / Transport" → "van-transport", "ID
// Card" → "id-card"). Resolve each head to the real FeeType by concept — exact
// canonical key first, then a normalized key/name prefix — so a name/slug that
// doesn't match the hardcoded key still resolves. `startsWith` on the separator-
// stripped key/name keeps this precise (won't mis-match e.g. "Advance" to "van").
const HEAD_LABELS: Record<string, string> = {
  van: 'Van / Transport', uniform: 'Uniform', idcard: 'ID Card', newadmission: 'New Admission',
};
function resolveHeadId(types: { id: string; key: string; name: string }[], head: string): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const h = norm(head);
  return (
    types.find((t) => t.key === head)?.id ??
    types.find((t) => norm(t.key) === h || norm(t.key).startsWith(h))?.id ??
    types.find((t) => norm(t.name).startsWith(h))?.id
  );
}
async function headFeeTypeIds(): Promise<Record<string, string | undefined>> {
  const types = await prisma.feeType.findMany({ select: { id: true, key: true, name: true } });
  return {
    van: resolveHeadId(types, 'van'),
    uniform: resolveHeadId(types, 'uniform'),
    idcard: resolveHeadId(types, 'idcard'),
    newadmission: resolveHeadId(types, 'newadmission'),
  };
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

  const ids = await headFeeTypeIds();
  const headOf = (key: string) => {
    const charges = ids[key] ? (assignment?.charges || []).filter((c) => c.feeTypeId === ids[key]) : [];
    const amount = charges.reduce((t, c) => t + c.amount, 0);
    const paid = charges.reduce((t, c) => t + c.allocations.reduce((x, a) => x + a.amount, 0), 0);
    return { active: charges.length > 0, amount, locked: paid > 0 };
  };

  // Van rates configured in Fee setup (drives the Collect-screen village dropdown),
  // plus the suggestion for the student's own village.
  const vanFees = await prisma.vanFee.findMany({ where: { yearId }, orderBy: { village: 'asc' } });
  const van = student.village ? vanFees.find((v) => v.village === student.village) || null : null;
  const vanRates = vanFees.map((v) => ({ village: v.village, fee: v.annualFee }));

  // Uniform items for the Collect picker = the Fee-setup "Uniform prices" catalogue
  // (priced by the class×gender matrix for THIS student, no static file fallback),
  // plus any custom uniform items added to the DB. This mirrors exactly what the
  // Fee setup → Uniform items screen shows.
  const selByName = new Map((assignment?.uniformSelections || []).map((u) => [u.uniformItem.name, u.qty]));
  const matrix = await getUniformMatrix(yearId);
  const cellPrice = (key: string): number => {
    const cell = matrix?.[key]?.[student.classId!];
    if (!cell) return 0;
    const def = UNIFORM_ITEMS.find((d) => d.key === key);
    if (def?.gendered) { const v = student.gender === 'F' ? cell.F : cell.M; return v != null ? v : 0; }
    return cell.ANY != null ? cell.ANY : 0;
  };
  const fromDefs = UNIFORM_ITEMS.map((d) => ({ key: d.key, name: d.name, price: cellPrice(d.key), qty: selByName.get(d.name) || 0 }));
  const defNames = new Set(UNIFORM_ITEMS.map((d) => d.name.toLowerCase()));
  const dbItems = await prisma.uniformItem.findMany({ where: { yearId, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  const extras = dbItems
    .filter((u) => !defNames.has(u.name.toLowerCase()))
    .map((u) => { const mp = cellPrice(u.id); return { key: u.id, name: u.name, price: mp > 0 ? mp : u.price, qty: selByName.get(u.name) || 0 }; });
  const uniformAvail = [...fromDefs, ...extras];

  // Existing old-fee / arrears lines (one per source year, keyed by label).
  const oldFees = (assignment?.charges || [])
    .filter((c) => c.feeType.key === 'olddue')
    .map((c) => ({ label: c.label, amount: c.amount, locked: c.allocations.reduce((t, a) => t + a.amount, 0) > 0 }));
  const oldHead = await ensureOldBalanceHead();

  // ID-card / new-admission suggested amount from the class fee configured in
  // Fee setup (falls back to the built-in default only if nothing is set).
  const classFeeAmount = async (feeTypeId: string | undefined) =>
    feeTypeId
      ? (await prisma.classFee.findUnique({ where: { yearId_classId_feeTypeId: { yearId, classId: student.classId!, feeTypeId } }, select: { amount: true } }))?.amount || 0
      : 0;
  const idCardFee = (await classFeeAmount(ids.idcard)) || ID_CARD_FEE;
  const newAdmFee = (await classFeeAmount(ids.newadmission)) || NEW_ADMISSION_FEE;

  return {
    student: { id: student.id, name: student.name, classId: student.classId, className: student.class?.name || null, gender: student.gender, village: student.village },
    van: { suggestedFee: van?.annualFee || 0, villageHasRate: !!van, feeTypeId: ids.van || null, rates: vanRates, ...headOf('van') },
    uniform: { items: uniformAvail, feeTypeId: ids.uniform || null, ...headOf('uniform') },
    idCard: { fee: idCardFee, feeTypeId: ids.idcard || null, ...headOf('idcard') },
    newAdmission: { fee: newAdmFee, feeTypeId: ids.newadmission || null, ...headOf('newadmission') },
    oldFees,
    oldFeeTypeId: oldHead.id,
  };
}

// Label for an old-fee line tied to the year the dues are carried from.
function oldFeeLabel(yearLabel: string): string {
  return `Old dues (${yearLabel.trim()})`;
}

/** Add or adjust a single demand charge for a student (Van, Old fee, …) — no
 *  payment. Safe: never lowers a charge below what's already been paid on it. */
export async function upsertHeadCharge(
  studentId: string, yearId: string, feeTypeId: string, amount: number, label?: string | null,
  opts: { append?: boolean } = {},
): Promise<{ ok: true }> {
  const ft = await prisma.feeType.findUnique({ where: { id: feeTypeId }, select: { id: true, name: true } });
  if (!ft) throw new Error('Fee head not found.');
  const amt = Math.max(0, Math.round(Number(amount) || 0));
  const assignment = await prisma.studentFeeAssignment.upsert({
    where: { studentId_yearId: { studentId, yearId } }, update: {}, create: { studentId, yearId },
  });
  // append: always add a fresh line (e.g. a second pair of socks) instead of merging.
  if (opts.append) {
    if (amt > 0) await prisma.feeCharge.create({ data: { assignmentId: assignment.id, feeTypeId, label: label || ft.name, amount: amt } });
    return { ok: true };
  }
  // Match the head's charge — for old-fee, by its year label so multiple years coexist.
  const existing = await prisma.feeCharge.findMany({
    where: { assignmentId: assignment.id, feeTypeId, ...(label ? { label } : {}) },
    include: { allocations: { select: { amount: true } } },
  });
  const cur = existing[0];
  const paid = cur ? cur.allocations.reduce((t, a) => t + a.amount, 0) : 0;
  if (cur) {
    if (amt < paid) throw new Error(`Amount can't be less than the ${'₹'}${paid} already paid on "${cur.label}".`);
    if (amt === 0) await prisma.feeCharge.delete({ where: { id: cur.id } });
    else await prisma.feeCharge.update({ where: { id: cur.id }, data: { amount: amt, label: label || cur.label } });
  } else if (amt > 0) {
    await prisma.feeCharge.create({ data: { assignmentId: assignment.id, feeTypeId, label: label || ft.name, amount: amt } });
  }
  return { ok: true };
}

// Core fees that must never be deleted from the Collect screen.
const PROTECTED_HEAD = /tuition|software|abacus|quick\s*math/i;

/**
 * Define the installment plan for a class fee (year + class + fee type), and
 * optionally re-split students who already carry the single lump charge (only
 * where nothing has been paid on it). Sets ClassFee.amount to the installment sum
 * and marks the fee type installmentable.
 */
export async function setClassFeeInstallments(
  yearId: string, classId: string, feeTypeId: string,
  installments: { n: number; amount: number; dueDate: string }[],
  resplitExisting = true,
): Promise<{ installments: number; resplit: number; skippedPaid: number }> {
  const plan = installments
    .map((i) => ({ n: Math.round(Number(i.n) || 0), amount: Math.max(0, Math.round(Number(i.amount) || 0)), dueDate: new Date(i.dueDate) }))
    .filter((i) => i.n > 0 && i.amount > 0 && !isNaN(i.dueDate.getTime()))
    .sort((a, b) => a.n - b.n);
  const ft = await prisma.feeType.findUnique({ where: { id: feeTypeId }, select: { id: true, name: true } });
  if (!ft) throw new Error('Fee type not found.');
  const total = plan.reduce((t, i) => t + i.amount, 0);

  // Upsert the ClassFee row and replace its installment definitions.
  const cf = await prisma.classFee.upsert({
    where: { yearId_classId_feeTypeId: { yearId, classId, feeTypeId } },
    update: { ...(plan.length ? { amount: total } : {}) },
    create: { yearId, classId, feeTypeId, amount: plan.length ? total : 0 },
  });
  await prisma.classFeeInstallment.deleteMany({ where: { classFeeId: cf.id } });
  if (plan.length) {
    await prisma.classFeeInstallment.createMany({ data: plan.map((i) => ({ classFeeId: cf.id, n: i.n, amount: i.amount, dueDate: i.dueDate })) });
    await prisma.feeType.update({ where: { id: feeTypeId }, data: { installmentable: true } });
  }

  let resplit = 0, skippedPaid = 0;
  if (resplitExisting && plan.length) {
    // Students of this class this year who hold charge(s) for this fee type.
    const assignments = await prisma.studentFeeAssignment.findMany({
      where: { yearId, student: { enrollments: { some: { yearId, classId, status: 'ACTIVE' } } } },
      include: { charges: { where: { feeTypeId }, include: { allocations: { select: { amount: true } } } } },
    });
    for (const a of assignments) {
      if (a.charges.length === 0) continue;
      const paid = a.charges.reduce((t, c) => t + c.allocations.reduce((x, al) => x + al.amount, 0), 0);
      if (paid > 0) { skippedPaid++; continue; }               // don't disturb paid records
      const already = a.charges.length === plan.length && a.charges.every((c) => c.installmentNo != null);
      if (already) continue;                                    // looks already split
      await prisma.$transaction([
        prisma.feeCharge.deleteMany({ where: { id: { in: a.charges.map((c) => c.id) } } }),
        prisma.feeCharge.createMany({ data: plan.map((i) => ({ assignmentId: a.id, feeTypeId, label: `${ft.name} — Installment ${i.n}`, amount: i.amount, dueDate: i.dueDate, installmentNo: i.n })) }),
      ]);
      resplit++;
    }
  }
  return { installments: plan.length, resplit, skippedPaid };
}

/** Remove a demand charge added by mistake. Refuses if any payment is on it,
 *  or if it's a protected core fee (tuition / software / abacus / quick maths). */
export async function deleteHeadCharge(studentId: string, yearId: string, chargeId: string): Promise<{ ok: true }> {
  const charge = await prisma.feeCharge.findUnique({
    where: { id: chargeId },
    include: { assignment: { select: { studentId: true, yearId: true } }, allocations: { select: { amount: true } }, feeType: { select: { key: true, name: true } } },
  });
  if (!charge || charge.assignment.studentId !== studentId || charge.assignment.yearId !== yearId) {
    throw new Error('Fee line not found for this student.');
  }
  if (PROTECTED_HEAD.test(charge.feeType.name) || PROTECTED_HEAD.test(charge.feeType.key) || PROTECTED_HEAD.test(charge.label)) {
    throw new Error(`"${charge.label}" is a core fee and can't be removed here.`);
  }
  const paid = charge.allocations.reduce((t, a) => t + a.amount, 0);
  if (paid > 0) throw new Error(`Can't remove "${charge.label}" — ${'₹'}${paid} already paid on it. Cancel the receipt first.`);
  await prisma.feeCharge.delete({ where: { id: chargeId } });
  return { ok: true };
}

export interface AssignmentInput {
  village?: string | null;
  van: { enabled: boolean; fee?: number };
  uniform: { key: string; qty: number }[];
  idCard: boolean;
  newAdmission: boolean;
  oldFee?: { yearLabel: string; amount: number } | null; // carried-forward dues + source year
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
  const ids = await headFeeTypeIds();

  const existing = await prisma.feeCharge.findMany({
    where: { assignmentId: assignment.id, feeTypeId: { in: [ids.van, ids.uniform, ids.idcard, ids.newadmission].filter(Boolean) as string[] } },
    include: { allocations: { select: { amount: true } } },
  });
  const byKey = (key: string) => (ids[key] ? existing.find((c) => c.feeTypeId === ids[key]) : undefined);
  const paidOf = (c?: (typeof existing)[number]) => (c ? c.allocations.reduce((t, a) => t + a.amount, 0) : 0);

  async function reconcile(key: string, feeTypeId: string | undefined, desired: { amount: number; label: string } | null) {
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
      if (!feeTypeId) throw new Error(`No "${HEAD_LABELS[key] || key}" fee type is set up. Create it under Fees → Fee Types first, then try again.`);
      await prisma.feeCharge.create({ data: { assignmentId: assignment.id, feeTypeId, label: desired.label, amount: desired.amount } });
    }
  }

  // Van — never auto; only what the operator set.
  const vanFee = Math.max(0, Math.round(input.van.fee || 0));
  await reconcile('van', ids.van, input.van.enabled && vanFee > 0 ? { amount: vanFee, label: 'Van / Transport' } : null);

  // Uniform — sum of selected items priced by class + gender; sync selections.
  const picks = (input.uniform || []).filter((u) => u.qty > 0);
  const matrix = await getUniformMatrix(yearId);
  const uniformTotal = picks.reduce((t, u) => t + (priceFromMatrix(matrix, u.key, student.classId!, student.gender as Gender) || 0) * u.qty, 0);
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

  // Old fee / previous dues — one line per source year (label carries the year).
  if (input.oldFee && input.oldFee.yearLabel) {
    const oldHead = await ensureOldBalanceHead();
    const label = oldFeeLabel(input.oldFee.yearLabel);
    const amount = Math.max(0, Math.round(Number(input.oldFee.amount) || 0));
    const cur = await prisma.feeCharge.findFirst({
      where: { assignmentId: assignment.id, feeTypeId: oldHead.id, label },
      include: { allocations: { select: { amount: true } } },
    });
    const paid = cur ? cur.allocations.reduce((t, a) => t + a.amount, 0) : 0;
    if (cur && amount === cur.amount) {
      // no change
    } else if (paid > 0) {
      throw new Error(`"${label}" has payments and can't be changed here. Adjust in Collection.`);
    } else if (amount === 0) {
      if (cur) await prisma.feeCharge.delete({ where: { id: cur.id } });
    } else if (cur) {
      await prisma.feeCharge.update({ where: { id: cur.id }, data: { amount } });
    } else {
      await prisma.feeCharge.create({ data: { assignmentId: assignment.id, feeTypeId: oldHead.id, label, amount } });
    }
  }

  return { ok: true };
}

/* ---------- Quick entry (line-by-line dated payments) ---------- */
// Per student, each entry is one fee paid on one date: pick a head (Tuition, Van,
// Old fee, Uniform item, …), an amount and a date, and save it. Demand comes from
// Fee setup; the entry records a dated payment against that head (topping up the
// head's charge only when the payment exceeds what's owed). The same head can be
// paid on multiple dates — every entry is its own receipt.

/** Find-or-create the "Old Balance" (arrears) head — a MANUAL, non-installment
 *  fee type. Keyed `olddue` to match the arrears report. */
async function ensureOldBalanceHead(): Promise<{ id: string; name: string }> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const existing = await prisma.feeType.findMany({ select: { id: true, key: true, name: true } });
  const hit = existing.find((t) => t.key === 'olddue' || ['oldbalance', 'olddue', 'arrears', 'arrear', 'previousbalance'].some((k) => norm(t.name).startsWith(k)));
  if (hit) return { id: hit.id, name: hit.name };
  const max = await prisma.feeType.aggregate({ _max: { order: true } });
  const created = await prisma.feeType.create({
    data: { key: 'olddue', name: 'Old Balance', billingMode: 'MANUAL', installmentable: false, autoAssign: false, order: (max._max.order || 0) + 1 },
    select: { id: true, name: true },
  });
  return created;
}

export interface QuickEntryInput {
  studentId: string;
  feeTypeId: string;
  amount: number;
  date?: string | null;
  note?: string | null;
}

/** Metadata for the quick-entry screen: fee heads (the head dropdown), the class
 *  list, and — when a class is given — its students (the student picker). */
export async function getQuickEntryMeta(yearId: string, classId?: string) {
  await ensureOldBalanceHead();
  const heads = await prisma.feeType.findMany({
    where: { active: true },
    select: { id: true, name: true, billingMode: true },
    orderBy: { order: 'asc' },
  });
  const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true }, orderBy: { order: 'asc' } });

  let students: { id: string; name: string; className: string | null }[] = [];
  if (classId) {
    const where: any = { yearId, status: 'ACTIVE', student: { status: 'ACTIVE' } };
    if (classId !== 'all') where.classId = classId;
    const enrollments = await prisma.enrollment.findMany({
      where,
      orderBy: [{ class: { order: 'asc' } }, { student: { name: 'asc' } }],
      select: { class: { select: { name: true } }, student: { select: { id: true, name: true } } },
    });
    students = enrollments.map((e) => ({ id: e.student.id, name: e.student.name, className: e.class?.name || null }));
  }
  return { heads, classes, students };
}

/** Record ONE quick-entry line: a dated payment toward a specific fee head.
 *  Demand comes from Fee setup — we only top up the head's charge if the payment
 *  would exceed the outstanding balance (e.g. Old fee / Uniform items with no
 *  preset), so the balance stays owed − paid. Allocates within the head only. */
// Make sure the student's standard class fees (Tuition, Software…) exist before a
// quick-entry payment, so the payment reduces the REAL demand instead of creating
// a parallel top-up charge that later duplicates the class fee.
async function ensureClassFeesAssigned(studentId: string, yearId: string) {
  const enr = await prisma.enrollment.findUnique({ where: { studentId_yearId: { studentId, yearId } }, select: { classId: true } });
  const classId = enr?.classId || (await prisma.student.findUnique({ where: { id: studentId }, select: { classId: true } }))?.classId;
  if (classId) await autoAssignClassFees(studentId, classId, yearId);
}

export async function quickEntryPay(input: QuickEntryInput, yearId: string, collectedById: string | null): Promise<{ receiptNo: string; amount: number }> {
  const amount = Math.max(0, Math.round(Number(input.amount) || 0));
  if (amount <= 0) throw new Error('Enter an amount greater than 0.');
  const head = await prisma.feeType.findUnique({ where: { id: input.feeTypeId }, select: { id: true, name: true } });
  if (!head) throw new Error('Choose a fee head.');
  await ensureClassFeesAssigned(input.studentId, yearId);

  const assignment = await prisma.studentFeeAssignment.upsert({
    where: { studentId_yearId: { studentId: input.studentId, yearId: yearId } },
    update: {}, create: { studentId: input.studentId, yearId: yearId },
    include: { charges: { include: chargeInclude }, concessions: { select: { amount: true, status: true, feeType: { select: { key: true } } } } },
  });

  // Concession-adjusted balance per charge, then this head's outstanding charges.
  const rows = applyConcessions(assignment.charges.map(toChargeRow), approvedConcessionMap(assignment.concessions as any));
  const balById = new Map(rows.map((r) => [r.id, r.balance]));
  const headCharges = assignment.charges.filter((c) => c.feeTypeId === input.feeTypeId);
  const available = headCharges.reduce((t, c) => t + (balById.get(c.id) || 0), 0);

  // Top up demand only if the payment exceeds what's currently owed for this head.
  let topUp: { id: string; balance: number; dueDate: string | null; installmentNo: number | null } | null = null;
  if (available < amount) {
    const short = amount - available;
    const label = input.note ? `${head.name} — ${String(input.note).trim()}` : head.name;
    const created = await prisma.feeCharge.create({ data: { assignmentId: assignment.id, feeTypeId: input.feeTypeId, label, amount: short } });
    topUp = { id: created.id, balance: short, dueDate: null, installmentNo: null };
  }

  const outstanding = [
    ...headCharges.map((c) => ({ id: c.id, balance: balById.get(c.id) || 0, dueDate: iso(c.dueDate), installmentNo: c.installmentNo })),
    ...(topUp ? [topUp] : []),
  ].filter((x) => x.balance > 0).sort((a, b) => {
    const ad = a.dueDate || '9999-12-31', bd = b.dueDate || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.installmentNo ?? 0) - (b.installmentNo ?? 0);
  });
  const allocs = autoAllocate(outstanding.map((r) => ({ id: r.id, balance: r.balance })), amount).filter((a) => a.amount > 0);
  if (allocs.length === 0) throw new Error('Nothing to allocate this payment against.');
  const total = allocs.reduce((t, a) => t + a.amount, 0);
  const paidAt = input.date ? new Date(input.date) : new Date();
  const when = isNaN(paidAt.getTime()) ? new Date() : paidAt;

  const payment = await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findMany({ where: { yearId: yearId }, select: { receiptNo: true } });
    let maxSeq = 0;
    for (const p of existing) {
      const n = parseInt(p.receiptNo.split('/').pop() || '0', 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
    let seq = maxSeq + 1;
    let receiptNo = formatReceiptNo(yearId, seq);
    for (let i = 0; i < 20 && (await tx.payment.findUnique({ where: { receiptNo } })); i++) {
      seq += 1; receiptNo = formatReceiptNo(yearId, seq);
    }
    return tx.payment.create({
      data: {
        studentId: input.studentId, yearId: yearId, receiptNo, method: 'CASH', total,
        paidAt: when, collectedById: collectedById || null, note: input.note ? String(input.note).trim() : 'Quick entry',
        allocations: { create: allocs.map((a) => ({ feeChargeId: a.chargeId, amount: a.amount })) },
      },
      select: { receiptNo: true },
    });
  });
  return { receiptNo: payment.receiptNo, amount: total };
}

/** Record several heads paid on ONE date as a SINGLE receipt (auto-allocated per
 *  head, topping up demand where the amount exceeds what's owed). Used by the
 *  "all heads at once" quick-entry panel. */
export async function quickEntryMulti(
  studentId: string, yearId: string, dateStr: string | null,
  lines: { feeTypeId: string; amount: number; note?: string | null }[],
  collectedById: string | null,
): Promise<{ receiptNo: string; amount: number; heads: number }> {
  const heads = await prisma.feeType.findMany({ where: { active: true }, select: { id: true, name: true } });
  const headById = new Map(heads.map((h) => [h.id, h]));
  const clean = (lines || [])
    .map((l) => ({ feeTypeId: String(l.feeTypeId), amount: Math.max(0, Math.round(Number(l.amount) || 0)), note: l.note ? String(l.note).trim() : null }))
    .filter((l) => l.amount > 0 && headById.has(l.feeTypeId));
  if (clean.length === 0) throw new Error('Enter at least one amount.');

  await ensureClassFeesAssigned(studentId, yearId);
  const assignment = await prisma.studentFeeAssignment.upsert({
    where: { studentId_yearId: { studentId, yearId } }, update: {}, create: { studentId, yearId },
    include: { charges: { include: chargeInclude }, concessions: { select: { amount: true, status: true, feeType: { select: { key: true } } } } },
  });
  const rows = applyConcessions(assignment.charges.map(toChargeRow), approvedConcessionMap(assignment.concessions as any));
  const balById = new Map(rows.map((r) => [r.id, r.balance]));
  const byHead = new Map<string, { id: string; balance: number; dueDate: string | null; installmentNo: number | null }[]>();
  for (const c of assignment.charges) {
    const arr = byHead.get(c.feeTypeId) || [];
    arr.push({ id: c.id, balance: balById.get(c.id) || 0, dueDate: iso(c.dueDate), installmentNo: c.installmentNo });
    byHead.set(c.feeTypeId, arr);
  }

  const paidAt = dateStr ? new Date(dateStr) : new Date();
  const when = isNaN(paidAt.getTime()) ? new Date() : paidAt;

  const payment = await prisma.$transaction(async (tx) => {
    const allocations: { chargeId: string; amount: number }[] = [];
    for (const l of clean) {
      let list = (byHead.get(l.feeTypeId) || []).slice();
      const available = list.reduce((t, x) => t + x.balance, 0);
      if (available < l.amount) {
        const label = l.note ? `${headById.get(l.feeTypeId)!.name} — ${l.note}` : headById.get(l.feeTypeId)!.name;
        const created = await tx.feeCharge.create({ data: { assignmentId: assignment.id, feeTypeId: l.feeTypeId, label, amount: l.amount - available } });
        list.push({ id: created.id, balance: l.amount - available, dueDate: null, installmentNo: null });
      }
      list.sort((a, b) => {
        const ad = a.dueDate || '9999-12-31', bd = b.dueDate || '9999-12-31';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.installmentNo ?? 0) - (b.installmentNo ?? 0);
      });
      let left = l.amount;
      for (const c of list) { if (left <= 0) break; const take = Math.min(c.balance, left); if (take > 0) { allocations.push({ chargeId: c.id, amount: take }); left -= take; } }
      if (left > 0) throw new Error(`Could not allocate ${headById.get(l.feeTypeId)!.name}.`);
    }
    const total = allocations.reduce((t, a) => t + a.amount, 0);

    const existing = await tx.payment.findMany({ where: { yearId }, select: { receiptNo: true } });
    let maxSeq = 0;
    for (const p of existing) { const n = parseInt(p.receiptNo.split('/').pop() || '0', 10); if (Number.isFinite(n) && n > maxSeq) maxSeq = n; }
    let seq = maxSeq + 1;
    let receiptNo = formatReceiptNo(yearId, seq);
    for (let i = 0; i < 20 && (await tx.payment.findUnique({ where: { receiptNo } })); i++) { seq += 1; receiptNo = formatReceiptNo(yearId, seq); }

    const p = await tx.payment.create({
      data: {
        studentId, yearId, receiptNo, method: 'CASH', total, paidAt: when, collectedById: collectedById || null,
        note: 'Quick entry', allocations: { create: allocations.map((a) => ({ feeChargeId: a.chargeId, amount: a.amount })) },
      },
      select: { receiptNo: true },
    });
    return { receiptNo: p.receiptNo, total };
  });

  return { receiptNo: payment.receiptNo, amount: payment.total, heads: clean.length };
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
  let billedTotal = 0, collectedAllTotal = 0, oldFeeCollected = 0, oldFeePending = 0;
  for (const a of assignments) {
    const rows = applyConcessions(a.charges.map(toChargeRow), approvedConcessionMap(a.concessions as any));
    const sum = aggregateAccount(rows);
    billedTotal += Math.max(0, sum.totalCharged - sum.concession);
    collectedAllTotal += sum.totalPaid;
    if (sum.totalBalance > 0)
      outstanding.push({ id: a.student.id, name: a.student.name, className: a.student.class?.name || null, balance: sum.totalBalance });
    const oldHead = sum.heads.find((h) => h.key === 'olddue');
    if (oldHead && oldHead.charged > 0) {
      oldDue.push({ id: a.student.id, name: a.student.name, className: a.student.class?.name || null, amount: oldHead.charged, balance: oldHead.balance });
      oldFeeCollected += oldHead.paid;
      oldFeePending += oldHead.balance;
    }
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
    billedTotal,
    collectedAllTotal,
    withDues: outstanding.length,
    oldDue,
    oldFeeCollected,
    oldFeePending,
    installmentDue,
  };
}

/**
 * Auto-assign the auto-applied CLASS_AMOUNT fee types (Tuition, Software, …) to a
 * student, based on their class. Tuition is materialized as one charge per
 * installment. Idempotent-ish: skips a fee head that already has charges.
 */
// Assign class-amount fees to a student. By default only the `autoAssign` heads
// (applied automatically on admission). Pass `allClassAmount` for the manual
// "Assign to all students" action, which should apply EVERY configured class fee.
// Returns the number of heads newly charged.
export async function autoAssignClassFees(studentId: string, classId: string, yearId: string, allClassAmount = false): Promise<number> {
  const feeTypes = await prisma.feeType.findMany({
    where: { billingMode: 'CLASS_AMOUNT', active: true, ...(allClassAmount ? {} : { autoAssign: true }) },
  });
  if (feeTypes.length === 0) return 0;

  const assignment = await prisma.studentFeeAssignment.upsert({
    where: { studentId_yearId: { studentId, yearId } },
    update: {},
    create: { studentId, yearId },
    include: { charges: { select: { feeTypeId: true } } },
  });
  const already = new Set(assignment.charges.map((c) => c.feeTypeId));

  let created = 0;
  for (const ft of feeTypes) {
    if (already.has(ft.id)) continue;
    const cf = await prisma.classFee.findUnique({
      where: { yearId_classId_feeTypeId: { yearId, classId, feeTypeId: ft.id } },
      include: { installments: { orderBy: { n: 'asc' } } },
    });
    if (!cf || cf.amount <= 0) continue; // skip heads with no amount set for this class
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
    created++;
  }
  return created;
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
  if (existing.status === 'APPROVED') throw new Error('Approved concessions cannot be deleted — cancel it instead.');
  await prisma.concession.delete({ where: { id } });
}

// Cancel an already-APPROVED concession: it stops being applied, so the waived
// amount becomes payable again. Kept (as REJECTED with a note) for the audit trail.
export async function cancelConcession(id: string, byId?: string | null, note?: string | null) {
  const existing = await prisma.concession.findUnique({ where: { id } });
  if (!existing) throw new Error('Concession not found');
  if (existing.status !== 'APPROVED') throw new Error('Only an approved concession can be cancelled');
  return prisma.concession.update({
    where: { id },
    data: {
      status: 'REJECTED',
      approvedById: byId || existing.approvedById || null,
      decisionNote: note || 'Cancelled after approval',
      decidedAt: new Date(),
    },
    select: { id: true, status: true },
  });
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
