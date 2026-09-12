import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { recordPayment, voidPayment, getStudentAccount } from '@/lib/services/fees';

// End-to-end money flow against the local DB, with a throwaway student that is
// fully cleaned up afterwards. Validates the real DB wiring that the pure
// money-engine tests can't: charge/allocation persistence, receipt numbering,
// concession-aware validation, and void restoring the balance.

const SID = 'ZZITEST-' + Date.now();
let yearId = '';
let feeTypeId = '';
let ch1 = '';
let ch2 = '';

async function balance() {
  const acc = await getStudentAccount(SID, yearId);
  return acc!.summary.totalBalance;
}

beforeAll(async () => {
  const year = await prisma.academicYear.findFirst({ where: { isActive: true } });
  if (!year) throw new Error('No active academic year in the local DB — seed it first.');
  yearId = year.id;
  const ft = await prisma.feeType.findFirst({ where: { key: 'tuition' } }) || await prisma.feeType.findFirst();
  if (!ft) throw new Error('No fee types configured in the local DB.');
  feeTypeId = ft.id;

  await prisma.student.create({
    data: { id: SID, name: 'ZZ INTEGRATION TEST', gender: 'M', guardianName: 'TEST', guardianPhone: '0000000000', status: 'ACTIVE' },
  });
  const asg = await prisma.studentFeeAssignment.create({ data: { studentId: SID, yearId } });
  const c1 = await prisma.feeCharge.create({ data: { assignmentId: asg.id, feeTypeId, label: 'Tuition #1', amount: 5000, installmentNo: 1 } });
  const c2 = await prisma.feeCharge.create({ data: { assignmentId: asg.id, feeTypeId, label: 'Tuition #2', amount: 5000, installmentNo: 2 } });
  ch1 = c1.id; ch2 = c2.id;
});

afterAll(async () => {
  try {
    await prisma.paymentAllocation.deleteMany({ where: { payment: { studentId: SID } } });
    await prisma.payment.deleteMany({ where: { studentId: SID } });
    await prisma.concession.deleteMany({ where: { assignment: { studentId: SID } } });
    await prisma.feeCharge.deleteMany({ where: { assignment: { studentId: SID } } });
    await prisma.studentFeeAssignment.deleteMany({ where: { studentId: SID } });
    await prisma.student.deleteMany({ where: { id: SID } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('recordPayment / void — money flow', () => {
  it('starts with the full balance', async () => {
    expect(await balance()).toBe(10000);
  });

  it('records a partial payment and reduces the balance exactly', async () => {
    const pay = await recordPayment({ studentId: SID, yearId, method: 'CASH', allocations: [{ chargeId: ch1, amount: 5000 }] });
    expect(pay.receiptNo).toMatch(/^RCPT\//);
    expect(await balance()).toBe(5000);
  });

  it('refuses to allocate more than a charge balance', async () => {
    await expect(
      recordPayment({ studentId: SID, yearId, method: 'CASH', allocations: [{ chargeId: ch2, amount: 6000 }] }),
    ).rejects.toThrow(/exceeds/i);
    expect(await balance()).toBe(5000); // unchanged
  });

  it('voiding a receipt restores the balance', async () => {
    const acc = await getStudentAccount(SID, yearId);
    const live = acc!.payments.find((p: any) => !p.voided)!;
    await voidPayment(live.id, null, 'test void');
    expect(await balance()).toBe(10000);
  });

  it('an approved concession lowers payable and blocks over-allocation', async () => {
    const asg = await prisma.studentFeeAssignment.findUnique({ where: { studentId_yearId: { studentId: SID, yearId } } });
    await prisma.concession.create({ data: { assignmentId: asg!.id, feeTypeId, amount: 3000, reason: 'test', status: 'APPROVED' } });
    expect(await balance()).toBe(7000); // 10000 - 3000 concession

    // ch1 now has a concession-adjusted balance of 2000 → 5000 must be rejected.
    await expect(
      recordPayment({ studentId: SID, yearId, method: 'CASH', allocations: [{ chargeId: ch1, amount: 5000 }] }),
    ).rejects.toThrow(/exceeds/i);
    // paying exactly the adjusted balance works
    await recordPayment({ studentId: SID, yearId, method: 'CASH', allocations: [{ chargeId: ch1, amount: 2000 }] });
    expect(await balance()).toBe(5000);
  });
});
