// Per-staff work-schedule helpers: which days a staff member is expected, their
// work pattern (full / half-morning / half-afternoon), and what status an empty
// day should show (holiday / weekly-off / absent). Pure — no DB.

export type WorkPattern = 'FULL' | 'HALF_MORNING' | 'HALF_AFTERNOON';

export function parseWorkPattern(v: unknown): WorkPattern {
  return v === 'HALF_MORNING' || v === 'HALF_AFTERNOON' ? v : 'FULL';
}

/** A staff member's expected working weekdays, or null = all non-weekly-off days. */
export function parseWorkDays(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const days = raw.map((n) => Number(n)).filter((n) => n >= 0 && n <= 6);
    return days.length ? days : null;
  }
  return null;
}

/** Is this weekday a working day for the staff member? */
export function isScheduledDay(weekday: number, workDays: number[] | null, weeklyOffDays: number[]): boolean {
  if (workDays) return workDays.includes(weekday);     // alternate-day / custom staff
  return !weeklyOffDays.includes(weekday);             // normal staff: every non-off day
}

/** Weekday (0=Sun..6=Sat) for a YYYY-MM-DD key (treated as a calendar date). */
export function weekdayOfKey(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/**
 * Synthesize calendar entries for days in [fromKey, toKey] that have no stored
 * StaffAttendanceDay row, so off-days / holidays show correctly (not as blanks
 * or absents). Future days and days that already have a row are skipped.
 */
export function synthesizeDays(opts: {
  fromKey: string;
  toKey: string;
  todayKey: string;
  existing: Set<string>;
  holidays: Set<string>;
  workDays: number[] | null;
  weeklyOffDays: number[];
}): { date: string; status: string; late: boolean; synthetic: true }[] {
  const out: { date: string; status: string; late: boolean; synthetic: true }[] = [];
  let d = new Date(`${opts.fromKey}T00:00:00Z`);
  const end = new Date(`${opts.toKey}T00:00:00Z`);
  let guard = 0;
  while (d <= end && guard++ < 400) {
    const dk = d.toISOString().slice(0, 10);
    d = new Date(d.getTime() + 24 * 3600_000);
    if (dk > opts.todayKey || opts.existing.has(dk)) continue;
    out.push({
      date: `${dk}T00:00:00.000Z`,
      status: emptyDayStatus(weekdayOfKey(dk), opts.holidays.has(dk), opts.workDays, opts.weeklyOffDays),
      late: false,
      synthetic: true,
    });
  }
  return out;
}

/** Status for a day with no punches and no manual mark. */
export function emptyDayStatus(
  weekday: number,
  isHoliday: boolean,
  workDays: number[] | null,
  weeklyOffDays: number[]
): 'HOLIDAY' | 'WEEKLY_OFF' | 'ABSENT' {
  if (isHoliday) return 'HOLIDAY';
  if (!isScheduledDay(weekday, workDays, weeklyOffDays)) return 'WEEKLY_OFF';
  return 'ABSENT';
}
