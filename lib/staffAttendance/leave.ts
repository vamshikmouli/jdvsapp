// Leave <-> attendance-day glue. Approving a leave stamps the affected days as
// LEAVE (or HALF_DAY); rejecting/cancelling an approved leave recomputes those
// days back from punches.
import { prisma } from '@/lib/db';
import type { StaffDayStatus } from '@prisma/client';
import { recomputeDay, recomputeStreakForward } from './service';

/** Inclusive list of YYYY-MM-DD keys between two dates (UTC date columns). */
export function dateKeysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 3600_000);
  }
  return out;
}

/** Working-day count for a request (half-day = 0.5; otherwise inclusive days). */
export function leaveDays(from: Date, to: Date, halfDay: boolean): number {
  const n = dateKeysBetween(from, to).length;
  return halfDay ? 0.5 : n;
}

/** Stamp the leave onto attendance days, tagging each with the leave type so it
 *  counts against that balance. */
export async function applyLeave(staffId: string, from: Date, to: Date, halfDay: boolean, type: string, halfSession?: string | null) {
  const keys = dateKeysBetween(from, to);
  const status: StaffDayStatus = halfDay ? 'HALF_DAY' : 'LEAVE';
  const hs = halfDay ? (halfSession ?? null) : null;
  for (const dk of keys) {
    const date = new Date(`${dk}T00:00:00Z`);
    await prisma.staffAttendanceDay.upsert({
      where: { staffId_date: { staffId, date } },
      update: { status, late: false, lateMinutes: 0, leaveType: type, halfSession: hs },
      create: { staffId, date, status, leaveType: type, halfSession: hs },
    });
  }
  // Leave breaks the present-streak — recompute from the first affected day forward.
  if (keys.length) await recomputeStreakForward(staffId, keys[0]);
}

/** Undo a previously-applied leave by recomputing each day from punches. */
export async function revertLeave(staffId: string, from: Date, to: Date) {
  for (const dk of dateKeysBetween(from, to)) {
    await recomputeDay(staffId, dk, { clearOverride: true });
  }
}
