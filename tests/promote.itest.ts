import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { copyEnrollments } from '@/lib/services/enrollment';

// Promotions (copy enrollments to the next year) on throwaway years + classes.
const T = 'ZZP' + Date.now().toString(36);
const YS = `${T}-ys`, YT = `${T}-yt`;
const C1 = `${T}-c1`, C2 = `${T}-c2`, C3 = `${T}-c3`; // orders 9901, 9902, 9903 — C3 is the last class
const S = [1, 2, 3, 4, 5].map((i) => `${T}-s${i}`);
let secC1A = '', secC2A = '';

const target = async () => (await prisma.enrollment.findMany({ where: { yearId: YT }, orderBy: { studentId: 'asc' }, include: { section: { select: { name: true } } } }))
  .map((e) => [e.studentId.slice(-2), e.classId.slice(-2), e.section?.name ?? null, e.roll, e.status]);

beforeAll(async () => {
  await prisma.academicYear.createMany({ data: [{ id: YS, label: YS }, { id: YT, label: YT }] });
  await prisma.schoolClass.createMany({ data: [
    { id: C1, name: `${T} 1`, order: 9901, group: 'PRIMARY' }, { id: C2, name: `${T} 2`, order: 9902, group: 'PRIMARY' }, { id: C3, name: `${T} 3`, order: 9903, group: 'PRIMARY' },
  ] });
  secC1A = (await prisma.section.create({ data: { classId: C1, name: 'A' } })).id;
  secC2A = (await prisma.section.create({ data: { classId: C2, name: 'A' } })).id;
  await prisma.section.create({ data: { classId: C2, name: 'B' } });
  for (const id of S) await prisma.student.create({ data: { id, name: id, gender: 'F', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE' } });
  await prisma.enrollment.createMany({ data: [
    { studentId: S[0], yearId: YS, classId: C1, sectionId: secC1A, roll: '01' },  // → C2 section A
    { studentId: S[1], yearId: YS, classId: C1, roll: '02' },                     // → C2, no section
    { studentId: S[2], yearId: YS, classId: C3, roll: '03' },                     // last class → graduated
    { studentId: S[3], yearId: YS, classId: C2, roll: '04' },                     // already has a target enrollment
    { studentId: S[4], yearId: YS, classId: C1, roll: '05', status: 'INACTIVE' }, // not active → ignored
  ] });
  await prisma.enrollment.create({ data: { studentId: S[3], yearId: YT, classId: C1, roll: '99' } });
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { studentId: { in: S } } });
  await prisma.student.deleteMany({ where: { id: { in: S } } });
  await prisma.schoolClass.deleteMany({ where: { id: { in: [C1, C2, C3] } } });
  await prisma.academicYear.deleteMany({ where: { id: { in: [YS, YT] } } });
  await prisma.$disconnect();
});

describe('copyEnrollments', () => {
  it('promotes active students, matches sections by name, graduates the last class, skips existing', async () => {
    const r = await copyEnrollments({ sourceYearId: YS, targetYearId: YT, shift: 1 });
    expect(r).toEqual({ source: 4, created: 2, graduated: 1, noClass: 0, skippedExisting: 1 });
    expect(await target()).toEqual([
      ['s1', 'c2', 'A', '01', 'ACTIVE'],
      ['s2', 'c2', null, '02', 'ACTIVE'],
      ['s4', 'c1', null, '99', 'ACTIVE'],
    ]);
  });

  it('overwrite: existing target enrollments get the new class/section only (roll kept)', async () => {
    const r = await copyEnrollments({ sourceYearId: YS, targetYearId: YT, shift: 1, overwrite: true });
    expect(r).toEqual({ source: 4, created: 3, graduated: 1, noClass: 0, skippedExisting: 0 });
    expect(await target()).toEqual([
      ['s1', 'c2', 'A', '01', 'ACTIVE'],
      ['s2', 'c2', null, '02', 'ACTIVE'],
      ['s4', 'c3', null, '99', 'ACTIVE'],
    ]);
  });

  it('shift -1: first class has no previous → noClass', async () => {
    const r = await copyEnrollments({ sourceYearId: YS, targetYearId: YT, shift: -1, overwrite: true });
    expect(r.noClass).toBe(2); // the two C1 students
    expect((await target()).find((x) => x[0] === 's3')).toEqual(['s3', 'c2', null, '03', 'ACTIVE']);
  });

  it('rejects same / missing years', async () => {
    await expect(copyEnrollments({ sourceYearId: YS, targetYearId: YS, shift: 1 })).rejects.toThrow('must differ');
  });
});
