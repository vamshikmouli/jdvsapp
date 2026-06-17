// Late / half-day rules for staff attendance. All thresholds come from Settings
// so the school can tune them without code changes. Times are evaluated in the
// school's timezone (Settings.timezone, default Asia/Kolkata).

export type DayStatus =
  | 'PRESENT'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'LEAVE'
  | 'HOLIDAY'
  | 'WEEKLY_OFF';

export interface ScheduleConfig {
  timezone: string;
  shiftStart: string;   // "HH:mm"
  shiftEnd: string;     // "HH:mm"
  lateGraceMins: number;
  halfDayMins: number;
  fullDayMins: number;
  weeklyOffDays: number[]; // 0=Sun .. 6=Sat
}

export interface PunchLite {
  type: 'IN' | 'OUT';
  at: Date;
}

export interface DayResult {
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number; // completed IN→OUT pairs only
  open: boolean;         // currently punched IN with no matching OUT
  openInAt: Date | null;
  status: DayStatus;
  late: boolean;
  lateMinutes: number;
}

/** Parse "HH:mm" into minutes since midnight. */
export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Local-day info for an instant, in the given IANA timezone. */
export function localDayInfo(at: Date, tz: string): {
  dateKey: string; // YYYY-MM-DD
  minutesOfDay: number;
  weekday: number; // 0=Sun..6=Sat
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const minutesOfDay = hour * 60 + parseInt(get('minute'), 10);
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return { dateKey, minutesOfDay, weekday: weekdayMap[get('weekday')] ?? 0 };
}

/**
 * Compute a staff member's day from their punches (already filtered to one
 * local day) plus an optional manual override (leave/holiday set by admin).
 *
 * Status precedence: LEAVE/HOLIDAY/WEEKLY_OFF (when no punches) > ABSENT >
 * HALF_DAY > PRESENT. `late` is an independent flag — a late arrival that still
 * meets full hours stays PRESENT but with late=true.
 */
export function computeDay(
  punches: PunchLite[],
  cfg: ScheduleConfig,
  opts: { override?: 'LEAVE' | 'HOLIDAY'; weekday?: number } = {}
): DayResult {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());

  // Pair IN→OUT chronologically; sum completed pairs.
  let workedMs = 0;
  let openInAt: Date | null = null;
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;
  for (const p of sorted) {
    if (p.type === 'IN') {
      if (!firstIn) firstIn = p.at;
      if (!openInAt) openInAt = p.at; // ignore duplicate INs while already in
    } else {
      lastOut = p.at;
      if (openInAt) {
        workedMs += p.at.getTime() - openInAt.getTime();
        openInAt = null;
      }
    }
  }
  const open = openInAt != null;
  const workedMinutes = Math.round(workedMs / 60000);

  // Late: first IN after shiftStart + grace.
  let late = false;
  let lateMinutes = 0;
  if (firstIn) {
    const { minutesOfDay } = localDayInfo(firstIn, cfg.timezone);
    const threshold = parseHm(cfg.shiftStart) + cfg.lateGraceMins;
    if (minutesOfDay > threshold) {
      late = true;
      lateMinutes = minutesOfDay - parseHm(cfg.shiftStart);
    }
  }

  // Status.
  let status: DayStatus;
  if (sorted.length === 0) {
    if (opts.override === 'LEAVE') status = 'LEAVE';
    else if (opts.override === 'HOLIDAY') status = 'HOLIDAY';
    else if (opts.weekday != null && cfg.weeklyOffDays.includes(opts.weekday)) status = 'WEEKLY_OFF';
    else status = 'ABSENT';
  } else if (open) {
    // Still at work — optimistic until they punch out.
    status = 'PRESENT';
  } else if (workedMinutes >= cfg.fullDayMins) {
    status = 'PRESENT';
  } else if (workedMinutes >= cfg.halfDayMins) {
    status = 'HALF_DAY';
  } else {
    status = 'ABSENT';
  }

  return { firstIn, lastOut, workedMinutes, open, openInAt, status, late, lateMinutes };
}
