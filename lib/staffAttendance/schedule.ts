// Per-staff work-schedule helpers: which days a staff member is expected, their
// work pattern (full / half-morning / half-afternoon), and what status an empty
// day should show (holiday / weekly-off / absent). Pure — no DB.

export type WorkPattern = 'FULL' | 'HALF_MORNING' | 'HALF_AFTERNOON';
export type Session = 'OFF' | 'MORNING' | 'AFTERNOON' | 'FULL';

// The attendance system went live on this date — never show/derive anything before it.
export const ATTENDANCE_START_KEY = '2026-06-01';
export const ATTENDANCE_START_MONTH = '2026-06';

// Short working days: the school runs a shortened schedule (Saturday, 9:40–12:30).
// On these days the normal full-day minute threshold doesn't apply — completing
// the day (a punch IN and a punch OUT) counts as a full PRESENT, not a half day.
export const SHORT_DAY_WEEKDAYS = [6]; // 6 = Saturday
export const SHORT_DAY_START = '09:40'; // late reference on short days (Saturday starts 9:40)
export function isShortDay(weekday: number): boolean {
  return SHORT_DAY_WEEKDAYS.includes(weekday);
}

export function parseWorkPattern(v: unknown): WorkPattern {
  return v === 'HALF_MORNING' || v === 'HALF_AFTERNOON' ? v : 'FULL';
}

/** Parse a per-weekday session map { 0..6: Session }. null if unset/invalid. */
export function parseWeekSchedule(raw: unknown): Record<number, Session> | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: Record<number, Session> = {};
  let any = false;
  for (let d = 0; d <= 6; d++) {
    const v = src[String(d)];
    if (v === 'OFF' || v === 'MORNING' || v === 'AFTERNOON' || v === 'FULL') {
      out[d] = v;
      any = true;
    }
  }
  return any ? out : null;
}

/** The session a staff member works on a given weekday (week schedule preferred,
 *  then legacy workPattern/workDays, else FULL on non-weekly-off days). */
export function daySession(
  weekday: number,
  weekSchedule: Record<number, Session> | null,
  legacy: { workPattern?: WorkPattern; workDays?: number[] | null },
  weeklyOffDays: number[]
): Session {
  if (weekSchedule && weekSchedule[weekday] != null) return weekSchedule[weekday];
  if (!isScheduledDay(weekday, legacy.workDays ?? null, weeklyOffDays)) return 'OFF';
  const wp = legacy.workPattern ?? 'FULL';
  return wp === 'HALF_MORNING' ? 'MORNING' : wp === 'HALF_AFTERNOON' ? 'AFTERNOON' : 'FULL';
}

export function sessionPattern(s: Session): WorkPattern {
  return s === 'MORNING' ? 'HALF_MORNING' : s === 'AFTERNOON' ? 'HALF_AFTERNOON' : 'FULL';
}

/** Empty-day status given the resolved session (holiday wins). */
export function emptyStatusForSession(session: Session, isHoliday: boolean): 'HOLIDAY' | 'WEEKLY_OFF' | 'ABSENT' {
  if (isHoliday) return 'HOLIDAY';
  return session === 'OFF' ? 'WEEKLY_OFF' : 'ABSENT';
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
  weekSchedule: Record<number, Session> | null;
  workPattern?: WorkPattern;
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
    // Nothing before the system start date, nothing in the future, nothing already stored.
    if (dk < ATTENDANCE_START_KEY || dk > opts.todayKey || opts.existing.has(dk)) continue;
    const session = daySession(weekdayOfKey(dk), opts.weekSchedule, { workPattern: opts.workPattern, workDays: opts.workDays }, opts.weeklyOffDays);
    out.push({
      date: `${dk}T00:00:00.000Z`,
      status: emptyStatusForSession(session, opts.holidays.has(dk)),
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
