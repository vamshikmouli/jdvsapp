import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { findDuplicateReceipts, IMPORT_NOTE } from '@/lib/services/duplicateReceipts';

// Duplicate-receipt check: flags the re-upload pattern, ignores normal same-day receipts.
const T = 'ZZD' + Date.now().toString(36);
const S = `${T}-S`;
let yearId = '', ft = '';
const ch: Record<string, string> = {};
let seq = 9000;

const pay = async (date: string, allocs: [string, number][], opts: { imported?: boolean; method?: 'CASH' | 'UPI'; voided?: boolean } = {}) => {
  const total = allocs.reduce((t, [, a]) => t + a, 0);
  const p = await prisma.payment.create({ data: {
    studentId: S, yearId, receiptNo: `RCPT/${T}/${String(++seq).padStart(4, '0')}`, method: opts.method || 'CASH', total,
    paidAt: new Date(`${date}T00:00:00Z`), note: opts.imported ? IMPORT_NOTE : null, voided: !!opts.voided,
    allocations: opts.voided ? undefined : { create: allocs.map(([k, amount]) => ({ feeChargeId: ch[k], amount })) },
  } });
  return p.receiptNo;
};

beforeAll(async () => {
  yearId = (await prisma.academicYear.findFirst({ where: { isActive: true } }))!.id;
  ft = (await prisma.feeType.create({ data: { key: `${T}-k`, name: `${T} Fee`, billingMode: 'CLASS_AMOUNT' } })).id;
  await prisma.student.create({ data: { id: S, name: `${T} STUDENT`, gender: 'M', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE' } });
  const asg = await prisma.studentFeeAssignment.create({ data: { studentId: S, yearId } });
  for (const k of ['Tuition', 'Books', 'Van']) ch[k] = (await prisma.feeCharge.create({ data: { assignmentId: asg.id, feeTypeId: ft, label: k, amount: 50000 } })).id;
});
afterAll(async () => {
  await prisma.paymentAllocation.deleteMany({ where: { payment: { studentId: S } } });
  await prisma.payment.deleteMany({ where: { studentId: S } });
  await prisma.studentFeeAssignment.deleteMany({ where: { studentId: S } });
  await prisma.student.deleteMany({ where: { id: S } });
  await prisma.feeType.deleteMany({ where: { id: ft } });
  await prisma.$disconnect();
});

describe('findDuplicateReceipts', () => {
  it('flags re-upload duplicates, ignores normal receipts', async () => {
    // 01-Jul: first upload ₹500, re-upload made ₹400 with the same heads → likely duplicate.
    const a1 = await pay('2026-07-01', [['Books', 100], ['Tuition', 400]], { imported: true });
    const a2 = await pay('2026-07-01', [['Books', 100], ['Tuition', 300]], { imported: true });
    // 02-Jul: counter receipt, then the sheet upload recorded the same again → exact.
    const b1 = await pay('2026-07-02', [['Tuition', 1000]], { method: 'UPI' });
    const b2 = await pay('2026-07-02', [['Tuition', 1000]], { imported: true });
    // 03-Jul: tuition at the counter, van from the sheet — different heads → normal.
    await pay('2026-07-03', [['Tuition', 700]]);
    await pay('2026-07-03', [['Van', 900]], { imported: true });
    // 04-Jul: one uploaded receipt alone → normal.
    await pay('2026-07-04', [['Tuition', 300]], { imported: true });
    // 05-Jul: a duplicate that was already cancelled → not listed.
    await pay('2026-07-05', [['Tuition', 200]], { imported: true });
    await pay('2026-07-05', [['Tuition', 200]], { imported: true, voided: true });
    // 06-Jul: two counter receipts for the same head (no upload involved) → not this check's business.
    await pay('2026-07-06', [['Tuition', 100]]); await pay('2026-07-06', [['Tuition', 100]]);

    const r = await findDuplicateReceipts(yearId);
    const mine = r.groups.filter((g) => g.studentId === S);
    expect(mine.map((g) => g.date)).toEqual(['2026-07-01', '2026-07-02']);
    expect(mine[0].receipts.map((x) => [x.receiptNo, x.suspect, x.repeats])).toEqual([[a1, null, null], [a2, 'likely', a1]]);
    expect(mine[0].suspectTotal).toBe(400);
    expect(mine[1].receipts.map((x) => [x.receiptNo, x.suspect, x.repeats])).toEqual([[b1, null, null], [b2, 'exact', b1]]);
    expect(mine[1].receipts[1].heads).toEqual([{ name: 'Tuition', amount: 1000 }]);
  });
});
