// Core staff-attendance writes: record a punch (auto-deciding IN vs OUT) and
// recompute the per-day roll-up. Shared by the biometric, kiosk and manual
// (admin regularize) paths so the rules live in exactly one place.
import { prisma } from '@/lib/db';
import type { PunchSource, PunchType, StaffDayStatus } from '@prisma/client';
import { loadStaffAttConfig } from './config';
import { computeDay, localDayInfo, type PunchLite } from './rules';
import { parseWorkPattern, parseWorkDays, parseWeekSchedule, daySession, sessionPattern } from './schedule';
import { notifyStaffPunch } from '@/lib/notifications';

/** UTC window that safely brackets a local calendar day (handles tz offset). */
function dayWindow(dateKey: string): { gte: Date; lt: Date } {
  const base = new Date(`${dateKey}T00:00:00Z`).getTime();
  return { gte: new Date(base - 18 * 3600_000), lt: new Date(base + 42 * 3600_000) };
}

async function punchesForLocalDay(staffId: string, dateKey: string, tz: string) {
  const win = dayWindow(dateKey);
  const rows = await prisma.staffPunch.findMany({
    where: { staffId, at: { gte: win.gte, lt: win.lt } },
    orderBy: { at: 'asc' },
  });
  return rows.filter((p) => localDayInfo(p.at, tz).dateKey === dateKey);
}

/**
 * Recompute `currentStreak` (consecutive PRESENT days) for one staff member's
 * stored days from `fromDateKey` forward, seeded by the day before it. Call this
 * after ANY change to a day's status — a single change can lengthen or break the
 * streak for every later day, so we cascade forward. Only stored rows are walked,
 * so weekly-offs / holidays with no row don't break a streak. Idempotent.
 */
export async function recomputeStreakForward(staffId: string, fromDateKey: string): Promise<void> {
  const fromDate = new Date(`${fromDateKey}T00:00:00Z`);
  const prevDate = new Date(fromDate.getTime() - 24 * 3600_000);

  const prevRow = await prisma.staffAttendanceDay.findUnique({
    where: { staffId_date: { staffId, date: prevDate } },
    select: { status: true, currentStreak: true },
  });
  let streak = prevRow?.status === 'PRESENT' ? prevRow.currentStreak : 0;

  const days = await prisma.staffAttendanceDay.findMany({
    where: { staffId, date: { gte: fromDate } },
    orderBy: { date: 'asc' },
    select: { id: true, status: true, currentStreak: true },
  });
  for (const d of days) {
    streak = d.status === 'PRESENT' ? streak + 1 : 0;
    if (d.currentStreak !== streak) {
      await prisma.staffAttendanceDay.update({ where: { id: d.id }, data: { currentStreak: streak } });
    }
  }
}

