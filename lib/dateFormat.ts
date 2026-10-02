// One date format for the whole app: 02-Oct-2026 (and 02-Oct-2026, 09:44 PM).
// Works the same in the browser and on the server (VM clock is UTC): timestamps are
// shown in India time; plain 'YYYY-MM-DD' dates are taken as-is (no timezone shift).

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TZ = 'Asia/Kolkata';
type DateIn = Date | string | number | null | undefined;

interface Parts { y: number; m: number; d: number; hh: number; mm: number; wd: number; hasTime: boolean }

function parts(v: DateIn): Parts | null {
  if (v == null || v === '') return null;
  // Plain calendar date ("2026-10-02") — no time, no timezone conversion.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return { y, m, d, hh: 0, mm: 0, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), hasTime: false };
  }
  const dt = v instanceof Date ? v : new Date(v);
  if (isNaN(dt.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(dt)) p[x.type] = x.value;
  const wdIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, wd: wdIdx, hasTime: true };
}

const dd = (n: number) => String(n).padStart(2, '0');
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 02-Oct-2026 */
export function fmtDate(v: DateIn): string {
  const p = parts(v);
  return p ? `${dd(p.d)}-${MON[p.m - 1]}-${p.y}` : '';
}

/** 02-Oct (short lists where the year is obvious) */
export function fmtDayMonth(v: DateIn): string {
  const p = parts(v);
  return p ? `${dd(p.d)}-${MON[p.m - 1]}` : '';
}

/** 09:44 PM */
export function fmtTime(v: DateIn): string {
  const p = parts(v);
  if (!p) return '';
  const h12 = p.hh % 12 || 12;
  return `${dd(h12)}:${dd(p.mm)} ${p.hh < 12 ? 'AM' : 'PM'}`;
}

/** 02-Oct-2026, 09:44 PM */
export function fmtDateTime(v: DateIn): string {
  const p = parts(v);
  return p ? `${fmtDate(v)}, ${fmtTime(v)}` : '';
}

/** Fri, 02-Oct-2026  (long = true → Friday, 02-Oct-2026) */
export function fmtDateWeekday(v: DateIn, long = false): string {
  const p = parts(v);
  return p ? `${(long ? WD_LONG : WD_SHORT)[p.wd]}, ${fmtDate(v)}` : '';
}
