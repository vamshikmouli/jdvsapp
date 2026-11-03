import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { importAttendanceGroups, writeRegisterDays } from '@/lib/services/attendanceRegister';
import type { AttendanceStatus } from '@prisma/client';

// Attendance Excel import: the new batched importAttendanceGroups must leave the DB in
// exactly the state the original per-group / per-student loop did. Same scenario run on
// two throwaway classes — A with the original loop (copied below), B with the new code.

const T = 'ZZI' + Date.now().toString(36);
const A = `${T}-A`, B = `${T}-B`;
const studs = (c: string) => [`${c}-1`, `${c}-2`, `${c}-3`];
const d = (n: number) => new Date(Date.UTC(2026, 6, n));

type Group = { classId: string; date: Date; slot: string; recs: { studentId: string; status: AttendanceStatus }[] };
async function originalImport(groups: Group[], meId: string | null) {
  let sessionsTouched = 0, recordsUpserted = 0, skippedLocked = 0;
  for (const g of groups) {
    let s = await prisma.attendanceSession.findUnique({ where: { classId_date_slot: { classId: g.classId, date: g.date, slot: g.slot } } });
    if (s?.locked) { skippedLocked += g.recs.length; continue; }
    if (!s) s = await prisma.attendanceSession.create({ data: { classId: g.classId, date: g.date, slot: g.slot, takenById: meId } });
    await prisma.$transaction(g.recs.map((rec) => prisma.attendanceRecord.upsert({
      where: { sessionId_studentId: { sessionId: s!.id, studentId: rec.studentId } },
      update: { status: rec.status }, create: { sessionId: s!.id, studentId: rec.studentId, status: rec.status },
    })));
    sessionsTouched++; recordsUpserted += g.recs.length;
  }
  return { sessionsTouched, recordsUpserted, skippedLocked };
}

const state = async (c: string) => (await prisma.attendanceSession.findMany({
  where: { classId: c }, orderBy: [{ date: 'asc' }, { slot: 'asc' }],
  include: { records: { orderBy: { studentId: 'asc' }, select: { studentId: true, status: true } } },
})).map((s) => ({ day: s.date.getUTCDate(), slot: s.slot, locked: s.locked, records: s.records.map((r) => [r.studentId.slice(-1), r.status]) }));

const scenario = (c: string): Group[] => {
  const [s1, s2, s3] = studs(c);
  return [
    { classId: c, date: d(1), slot: 'MORNING', recs: [{ studentId: s1, status: 'PRESENT' }, { studentId: s2, status: 'ABSENT' }] },   // new day
    { classId: c, date: d(2), slot: 'MORNING', recs: [{ studentId: s1, status: 'LATE' }, { studentId: s3, status: 'PRESENT' }, { studentId: s3, status: 'LEAVE' }] }, // existing open day, dup → last wins
    { classId: c, date: d(3), slot: 'MORNING', recs: [{ studentId: s1, status: 'ABSENT' }] },                                           // locked day → skipped
    { classId: c, date: d(1), slot: 'AFTERNOON', recs: [{ studentId: s3, status: 'PRESENT' }] },                                        // other session same day
  ];
};

beforeAll(async () => {
  for (const c of [A, B]) {
    await prisma.schoolClass.create({ data: { id: c, name: c, order: 993, group: 'PRIMARY' } });
    for (const id of studs(c)) await prisma.student.create({ data: { id, name: id, gender: 'M', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE', classId: c } });
    const open = await prisma.attendanceSession.create({ data: { classId: c, date: d(2), slot: 'MORNING', locked: false } });
    await prisma.attendanceRecord.create({ data: { sessionId: open.id, studentId: studs(c)[0], status: 'ABSENT' } });
    const locked = await prisma.attendanceSession.create({ data: { classId: c, date: d(3), slot: 'MORNING', locked: true } });
    await prisma.attendanceRecord.create({ data: { sessionId: locked.id, studentId: studs(c)[0], status: 'PRESENT' } });
  }
});

afterAll(async () => {
  await prisma.attendanceSession.deleteMany({ where: { classId: { in: [A, B] } } });
  await prisma.student.deleteMany({ where: { classId: { in: [A, B] } } });
  await prisma.schoolClass.deleteMany({ where: { id: { in: [A, B] } } });
  await prisma.$disconnect();
});

describe('attendance import', () => {
  it('batched import = original loop (counts and final state)', async () => {
    const ra = await originalImport(scenario(A), null);
    const rb = await importAttendanceGroups(scenario(B), null);
    expect(rb).toEqual(ra);
    expect(ra).toEqual({ sessionsTouched: 3, recordsUpserted: 6, skippedLocked: 1 });
    expect(await state(B)).toEqual(await state(A));
    expect((await state(B)).find((s) => s.day === 3)!.records).toEqual([['1', 'PRESENT']]); // locked day untouched
  });

  it('second import with changes = original loop again', async () => {
    const change = (c: string): Group[] => [{ classId: c, date: d(1), slot: 'MORNING', recs: [{ studentId: studs(c)[1], status: 'PRESENT' }, { studentId: studs(c)[2], status: 'ABSENT' }] }];
    expect(await importAttendanceGroups(change(B), null)).toEqual(await originalImport(change(A), null));
    expect(await state(B)).toEqual(await state(A));
  });

  it('register save still writes and locks (shared record writer)', async () => {
    const n = await writeRegisterDays(B, 2026, 7, 'MORNING', null, new Map([[2, [{ studentId: studs(B)[1], status: 'PRESENT' as AttendanceStatus }]]]));
    expect(n).toBe(1);
    const day2 = (await state(B)).find((s) => s.day === 2 && s.slot === 'MORNING')!;
    expect(day2.locked).toBe(true);
    expect(day2.records).toEqual([['1', 'LATE'], ['2', 'PRESENT'], ['3', 'LEAVE']]);
  });
});
