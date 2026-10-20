import { prisma } from '@/lib/db';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import {
  synthesizeDays, parseWeekSchedule, parseWorkPattern, parseWorkDays,
} from '@/lib/staffAttendance/schedule';
import { toWaNumber, sendTextTemplate } from '@/lib/services/whatsapp';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SCHOOL = 'Jnana Deepika Vidhya Samsthe';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Days that count as "working" (holiday / weekly-off are excluded).
const WORKING = new Set(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE']);

export interface HalfMonthWindow {
  fromKey: string; // YYYY-MM-DD
  toKey: string;   // YYYY-MM-DD
  label: string;   // "1–15 Oct 2026"
  key: string;     // "2026-10-H1"
}

/**
 * The most recently COMPLETED half-month window, relative to an IST date.
 * Run on the 16th → covers the 1st–15th of this month.
 * Run on the 1st  → covers the 16th–end of last month.
 */
export function completedHalfMonth(ist: Date): HalfMonthWindow {
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-based
  const day = ist.getUTCDate();
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();

  let wy = y, wm = m, start: number, end: number, half: 1 | 2;
  if (day >= 16) {
    start = 1; end = 15; half = 1; // first half of current month
  } else {
    // second half of previous month
    wm = m - 1;
    if (wm < 0) { wm = 11; wy = y - 1; }
    start = 16; end = lastDay(wy, wm); half = 2;
  }
  const mm = String(wm + 1).padStart(2, '0');
  return {
    fromKey: `${wy}-${mm}-${String(start).padStart(2, '0')}`,
    toKey: `${wy}-${mm}-${String(end).padStart(2, '0')}`,
    label: `${start}–${end} ${MONTHS_SHORT[wm]} ${wy}`,
    key: `${wy}-${mm}-H${half}`,
  };
}

type Tier = 'perfect' | 'excellent' | null;

interface StaffTally {
  working: number; present: number; late: number; half: number; absent: number; leave: number;
  effectiveWorking: number; attended: number; score: number; tier: Tier;
}

function classify(days: { status: string; late: boolean | null }[]): StaffTally {
  let present = 0, late = 0, half = 0, absent = 0, leave = 0;
  for (const d of days) {
    if (!WORKING.has(d.status)) continue;
    switch (d.status) {
      case 'PRESENT': if (d.late) late++; else present++; break;
      case 'LATE': late++; break;
      case 'HALF_DAY': half++; break;
      case 'ABSENT': absent++; break;
      case 'LEAVE': leave++; break;
    }
  }
  const working = present + late + half + absent + leave;
  const effectiveWorking = working - leave; // approved leave is neutral, not a penalty
  const attended = present + late + half;
  const score = effectiveWorking > 0 ? (present + late + 0.5 * half) / effectiveWorking : 0;

  let tier: Tier = null;
  if (effectiveWorking > 0 && absent === 0) {
    if (leave === 0 && half === 0 && late === 0 && present === working) tier = 'perfect';
    else if (score >= 0.95) tier = 'excellent';
  }
  return { working, present, late, half, absent, leave, effectiveWorking, attended, score, tier };
}

export interface AppreciationOpts {
  window?: HalfMonthWindow;  // defaults to the completed half-month for "now"
  dry?: boolean;             // compute + classify, but don't send
  onlyStaffId?: string | null;
  toOverride?: string | null;
  templateName?: string;
  lang?: string;
}

/**
 * Appreciate staff for attendance over the completed 15-day window.
 * Two tiers: "perfect" (present on-time every working day) and "excellent"
 * (≥95%, no unexcused absence — approved leave is neutral). Others get nothing.
 * Sends a WhatsApp text template to each qualifying, opted-in staff member.
 */
export async function runStaffAppreciation(opts: AppreciationOpts = {}) {
  const win = opts.window || completedHalfMonth(new Date(Date.now() + 5.5 * 3600_000));
  const templateName = opts.templateName || process.env.WHATSAPP_STAFF_APPRECIATION_TEMPLATE || 'staff_attendance_appreciation';
  const lang = opts.lang || process.env.WHATSAPP_STAFF_APPRECIATION_LANG || 'en';

  const cfg = await loadStaffAttConfig();
  const from = new Date(`${win.fromKey}T00:00:00Z`);
  const to = new Date(`${win.toKey}T23:59:59Z`);

  const staff = await prisma.staff.findMany({
    where: {
      archived: false,
      attendanceTracked: true,
      waReportOptIn: true,
      ...(opts.onlyStaffId ? { id: opts.onlyStaffId } : {}),
    },
    select: {
      id: true, name: true, designation: true, phone: true,
      weekSchedule: true, workPattern: true, workDays: true,
    },
    orderBy: { name: 'asc' },
  });

  const holidays = await prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } });
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

  const results = { qualified: 0, sent: 0, skipped: 0, failed: 0, perfect: 0, excellent: 0, details: [] as any[] };
  const deliveries: WaDeliveryInput[] = [];
  const batchId = `staffappreciation-${win.key}-${Date.now()}`;

  for (const s of staff) {
    try {
      const stored = await prisma.staffAttendanceDay.findMany({
        where: { staffId: s.id, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      });
      const existing = new Set(stored.map((d) => d.date.toISOString().slice(0, 10)));
      const synthetic = synthesizeDays({
        fromKey: win.fromKey, toKey: win.toKey, todayKey: win.toKey, existing, holidays: holidaySet,
        weekSchedule: parseWeekSchedule(s.weekSchedule),
        workPattern: parseWorkPattern(s.workPattern),
        workDays: parseWorkDays(s.workDays),
        weeklyOffDays: cfg.schedule.weeklyOffDays,
      });
      const days = [
        ...stored.map((d) => ({ status: String(d.status), late: d.late })),
        ...synthetic.map((d: any) => ({ status: String(d.status), late: !!d.late })),
      ];

      const t = classify(days);
      if (!t.tier) { results.details.push({ name: s.name, status: 'not-qualified', score: Math.round(t.score * 100) }); continue; }

      results.qualified++;
      if (t.tier === 'perfect') results.perfect++; else results.excellent++;

      const firstName = s.name.split(' ')[0] || s.name;
      const tierWord = t.tier === 'perfect' ? 'perfect' : 'excellent';
      const stat = t.tier === 'perfect'
        ? `${win.label} (present all ${t.working} working days)`
        : `${win.label} (present ${t.attended}/${t.effectiveWorking} days)`;

      if (opts.dry) { results.details.push({ name: s.name, status: 'qualified', tier: t.tier, stat }); continue; }

      const wa = toWaNumber(opts.toOverride || s.phone);
      if (!wa) { results.skipped++; results.details.push({ name: s.name, status: 'skipped', reason: 'no valid phone', tier: t.tier }); continue; }

      const send = await sendTextTemplate({ to: wa, templateName, lang, bodyParams: [firstName, tierWord, stat] });
      if (send.ok) { results.sent++; results.details.push({ name: s.name, status: 'sent', tier: t.tier, to: wa, id: send.id }); }
      else { results.failed++; results.details.push({ name: s.name, status: 'failed', tier: t.tier, to: wa, error: send.error }); }
      deliveries.push({
        kind: 'STAFF_APPRECIATION', batchId, title: `Attendance appreciation · ${win.label}`,
        studentName: s.name, recipient: s.name, phone: wa,
        ok: send.ok, error: send.ok ? null : (send.error || 'send failed'), wamid: send.id,
      });
      await sleep(350);
    } catch (e: any) {
      results.failed++;
      results.details.push({ name: s.name, status: 'error', error: e?.message || String(e) });
    }
  }

  if (!opts.dry) await recordWaDeliveries(deliveries);
  return { ok: true, school: SCHOOL, window: win, dry: !!opts.dry, templateName, totalStaff: staff.length, ...results };
}
