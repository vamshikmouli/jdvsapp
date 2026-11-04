import { prisma } from '@/lib/db';
import {
  synthesizeDays, parseWeekSchedule, parseWorkPattern, parseWorkDays, ATTENDANCE_START_KEY,
} from '@/lib/staffAttendance/schedule';

// Credit for a day: a full day attended = 1, a half day = 0.5 (so two half days
// = one day lost). Anything else (absent / leave / off) = 0.
const ATTENDED_CREDIT: Record<string, number> = { PRESENT: 1, LATE: 1, HALF_DAY: 0.5 };
// Statuses that show the person was actually on the rolls that day — used to find
// their first recorded day when no joining date is set.
const ACTIVE = new Set(['PRESENT', 'LATE', 'HALF_DAY', 'LEAVE']);
// Days that count toward the denominator (holidays / weekly-offs excluded).
const WORKING = new Set(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE']);

export interface WorkedDays {
  attended: number;     // 158.5 (half days count 0.5)
  workingDays: number;  // 180  → "158.5/180 days"
  fromKey: string;
  toKey: string;
}

export interface StaffSched {
  id: string;
  weekSchedule: unknown;
  workPattern: unknown;
  workDays: unknown;
  joiningDate?: Date | string | null; // counts from here if later than the year start
}

/** A Date / ISO string / date-key → YYYY-MM-DD key, or null. */
function dateKeyOf(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
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

  for (const s of staff) {
    // Each staff member is counted ONLY from the later of the academic-year start
    // and their own joining date — so someone who joined in September isn't measured
    // against (and penalised for) the months before they started. Their own schedule
    // (alternate-day / custom week) and any extra days off fall out naturally, since
    // the denominator is built from their own working days, not a shared total.
    // No joining date on file → start from their first recorded day instead, so a
    // late joiner isn't marked absent for the months before they started.
    const allRows = byStaff.get(s.id) || [];
    const firstKey = allRows.filter((d) => ACTIVE.has(d.status)).map((d) => d.date).sort()[0] ?? null;
    const startKey = dateKeyOf(s.joiningDate) ?? firstKey;
    const fromKey = startKey && startKey > opts.fromKey ? startKey : opts.fromKey;

    const rows = allRows.filter((d) => d.date >= fromKey);
    const ws = parseWeekSchedule(s.weekSchedule);
    const wd = parseWorkDays(s.workDays);
    const wp = parseWorkPattern(s.workPattern);

    // Fill the gaps (no stored row) with their expected status, so a working day they
    // didn't record counts as a working day not attended — but a weekly-off / holiday
    // doesn't count toward the denominator.
    const existing = new Set(rows.map((d) => d.date));
    const synth = synthesizeDays({
      fromKey, toKey: opts.toKey, todayKey: opts.toKey, existing, holidays: holidaySet,
      weekSchedule: ws, workPattern: wp, workDays: wd, weeklyOffDays: opts.weeklyOffDays,
    });

    let attended = 0;
    let workingDays = 0;
    for (const d of rows) { attended += ATTENDED_CREDIT[d.status] ?? 0; if (WORKING.has(d.status)) workingDays++; }
    for (const d of synth) if (WORKING.has(d.status)) workingDays++;

    result.set(s.id, {
      attended: Math.min(attended, workingDays), // never exceed the total
      workingDays,
      fromKey,
      toKey: opts.toKey,
    });
  }
  return result;
}