/** Recompute and persist the StaffAttendanceDay roll-up for one local day. */
export async function recomputeDay(
  staffId: string,
  dateKey: string,
  opts: { clearOverride?: boolean } = {}
) {
  const cfg = await loadStaffAttConfig();
  const rows = await punchesForLocalDay(staffId, dateKey, cfg.timezone);

  const existing = await prisma.staffAttendanceDay.findUnique({
    where: { staffId_date: { staffId, date: new Date(`${dateKey}T00:00:00Z`) } },
  });
  // Preserve an admin-set LEAVE/HOLIDAY override when no punches contradict it,
  // unless the caller explicitly clears it (e.g. a leave was rejected/cancelled).
  const override =
    !opts.clearOverride && existing && (existing.status === 'LEAVE' || existing.status === 'HOLIDAY')
      ? (existing.status as 'LEAVE' | 'HOLIDAY')
      : undefined;

  // Per-staff schedule + school holiday for this date.
  const [staff, holiday] = await Promise.all([
    prisma.staff.findUnique({ where: { id: staffId }, select: { weekSchedule: true, workPattern: true, workDays: true } }),
    prisma.holiday.findUnique({ where: { date: new Date(`${dateKey}T00:00:00Z`) }, select: { id: true } }),
  ]);

  const lite: PunchLite[] = rows.map((p) => ({ type: p.type, at: p.at }));
  const weekday = localDayInfo(new Date(`${dateKey}T06:00:00Z`), cfg.timezone).weekday;
  // Resolve the session this staff member works on this weekday.
  const session = daySession(
    weekday,
    parseWeekSchedule(staff?.weekSchedule),
    { workPattern: parseWorkPattern(staff?.workPattern), workDays: parseWorkDays(staff?.workDays) },
    cfg.schedule.weeklyOffDays
  );
  const r = computeDay(lite, cfg.schedule, {
    override,
    weekday,
    pattern: sessionPattern(session),
    afternoonStart: cfg.schedule.afternoonStart,
    isHoliday: !!holiday,
    scheduled: session !== 'OFF',
  });

  await prisma.staffAttendanceDay.upsert({
    where: { staffId_date: { staffId, date: new Date(`${dateKey}T00:00:00Z`) } },
    update: {
      firstIn: r.firstIn,
      lastOut: r.lastOut,
      workedMinutes: r.workedMinutes,
      status: r.status as StaffDayStatus,
      late: r.late,
      lateMinutes: r.lateMinutes,
    },
    create: {
      staffId,
      date: new Date(`${dateKey}T00:00:00Z`),
      firstIn: r.firstIn,
      lastOut: r.lastOut,
      workedMinutes: r.workedMinutes,
      status: r.status as StaffDayStatus,
      late: r.late,
      lateMinutes: r.lateMinutes,
    },
  });

  // Recompute the streak for this day and cascade to any later days.
  await recomputeStreakForward(staffId, dateKey);

  return prisma.staffAttendanceDay.findUnique({
    where: { staffId_date: { staffId, date: new Date(`${dateKey}T00:00:00Z`) } },
  });
}

export interface RecordPunchInput {
  staffId: string;
  source: PunchSource;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  distanceM?: number | null;
  withinFence?: boolean;
  credentialId?: string | null;
  deviceInfo?: string | null;
  note?: string | null;
  createdById?: string | null;
  /** Force a direction (admin regularize). Otherwise auto IN/OUT. */
  forceType?: PunchType;
  /** Custom timestamp (admin regularize). Defaults to now. */
  at?: Date;
}

/**
 * Record a punch. Direction is auto-decided: if the staff member is currently
 * punched IN (open session) the punch is an OUT, otherwise an IN.
 */
export async function recordPunch(input: RecordPunchInput) {
  const cfg = await loadStaffAttConfig();
  const now = input.at ?? new Date();
  const dateKey = localDayInfo(now, cfg.timezone).dateKey;

  let type: PunchType = input.forceType ?? 'IN';
  if (!input.forceType) {
    const rows = await punchesForLocalDay(input.staffId, dateKey, cfg.timezone);
    const r = computeDay(rows.map((p) => ({ type: p.type, at: p.at })), cfg.schedule);
    type = r.open ? 'OUT' : 'IN';
  }

  const punch = await prisma.staffPunch.create({
    data: {
      staffId: input.staffId,
      type,
      at: now,
      source: input.source,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      accuracy: input.accuracy ?? null,
      distanceM: input.distanceM ?? null,
      withinFence: input.withinFence ?? true,
      credentialId: input.credentialId ?? null,
      deviceInfo: input.deviceInfo ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });

  const day = await recomputeDay(input.staffId, dateKey);

  // Alert staff-attendance watchers (bell + Web Push). Real punches only —
  // skip MANUAL admin regularizations, which aren't a live in/out event.
  // Best-effort: notifyStaffPunch swallows its own errors.
  if (input.source !== 'MANUAL') {
    await notifyStaffPunch({ staffId: input.staffId, type, at: now, timezone: cfg.timezone });
  }

  return { punch, day, type };
}
