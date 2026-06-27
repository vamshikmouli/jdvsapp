// Staff attendance streak — computed LIVE from stored day rows, never stored.
// Showing up keeps the streak alive; a leave or unexcused absence restarts it;
// holidays / weekly-offs (and days with no record at all) are transparent.
// Because it's recomputed on every read, retroactive changes — a leave approved
// or rejected later, an admin regularization — are always reflected with no
// backfill step. The streak naturally begins at the first stored day (the system
// went live on June 1, 2026), so days before that simply don't exist to count.

const CONTINUES = new Set(['PRESENT', 'LATE', 'HALF_DAY']); // they showed up
const RESTARTS = new Set(['LEAVE', 'ABSENT']);              // breaks the streak
// HOLIDAY / WEEKLY_OFF / unknown → skipped (neither counts nor breaks)

export interface StreakDay {
  date: Date | string; // Date row or YYYY-MM-DD
  status: string;
}

function toKey(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Consecutive "showed up" days as of `asOfKey` (YYYY-MM-DD). Walks backward from
 * the most recent day on/before asOfKey, counting present-ish days, stopping at
 * the first leave/absence, skipping holidays / weekly-offs / gaps.
 */
export function currentStreak(days: StreakDay[], asOfKey: string): number {
  const sorted = days
    .map((d) => ({ key: toKey(d.date), status: d.status }))
    .filter((d) => d.key <= asOfKey)
    .sort((a, b) => b.key.localeCompare(a.key)); // newest first

  let n = 0;
  for (const d of sorted) {
    if (CONTINUES.has(d.status)) n++;
    else if (RESTARTS.has(d.status)) break;
    // else: holiday / weekly-off / unknown → skip, keep walking
  }
  return n;
}
