// Gamification layer — derives levels, XP, coins and badges from data the app
// ALREADY has (attendance, streak, fees, and optionally the marks report). No
// new backend yet; these rules are v1 and easy to tune. Kept in one place so the
// Home, Rewards and Attendance screens stay consistent.

export interface GameChild {
  name: string;
  className: string;
  todayStatus: string;
  present: number;
  absent: number;
  leave: number;
  marked: number;
  pct: number;
  days?: { date: string; status: string }[];
  fee?: { totalCharged: number; totalPaid: number; totalBalance: number } | null;
  streak?: { current: number; longest: number };
}

const XP_PER_LEVEL = 250;

const TITLES = ['New Star', 'Bright Spark', 'Curious Mind', 'Rising Scholar', 'Star Scholar', 'Champion Scholar'];

export interface LevelInfo {
  level: number;
  title: string;
  xp: number;        // total career-ish XP (this term)
  xpInto: number;    // XP into the current level
  xpForLevel: number;
  xpToNext: number;
  progress: number;  // 0..1 within the level
}

export function deriveLevel(c: GameChild): LevelInfo {
  const streak = c.streak?.current ?? 0;
  const feeClear = c.fee ? c.fee.totalBalance <= 0 : false;
  const xp = c.present * 15 + streak * 10 + (feeClear ? 100 : 0) + (c.pct >= 90 ? 60 : 0);
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpInto = xp % XP_PER_LEVEL;
  return {
    level,
    title: TITLES[Math.min(level - 1, TITLES.length - 1)],
    xp,
    xpInto,
    xpForLevel: XP_PER_LEVEL,
    xpToNext: XP_PER_LEVEL - xpInto,
    progress: xpInto / XP_PER_LEVEL,
  };
}

export function deriveCoins(c: GameChild, earnedBadges: number): number {
  return c.present * 10 + earnedBadges * 20 + (c.streak?.current ?? 0) * 5;
}

// ─────────────────────────────────────────────────────────────────────────
// SIMPLE model (for rural / low-literacy parents): a 0–5 STAR rating based on
// how regularly the child attends, plus a few clear, concrete badges. No XP,
// no coins, no level numbers — just stars and plain words.
// ─────────────────────────────────────────────────────────────────────────

export interface Stars {
  stars: number;   // 0..5
  label: string;   // plain-language meaning
}

/** Star rating from this month's attendance %. More stars = comes more often. */
export function deriveStars(c: GameChild): Stars {
  if (!c.marked) return { stars: 0, label: 'No attendance yet' };
  const pct = c.pct;
  let stars: number;
  if (pct >= 95) stars = 5;
  else if (pct >= 85) stars = 4;
  else if (pct >= 70) stars = 3;
  else if (pct >= 50) stars = 2;
  else stars = 1;
  const labels = [
    'No attendance yet',
    'Please send them more often',
    'Coming sometimes',
    'Coming well',
    'Very regular — well done!',
    'Comes every day! ⭐',
  ];
  return { stars, label: labels[stars] };
}

/**
 * The few clear badges a parent can understand at a glance. `report` is optional
 * (marks-based badge lights up once results are published).
 */
export function deriveSimpleBadges(c: GameChild, report?: MarksLike | null): Badge[] {
  const streak = c.streak?.current ?? 0;
  const feeClear = c.fee ? c.fee.totalBalance <= 0 : false;
  const topGrade = report?.assessments?.some((a) => a.grade === 'A' || a.grade === 'A+') ?? false;
  const goodAttendance = c.marked > 0 && c.pct >= 90;

  const list: Badge[] = [
    { key: 'attendance', name: 'Good Attendance', emoji: '🎯', tone: 'grass', earned: goodAttendance, progress: goodAttendance ? 'Came 90%+ this month' : 'Come regularly to earn' },
    { key: 'regular', name: 'Came Every Day', emoji: '🔥', tone: 'gold', earned: streak >= 5, progress: streak >= 5 ? `${streak} days in a row` : 'Come 5 days in a row' },
    { key: 'topmarks', name: 'Top Marks', emoji: '🏅', tone: 'violet', earned: topGrade, progress: topGrade ? 'Scored grade A' : 'Score an A in exams' },
    { key: 'fees', name: 'Fees Paid', emoji: '💰', tone: 'sky', earned: feeClear, progress: feeClear ? 'All fees cleared' : 'Pay fees to earn' },
  ];
  return list.sort((a, b) => Number(b.earned) - Number(a.earned));
}

