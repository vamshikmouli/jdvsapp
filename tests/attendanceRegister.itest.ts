import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { writeRegisterDays } from '@/lib/services/attendanceRegister';
import type { AttendanceStatus } from '@prisma/client';

// Monthly register save against the local DB, with a throwaway class + students.

const T = 'ZZR' + Date.now().toString(36);
const classId = `${T}-C`;
const S = [`${T}-1`, `${T}-2`, `${T}-3`];
const SLOT = 'MORNING';
const YY = 2026, MM = 9;

const day = (d: number) => new Date(Date.UTC(YY, MM - 1, d));
const state = async () => {
  const sessions = await prisma.attendanceSession.findMany({
    where: { classId }, orderBy: { date: 'asc' },
    include: { records: { orderBy: { studentId: 'asc' }, select: { studentId: true, status: true } } },
  });
  return sessions.map((s) => ({ day: s.date.getUTCDate(), slot: s.slot, locked: s.locked, takenBy: s.takenById, records: s.records.map((r) => [r.studentId, r.status]) }));
};
const days = (o: Record<number, [string, AttendanceStatus][]>) =>
  new Map(Object.entries(o).map(([d, recs]) => [Number(d), recs.map(([studentId, status]) => ({ studentId, status }))]));

beforeAll(async () => {
  await prisma.schoolClass.create({ data: { id: classId, name: `${T} STD`, order: 997, group: 'PRIMARY' } });
  for (const id of S) await prisma.student.create({ data: { id, name: id, gender: 'M', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE', classId } });
  // Day 3 already taken on the daily page but not submitted (unlocked) with one mark;
  // day 4 already submitted (locked) by someone else.
  const s3 = await prisma.attendanceSession.create({ data: { classId, date: day(3), slot: SLOT, locked: false, takenById: null } });
  await prisma.attendanceRecord.create({ data: { sessionId: s3.id, studentId: S[0], status: 'ABSENT' } });
  await prisma.attendanceSession.create({ data: { classId, date: day(4), slot: SLOT, locked: true, takenById: null } });
  // A different slot on day 1 must not be touched.
  await prisma.attendanceSession.create({ data: { classId, date: day(1), slot: 'AFTERNOON', locked: false } });
});

afterAll(async () => {
  await prisma.attendanceSession.deleteMany({ where: { classId } });
  await prisma.student.deleteMany({ where: { id: { in: S } } });
  await prisma.schoolClass.deleteMany({ where: { id: classId } });
  await prisma.$disconnect();
});

describe('register save', () => {
  it('creates missing days locked, locks existing ones, writes every mark', async () => {
    const written = await writeRegisterDays(classId, YY, MM, SLOT, null, days({
      1: [[S[0], 'PRESENT'], [S[1], 'ABSENT'], [S[2], 'LEAVE']],
      3: [[S[0], 'PRESENT'], [S[1], 'PRESENT']],          // existing unlocked day: S1 ABSENT → PRESENT, S2 new
      4: [[S[2], 'LATE']],                                 // existing locked day
      5: [],                                               // empty day: nothing created
    }));
    expect(written).toBe(6);
    expect(await state()).toEqual([
      { day: 1, slot: 'AFTERNOON', locked: false, takenBy: null, records: [] },
      { day: 1, slot: SLOT, locked: true, takenBy: null, records: [[S[0], 'PRESENT'], [S[1], 'ABSENT'], [S[2], 'LEAVE']] },
      { day: 3, slot: SLOT, locked: true, takenBy: null, records: [[S[0], 'PRESENT'], [S[1], 'PRESENT']] },
      { day: 4, slot: SLOT, locked: true, takenBy: null, records: [[S[2], 'LATE']] },
    ].sort((a, b) => a.day - b.day || a.slot.localeCompare(b.slot)));
  });

  it('re-save: changes only what changed, adds new students, last duplicate wins, count = cells sent', async () => {
    const written = await writeRegisterDays(classId, YY, MM, SLOT, null, days({
      1: [[S[0], 'PRESENT'], [S[1], 'PRESENT'], [S[2], 'LEAVE']],   // only S2 changed
      3: [[S[2], 'ABSENT'], [S[2], 'EXCUSED']],                     // new student, duplicate → EXCUSED
      6: [[S[0], 'ABSENT']],                                        // new day
    }));
    expect(written).toBe(6);
    const st = await state();
    expect(st.find((x) => x.day === 1 && x.slot === SLOT)!.records).toEqual([[S[0], 'PRESENT'], [S[1], 'PRESENT'], [S[2], 'LEAVE']]);
    expect(st.find((x) => x.day === 3)!.records).toEqual([[S[0], 'PRESENT'], [S[1], 'PRESENT'], [S[2], 'EXCUSED']]);
    expect(st.find((x) => x.day === 6)).toEqual({ day: 6, slot: SLOT, locked: true, takenBy: null, records: [[S[0], 'ABSENT']] });
    expect(st.filter((x) => x.slot === SLOT).every((x) => x.locked)).toBe(true);
  });

  it('nothing to write → writes nothing', async () => {
    expect(await writeRegisterDays(classId, YY, MM, SLOT, null, new Map())).toBe(0);
  });
});
