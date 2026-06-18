// Student attendance gamification — streaks + badges. Pure & testable.
// A day "counts" as attended if PRESENT or LATE. ABSENT breaks a streak.
// LEAVE / EXCUSED are neutral (don't break, don't extend) and are skipped.

export interface DayStatus {
  date: string;   // YYYY-MM-DD
  status: string; // PRESENT | LATE | ABSENT | LEAVE | EXCUSED
}

const ATTENDED = (s: string) => s === 'PRESENT' || s === 'LATE';
const BREAKS = (s: string) => s === 'ABSENT';

export interface StreakStats {
  currentStreak: number;
  longestStreak: number;
  totalAttended: number;
  totalMarked: number;   // attended + absent (excludes neutral)
  pct: number;           // attendance %
  lateCount: number;
}

export function computeStreakStats(days: DayStatus[]): StreakStats {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  let longest = 0, run = 0, attended = 0, absent = 0, late = 0;
  for (const d of sorted) {
    if (d.status === 'LATE') late++;
    if (ATTENDED(d.status)) { run++; attended++; if (run > longest) longest = run; }
    else if (BREAKS(d.status)) { run = 0; absent++; }
    // neutral → leave run unchanged
  }

  // Current streak: walk backwards until the first ABSENT.
  let current = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i].status;
    if (ATTENDED(s)) current++;
    else if (BREAKS(s)) break;
    // neutral → skip
  }

  const marked = attended + absent;
  return {
    currentStreak: current,
    longestStreak: longest,
    totalAttended: attended,
    totalMarked: marked,
    pct: marked ? Math.round((attended / marked) * 100) : 0,
    lateCount: late,
  };
}

export interface Badge {
  key: string;
  label: string;
  emoji: string;
  need: number;     // streak days required (0 = special)
  earned: boolean;
  desc: string;
}

const STREAK_BADGES: Omit<Badge, 'earned'>[] = [
  { key: 'streak5', label: 'On Fire', emoji: '🔥', need: 5, desc: '5-day streak' },
  { key: 'streak10', label: 'Unstoppable', emoji: '⚡', need: 10, desc: '10-day streak' },
  { key: 'streak15', label: 'Superstar', emoji: '🌟', need: 15, desc: '15-day streak' },
  { key: 'streak30', label: 'Champion', emoji: '🏆', need: 30, desc: '30-day streak' },
  { key: 'streak50', label: 'Legend', emoji: '💎', need: 50, desc: '50-day streak' },
  { key: 'streak100', label: 'Centurion', emoji: '👑', need: 100, desc: '100-day streak' },
];

/** Did any calendar month have no absences (and a decent number of marked days)? */
function hasPerfectMonth(days: DayStatus[]): boolean {
  const byMonth = new Map<string, { marked: number; absent: number }>();
  for (const d of days) {
    if (!ATTENDED(d.status) && !BREAKS(d.status)) continue;
    const m = d.date.slice(0, 7);
    const cur = byMonth.get(m) || { marked: 0, absent: 0 };
    cur.marked++;
    if (BREAKS(d.status)) cur.absent++;
    byMonth.set(m, cur);
  }
  for (const v of byMonth.values()) if (v.marked >= 15 && v.absent === 0) return true;
  return false;
}

/** Punctual = at least 10 attended days and none of the recent ones were late. */
function isPunctual(stats: StreakStats): boolean {
  return stats.totalAttended >= 10 && stats.lateCount === 0;
}

export function earnedBadges(days: DayStatus[], stats: StreakStats): Badge[] {
  const list: Badge[] = STREAK_BADGES.map((b) => ({ ...b, earned: stats.longestStreak >= b.need }));
  list.push({ key: 'perfectMonth', label: 'Perfect Month', emoji: '📅', need: 0, desc: 'A full month, no absences', earned: hasPerfectMonth(days) });
  list.push({ key: 'punctual', label: 'Early Bird', emoji: '🐦', need: 0, desc: 'Always on time', earned: isPunctual(stats) });
  return list;
}
