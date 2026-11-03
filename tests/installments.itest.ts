import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { setClassFeeInstallments } from '@/lib/services/fees';

// Installment plan for a class fee + re-splitting students' existing lump charges.
const T = 'ZZN' + Date.now().toString(36);
const classId = `${T}-C`;
const S = ['a', 'b', 'c', 'd'].map((x) => `${T}-${x}`);
let yearId = '', feeTypeId = '';

const chargesOf = async (sid: string) => {
  const a = await prisma.studentFeeAssignment.findUnique({ where: { studentId_yearId: { studentId: sid, yearId } }, include: { charges: { where: { feeTypeId }, orderBy: [{ installmentNo: 'asc' }, { label: 'asc' }] } } });
  return (a?.charges || []).map((c) => [c.label.replace(`${T} `, ''), c.amount, c.installmentNo, c.dueDate?.toISOString().slice(0, 10) ?? null]);
};

beforeAll(async () => {
  yearId = (await prisma.academicYear.findFirst({ where: { isActive: true } }))!.id;
  await prisma.schoolClass.create({ data: { id: classId, name: classId, order: 992, group: 'PRIMARY' } });
  feeTypeId = (await prisma.feeType.create({ data: { key: `${T}-tu`, name: `${T} Tuition`, billingMode: 'CLASS_AMOUNT' } })).id;
  for (const id of S) {
    await prisma.student.create({ data: { id, name: id, gender: 'M', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE', classId } });
    await prisma.enrollment.create({ data: { studentId: id, yearId, classId, status: 'ACTIVE' } });
  }
  const mk = async (sid: string) => (await prisma.studentFeeAssignment.create({ data: { studentId: sid, yearId } })).id;
  // a: unpaid lump → re-split. b: lump partly paid → left alone. c: already split → left alone. d: no charge.
  await prisma.feeCharge.create({ data: { assignmentId: await mk(S[0]), feeTypeId, label: `${T} Tuition`, amount: 9000 } });
  const bc = await prisma.feeCharge.create({ data: { assignmentId: await mk(S[1]), feeTypeId, label: `${T} Tuition`, amount: 9000 } });
  const pay = await prisma.payment.create({ data: { studentId: S[1], yearId, receiptNo: `${T}-R1`, method: 'CASH', total: 1000, paidAt: new Date() } });
  await prisma.paymentAllocation.create({ data: { paymentId: pay.id, feeChargeId: bc.id, amount: 1000 } });
  const ca = await mk(S[2]);
  await prisma.feeCharge.createMany({ data: [
    { assignmentId: ca, feeTypeId, label: `${T} Tuition — Installment 1`, amount: 4500, installmentNo: 1 },
    { assignmentId: ca, feeTypeId, label: `${T} Tuition — Installment 2`, amount: 4500, installmentNo: 2 },
  ] });
  await mk(S[3]);
});

afterAll(async () => {
  await prisma.paymentAllocation.deleteMany({ where: { payment: { studentId: { in: S } } } });
  await prisma.payment.deleteMany({ where: { studentId: { in: S } } });
  await prisma.studentFeeAssignment.deleteMany({ where: { studentId: { in: S } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: S } } });
  await prisma.student.deleteMany({ where: { id: { in: S } } });
  await prisma.classFee.deleteMany({ where: { classId } });
  await prisma.feeType.deleteMany({ where: { id: feeTypeId } });
  await prisma.schoolClass.deleteMany({ where: { id: classId } });
  await prisma.$disconnect();
});

describe('setClassFeeInstallments', () => {
  it('saves the plan and re-splits only unpaid lump charges', async () => {
    const r = await setClassFeeInstallments(yearId, classId, feeTypeId, [
      { n: 2, amount: 3000, dueDate: '2026-11-10' }, { n: 1, amount: 3000, dueDate: '2026-07-10' }, { n: 3, amount: 3000, dueDate: '2027-02-10' },
    ]);
    expect(r).toEqual({ installments: 3, resplit: 2, skippedPaid: 1 }); // a and c (c had 2 installments ≠ plan of 3)
    expect(await chargesOf(S[0])).toEqual([
      ['Tuition — Installment 1', 3000, 1, '2026-07-10'], ['Tuition — Installment 2', 3000, 2, '2026-11-10'], ['Tuition — Installment 3', 3000, 3, '2027-02-10'],
    ]);
    expect(await chargesOf(S[1])).toEqual([['Tuition', 9000, null, null]]);
    expect(await chargesOf(S[2])).toEqual(await chargesOf(S[0]));
    expect(await chargesOf(S[3])).toEqual([]);
    const cf = await prisma.classFee.findFirst({ where: { classId, feeTypeId }, include: { installments: { orderBy: { n: 'asc' } } } });
    expect([cf!.amount, cf!.installments.map((i) => i.amount)]).toEqual([9000, [3000, 3000, 3000]]);
  });

  it('running it again leaves already-split students alone', async () => {
    const r = await setClassFeeInstallments(yearId, classId, feeTypeId, [
      { n: 1, amount: 3000, dueDate: '2026-07-10' }, { n: 2, amount: 3000, dueDate: '2026-11-10' }, { n: 3, amount: 3000, dueDate: '2027-02-10' },
    ]);
    expect(r).toEqual({ installments: 3, resplit: 0, skippedPaid: 1 });
  });
});
