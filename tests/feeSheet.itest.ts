import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { importFeeSheet, buildFeeSheet } from '@/lib/services/feeSheet';

// Wide fee-sheet import against the local DB with throwaway fee heads / students.
// Pins: charges created / updated, receipts per payment date, a student spanning two
// rows (the 2nd row pays into the charge the 1st row created), and re-import = no-op.

const T = 'ZZS' + Date.now().toString(36);
const classId = `${T}-C`;
const S1 = `${T}-1`, S2 = `${T}-2`;
let yearId = '';
let tuition = '', books = '';
const TU = `${T} Tuition`, BO = `${T} Books`;

const snapshot = async () => {
  const out: any = {};
  for (const sid of [S1, S2]) {
    const a = await prisma.studentFeeAssignment.findUnique({ where: { studentId_yearId: { studentId: sid, yearId } }, include: { charges: { orderBy: { label: 'asc' } } } });
    const pays = await prisma.payment.findMany({ where: { studentId: sid, yearId }, orderBy: { paidAt: 'asc' }, include: { allocations: { include: { feeCharge: { select: { label: true } } } } } });
    out[sid] = {
      charges: (a?.charges || []).map((c) => [c.label, c.amount]),
      payments: pays.map((p) => [p.paidAt.toISOString().slice(0, 10), p.method, p.total, p.note, p.allocations.map((x) => [x.feeCharge.label, x.amount]).sort()]),
    };
  }
  return out;
};