export type BadgeTone = 'gold' | 'violet' | 'grass' | 'sky';
export interface Badge {
  key: string;
  name: string;
  emoji: string;
  tone: BadgeTone;
  earned: boolean;
  progress: string; // short caption ("5/5 days", "12 / 30 days", "Grade A")
}

/** Count trailing school days (skip weekends / unmarked) that were present. */
function lastSchoolDaysPresent(days: { date: string; status: string }[] | undefined, need: number): boolean {
  if (!days || !days.length) return false;
  let seen = 0;
  for (let i = days.length - 1; i >= 0 && seen < need; i--) {
    const st = days[i].status;
    if (st === 'none') continue; // holiday / weekend / not marked — skip, streak-protected
    seen += 1;
    if (st !== 'PRESENT' && st !== 'LATE') return false;
  }
  return seen >= need;
}

export interface MarksLike {
  assessments: { grade: string | null; percent: number | null; subjects: { grade: string | null; gradeOnly: boolean }[] }[];
}

/**
 * The child's badge shelf — earned + locked with progress. `report` is optional;
 * when the marks report is available (Rewards screen) the marks-based badges
 * light up too.
 */
export function deriveBadges(c: GameChild, report?: MarksLike | null): Badge[] {
  const streak = c.streak?.current ?? 0;
  const longest = c.streak?.longest ?? 0;
  const feeClear = c.fee ? c.fee.totalBalance <= 0 : false;
  const topGrade = report?.assessments?.some((a) => a.grade === 'A' || a.grade === 'A+') ?? false;
  const century = report?.assessments?.some((a) => (a.percent ?? 0) >= 100) ?? false;
  const allA = report?.assessments?.some(
    (a) => a.subjects.length > 0 && a.subjects.every((s) => (s.grade ? s.grade.startsWith('A') : true)),
  ) ?? false;

  const list: Badge[] = [
    { key: 'earlybird', name: 'Early Bird', emoji: '🐦', tone: 'gold', earned: c.marked > 0 && c.absent === 0, progress: 'On time this month' },
    { key: 'perfectweek', name: 'Perfect Week', emoji: '🎯', tone: 'violet', earned: lastSchoolDaysPresent(c.days, 5), progress: '5 present in a row' },
    { key: 'onaroll', name: 'On a Roll', emoji: '🔥', tone: 'gold', earned: streak >= 7, progress: streak >= 7 ? 'Streak ≥ 7' : `${streak}/7 days` },
    { key: 'topmarks', name: 'Top Marks', emoji: '🏅', tone: 'grass', earned: topGrade, progress: topGrade ? 'Grade A' : 'Score an A' },
    { key: 'starpayer', name: 'Star Payer', emoji: '💫', tone: 'sky', earned: feeClear, progress: feeClear ? 'Fees cleared' : 'Pay on time' },
    { key: 'perfectmonth', name: 'Perfect Month', emoji: '🌟', tone: 'violet', earned: c.pct >= 100 && c.marked > 0, progress: c.marked ? `${c.pct}% this month` : '100% attendance' },
    { key: 'thirtyday', name: '30-Day Hero', emoji: '🦸', tone: 'gold', earned: longest >= 30, progress: `${Math.min(longest, 30)} / 30 days` },
    { key: 'centurion', name: 'Century Club', emoji: '💯', tone: 'grass', earned: century, progress: 'Score 100%' },
    { key: 'allrounder', name: 'All-Rounder', emoji: '🎓', tone: 'violet', earned: allA, progress: 'A in every subject' },
  ];
  // earned first, keep stable order within each group
  return list.sort((a, b) => Number(b.earned) - Number(a.earned));
}

export const TONE_GRAD: Record<BadgeTone, readonly [string, string]> = {
  gold: ['#fff0cf', '#ffd06b'],
  violet: ['#efe7fe', '#c9b3fb'],
  grass: ['#d6f7ea', '#8fe6c4'],
  sky: ['#d9f1fd', '#93dbf8'],
};
