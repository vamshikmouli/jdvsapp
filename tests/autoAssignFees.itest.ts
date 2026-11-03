import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { autoAssignClassFees } from '@/lib/services/fees';

// Class-fee auto-assignment against the local DB with throwaway fee types / class /
// students. Pins labels, amounts, installments, which heads are skipped, idempotence
// and the order the charges are listed in (creation order).

const T = 'ZZF' + Date.now().toString(36);
const classId = `${T}-C`;
const S1 = `${T}-1`, S2 = `${T}-2`;
let yearId = '';
const ft: Record<string, string> = {};

const chargesOf = async (studentId: string) => {
  const a = await prisma.studentFeeAssignment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: { charges: { orderBy: { createdAt: 'asc' }, include: { feeType: { select: { key: true } } } } },
  });
  // Within one head the installments share a timestamp — list them by installment no.
  const list = (a?.charges || []).map((c) => ({ head: c.feeType.key.replace(`${T}-`, ''), label: c.label.replace(`${T} `, ''), amount: c.amount, n: c.installmentNo, due: c.dueDate?.toISOString().slice(0, 10) ?? null, t: c.createdAt.getTime() }));
  return list.sort((x, y) => x.t - y.t || (x.n ?? 0) - (y.n ?? 0)).map(({ t, ...r }) => r);
};

beforeAll(async () => {
  yearId = (await prisma.academicYear.findFirst({ where: { isActive: true } }))!.id;
  await prisma.schoolClass.create({ data: { id: classId, name: `${T} STD`, order: 995, group: 'PRIMARY' } });
  const mk = async (k: string, extra: object) => (ft[k] = (await prisma.feeType.create({ data: { key: `${T}-${k}`, name: `${T} ${k}`, billingMode: 'CLASS_AMOUNT', ...extra } })).id);
  await mk('tuition', { autoAssign: true, installmentable: true, order: 1 });
  await mk('books', { autoAssign: true, order: 2 });
  await mk('exam', { autoAssign: false, order: 3 });             // only with allClassAmount
  await mk('zero', { autoAssign: true, order: 4 });              // amount 0 → skipped
  await mk('noclassfee', { autoAssign: true, order: 5 });        // no class fee row → skipped
  await mk('inactive', { autoAssign: true, active: false, order: 6 });
  const cf = await prisma.classFee.create({ data: { yearId, classId, feeTypeId: ft.tuition, amount: 12000 } });
  await prisma.classFeeInstallment.createMany({ data: [
    { classFeeId: cf.id, n: 2, amount: 6000, dueDate: new Date('2026-12-10') },
    { classFeeId: cf.id, n: 1, amount: 6000, dueDate: new Date('2026-07-10') },
  ] });
  await prisma.classFee.create({ data: { yearId, classId, feeTypeId: ft.books, amount: 1500 } });
  await prisma.classFee.create({ data: { yearId, classId, feeTypeId: ft.exam, amount: 300 } });
  await prisma.classFee.create({ data: { yearId, classId, feeTypeId: ft.zero, amount: 0 } });
  await prisma.classFee.create({ data: { yearId, classId, feeTypeId: ft.inactive, amount: 999 } });
  for (const id of [S1, S2]) await prisma.student.create({ data: { id, name: id, gender: 'M', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE', classId } });
});

afterAll(async () => {
  await prisma.studentFeeAssignment.deleteMany({ where: { studentId: { in: [S1, S2] } } });
  await prisma.student.deleteMany({ where: { id: { in: [S1, S2] } } });
  await prisma.classFee.deleteMany({ where: { classId } });
  await prisma.feeType.deleteMany({ where: { id: { in: Object.values(ft) } } });
  await prisma.schoolClass.deleteMany({ where: { id: classId } });
  await prisma.$disconnect();
});

describe('autoAssignClassFees', () => {
  it('admission: auto heads only — installments split, empty / missing / inactive heads skipped', async () => {
    expect(await autoAssignClassFees(S1, classId, yearId)).toBe(2);
    expect(await chargesOf(S1)).toEqual([
      { head: 'tuition', label: 'tuition — Installment 1', amount: 6000, n: 1, due: '2026-07-10' },
      { head: 'tuition', label: 'tuition — Installment 2', amount: 6000, n: 2, due: '2026-12-10' },
      { head: 'books', label: 'books', amount: 1500, n: null, due: null },
    ]);
  });

  it('is idempotent — heads already charged are not added again', async () => {
    expect(await autoAssignClassFees(S1, classId, yearId)).toBe(0);
    expect((await chargesOf(S1)).length).toBe(3);
  });

  it('allClassAmount adds the non-auto heads too, after the existing ones', async () => {
    expect(await autoAssignClassFees(S1, classId, yearId, true)).toBe(1);
    expect((await chargesOf(S1)).map((c) => c.head)).toEqual(['tuition', 'tuition', 'books', 'exam']);
  });

  it('a student who already has one head gets only the missing ones', async () => {
    const asg = await prisma.studentFeeAssignment.create({ data: { studentId: S2, yearId } });
    await prisma.feeCharge.create({ data: { assignmentId: asg.id, feeTypeId: ft.books, label: 'Books (manual)', amount: 1000 } });
    expect(await autoAssignClassFees(S2, classId, yearId)).toBe(1);
    expect((await chargesOf(S2)).map((c) => [c.head, c.amount])).toEqual([['books', 1000], ['tuition', 6000], ['tuition', 6000]]);
  });
});
