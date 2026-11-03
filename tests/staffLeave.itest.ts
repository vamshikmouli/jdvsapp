import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { applyLeave } from '@/lib/staffAttendance/leave';
import { recomputeStreakForward } from '@/lib/staffAttendance/service';

// Leave stamping + present-streak cascade on a throwaway staff member.
let staffId = '';
const D = (n: number) => new Date(Date.UTC(2026, 5, n));
const days = async () => (await prisma.staffAttendanceDay.findMany({ where: { staffId }, orderBy: { date: 'asc' } }))
  .map((d) => [d.date.getUTCDate(), d.status, d.leaveType, d.halfSession, d.currentStreak]);

beforeAll(async () => {
  staffId = (await prisma.staff.create({ data: { name: 'ZZ STAFF TEST ' + Date.now() } })).id;
  // 1..6 June present (a stored row each), streaks deliberately stale (0).
  await prisma.staffAttendanceDay.createMany({ data: [1, 2, 3, 4, 5, 6].map((n) => ({ staffId, date: D(n), status: 'PRESENT' as const, currentStreak: 0 })) });
});
afterAll(async () => {
  await prisma.staffAttendanceDay.deleteMany({ where: { staffId } });
  await prisma.staff.deleteMany({ where: { id: staffId } });
  await prisma.$disconnect();
});

describe('staff leave + streaks', () => {
  it('streak cascade fixes every later day', async () => {
    await recomputeStreakForward(staffId, '2026-06-01');
    expect((await days()).map((d) => d[4])).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('a 2-day leave stamps both days (and a new 7th) and breaks the streak forward', async () => {
    await applyLeave(staffId, D(3), D(4), false, 'SICK');
    await applyLeave(staffId, D(7), D(7), true, 'EARNED', 'MORNING');
    expect(await days()).toEqual([
      [1, 'PRESENT', null, null, 1], [2, 'PRESENT', null, null, 2],
      [3, 'LEAVE', 'SICK', null, 0], [4, 'LEAVE', 'SICK', null, 0],
      [5, 'PRESENT', null, null, 1], [6, 'PRESENT', null, null, 2],
      [7, 'HALF_DAY', 'EARNED', 'MORNING', 0],
    ]);
  });
});