beforeAll(async () => {
  yearId = (await prisma.academicYear.findFirst({ where: { isActive: true } }))!.id;
  await prisma.schoolClass.create({ data: { id: classId, name: `${T} STD`, order: 994, group: 'PRIMARY' } });
  tuition = (await prisma.feeType.create({ data: { key: `${T}-tu`, name: TU, billingMode: 'CLASS_AMOUNT' } })).id;
  books = (await prisma.feeType.create({ data: { key: `${T}-bo`, name: BO, billingMode: 'CLASS_AMOUNT' } })).id;
  await prisma.classFee.create({ data: { yearId, classId, feeTypeId: books, amount: 700 } });
  for (const id of [S1, S2]) await prisma.student.create({ data: { id, name: id, gender: 'M', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE', classId } });
  // S2 already has a tuition charge of 500 (nothing paid).
  const asg = await prisma.studentFeeAssignment.create({ data: { studentId: S2, yearId } });
  await prisma.feeCharge.create({ data: { assignmentId: asg.id, feeTypeId: tuition, label: TU, amount: 500 } });
});

afterAll(async () => {
  await prisma.paymentAllocation.deleteMany({ where: { payment: { studentId: { in: [S1, S2] } } } });
  await prisma.payment.deleteMany({ where: { studentId: { in: [S1, S2] } } });
  await prisma.studentFeeAssignment.deleteMany({ where: { studentId: { in: [S1, S2] } } });
  await prisma.student.deleteMany({ where: { id: { in: [S1, S2] } } });
  await prisma.classFee.deleteMany({ where: { classId } });
  await prisma.feeType.deleteMany({ where: { id: { in: [tuition, books] } } });
  await prisma.schoolClass.deleteMany({ where: { id: classId } });
  await prisma.$disconnect();
});

const rows = [
  // S1 row 1: tuition assigned 1000, paid 400 on 01-Jul; books blank-assigned (class fee 700), paid 100 same day.
  { 'Student ID': S1, Name: S1, [`${TU} — Assigned`]: 1000, [`${TU} — Paid`]: 400, [`${TU} — Date`]: '01/07/2026', [`${BO} — Assigned`]: '', [`${BO} — Paid`]: 100, [`${BO} — Date`]: '01/07/2026' },
  // S1 row 2: another 300 of tuition on 01-Aug — goes into the charge row 1 created.
  { 'Student ID': S1, Name: S1, [`${TU} — Assigned`]: '', [`${TU} — Paid`]: 300, [`${TU} — Date`]: '01/08/2026', [`${BO} — Assigned`]: '', [`${BO} — Paid`]: '', [`${BO} — Date`]: '' },
  // S2: existing tuition charge raised to 800, paid 200 on 15-Jul.
  { 'Student ID': S2, Name: S2, [`${TU} — Assigned`]: 800, [`${TU} — Paid`]: 200, [`${TU} — Date`]: '15/07/2026', [`${BO} — Assigned`]: '', [`${BO} — Paid`]: '', [`${BO} — Date`]: '' },
];

describe('importFeeSheet', () => {
  it('dry run changes nothing', async () => {
    const before = await snapshot();
    const r: any = await importFeeSheet(rows, { dryRun: true, yearId, userId: null });
    expect(r.dryRun).toBe(true);
    expect(r.matchedStudents).toBe(2);
    expect(await snapshot()).toEqual(before);
  });

  it('applies charges and one receipt per payment date', async () => {
    const r: any = await importFeeSheet(rows, { dryRun: false, yearId, userId: null });
    expect(r.paymentsCreated).toBe(3);
    expect(await snapshot()).toEqual({
      [S1]: {
        charges: [[BO, 700], [TU, 1000]],
        payments: [
          ['2026-07-01', 'CASH', 500, 'Imported (fee sheet)', [[BO, 100], [TU, 400]]],
          ['2026-08-01', 'CASH', 300, 'Imported (fee sheet)', [[TU, 300]]],
        ],
      },
      [S2]: { charges: [[TU, 800]], payments: [['2026-07-15', 'CASH', 200, 'Imported (fee sheet)', [[TU, 200]]]] },
    });
  });

  it('re-importing the same sheet is a no-op (also for a student spanning two rows)', async () => {
    const before = await snapshot();
    const r: any = await importFeeSheet(rows, { dryRun: false, yearId, userId: null });
    expect(r.paymentsCreated).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('a payment already recorded by UPI on that date is not duplicated', async () => {
    const asg = await prisma.studentFeeAssignment.findUnique({ where: { studentId_yearId: { studentId: S2, yearId } }, include: { charges: true } });
    const pay = await prisma.payment.create({ data: { studentId: S2, yearId, receiptNo: `${T}-UPI`, method: 'UPI', total: 250, paidAt: new Date('2026-09-05T00:00:00Z') } });
    await prisma.paymentAllocation.create({ data: { paymentId: pay.id, feeChargeId: asg!.charges[0].id, amount: 250 } });
    const before = await snapshot();
    const r: any = await importFeeSheet([{ 'Student ID': S2, Name: S2, [`${TU} — Assigned`]: '', [`${TU} — Paid`]: 250, [`${TU} — Date`]: '05/09/2026' }], { dryRun: false, yearId, userId: null });
    expect(r.paymentsCreated).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('raising a paid amount in the sheet records only the difference', async () => {
    const r: any = await importFeeSheet([{ 'Student ID': S1, Name: S1, [`${TU} — Assigned`]: '', [`${TU} — Paid`]: 450, [`${TU} — Date`]: '01/07/2026', [`${BO} — Assigned`]: '', [`${BO} — Paid`]: 100, [`${BO} — Date`]: '01/07/2026' }], { dryRun: false, yearId, userId: null });
    expect(r.paymentsCreated).toBe(1);
    const p = (await snapshot())[S1].payments;
    expect(p).toContainEqual(['2026-07-01', 'CASH', 50, 'Imported (fee sheet)', [[TU, 50]]]);
    expect(p.length).toBe(3);
  });

  it('Export → upload the exported sheet straight back = no change', async () => {
    const sheet = await buildFeeSheet(yearId, classId);
    const objs = sheet.rows.map((r) => Object.fromEntries(sheet.header.map((h, i) => [h, r[i]])));
    expect(objs.length).toBeGreaterThan(0);
    const before = await snapshot();
    const r: any = await importFeeSheet(objs, { dryRun: false, yearId, userId: null });
    expect(r.paymentsCreated).toBe(0);
    expect(await snapshot()).toEqual(before);
  });
});
