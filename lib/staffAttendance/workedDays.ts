import { prisma } from '@/lib/db';
import { synthesizeDays, ATTENDANCE_START_KEY } from '@/lib/staffAttendance/schedule';

// Days the staff member showed up (half day still counts as a day attended).
const ATTENDED = new Set(['PRESENT', 'LATE', 'HALF_DAY']);
// Days that count toward the denominator (holidays / weekly-offs excluded).
const WORKING = new Set(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE']);

export interface WorkedDays {
  attended: number;     // 159
  workingDays: number;  // 180  → "159/180 days"
  fromKey: string;
  toKey: string;
}

export interface StaffSched {
  id: string;
  weekSchedule: unknown;
  workPattern: unknown;
  workDays: unknown;
}

/**
 * Academic-year start as a YYYY-MM-DD key, derived from the year id ("2026-27" →
 * June 1 2026, the Karnataka school year start). Never earlier than the date the
 * attendance system went live, since there's no data before then.
 */
export function academicYearStartKey(yearId: string | null | undefined): string {
  const y = Number(String(yearId || '').slice(0, 4));
  const k = Number.isFinite(y) && y > 2000 ? `${y}-06-01` : ATTENDANCE_START_KEY;
  return k < ATTENDANCE_START_KEY ? ATTENDANCE_START_KEY : k;
}

/**
 * Working days attended vs working days elapsed, per staff member, over
 * [fromKey, toKey]. Stored days + synthesized off/holiday/absent fill-ins, so a
 * day with no record on a working day correctly counts as a working day not
 * attended. Batched: one query for all staff.
 */
export async function workedDaysForStaff(
  staff: StaffSched[],
  opts: { fromKey: string; toKey: string; weeklyOffDays: number[] },
): Promise<Map<string, WorkedDays>> {
  const result = new Map<string, WorkedDays>();
  if (!staff.length) return result;

  const from = new Date(`${opts.fromKey}T00:00:00Z`);
  const to = new Date(`${opts.toKey}T23:59:59Z`);
  const [stored, holidays] = await Promise.all([
    prisma.staffAttendanceDay.findMany({
      where: { staffId: { in: staff.map((s) => s.id) }, date: { gte: from, lte: to } },
      select: { staffId: true, date: true, status: true },
    }),
    prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } }),
  ]);
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

  const byStaff = new Map<string, { date: string; status: string }[]>();
  for (const s of staff) byStaff.set(s.id, []);
  for (const d of stored) byStaff.get(d.staffId)?.push({ date: d.date.toISOString().slice(0, 10), status: String(d.status) });

  // ONE school-wide working-days count (standard calendar: every non-weekly-off
  // day that isn't a holiday, up to today), so every staff member shares the SAME
  // denominator — a person who comes every day shows total/total, no more, no less.
  const schoolSynth = synthesizeDays({
    fromKey: opts.fromKey, toKey: opts.toKey, todayKey: opts.toKey, existing: new Set(), holidays: holidaySet,
    weekSchedule: null, workPattern: 'FULL', workDays: null, weeklyOffDays: opts.weeklyOffDays,
  });
  const schoolWorkingDays = schoolSynth.filter((d) => WORKING.has(d.status)).length;

  for (const s of staff) {
    const rows = byStaff.get(s.id) || [];
    let attended = 0;
    for (const d of rows) if (ATTENDED.has(d.status)) attended++;
    result.set(s.id, {
      attended: Math.min(attended, schoolWorkingDays), // never exceed the shared total
      workingDays: schoolWorkingDays,
      fromKey: opts.fromKey,
      toKey: opts.toKey,
    });
  }
  return result;
}
