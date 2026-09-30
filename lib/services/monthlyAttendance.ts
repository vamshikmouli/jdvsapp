import { prisma } from '@/lib/db';
import { getActiveYear } from '@/lib/services/fees';
import { renderAttendanceCalendarPng } from '@/lib/services/attendanceImage';
import { feeWaRecipients, toWaNumber, uploadWhatsAppMedia, sendImageTemplate, whatsappConfigured } from '@/lib/services/whatsapp';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SCHOOL = 'Jnana Deepika Vidhya Samsthe';
const MONTHLY_TEMPLATE = process.env.WHATSAPP_MONTHLY_ATT_TEMPLATE || 'student_monthly_attendance';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cleanClass = (name: string | null) => (name ? name.replace(/\s?STD$/i, '') : '');
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Tier = 'perfect' | 'great' | 'good' | 'low';

export interface StudentMonth {
  studentId: string;
  name: string;
  className: string | null;
  present: number;
  absent: number;
  leave: number;
  pct: number;                 // present ÷ (present + absent), 0–100
  tier: Tier;
  days: { date: string; status: string }[];  // for the calendar image
}

/** Collapse a day's slot statuses (morning/afternoon) into one image status. */
function collapseDay(statuses: string[]): 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HALF_DAY' {
  const present = statuses.some((s) => s === 'PRESENT' || s === 'LATE');
  const absent = statuses.some((s) => s === 'ABSENT');
  if (present && absent) return 'HALF_DAY';
  if (present) return 'PRESENT';
  if (absent) return 'ABSENT';
  return 'LEAVE'; // LEAVE / EXCUSED
}

function tierOf(present: number, absent: number, pct: number): Tier {
  if (present > 0 && absent === 0) return 'perfect';
  if (pct >= 90) return 'great';
  if (pct >= 75) return 'good';
  return 'low';
}

/** The tiered, personalised message (goes into one template variable). */
export function buildMessage(s: StudentMonth, monthLabel: string): string {
  const first = s.name.split(' ')[0] || s.name;
  const stats = `${s.name}'s attendance for ${monthLabel}\nPresent: ${s.present} day${s.present === 1 ? '' : 's'} · Absent: ${s.absent} · Leave: ${s.leave}\nAttendance: ${s.pct}%`;
  let line: string;
  switch (s.tier) {
    case 'perfect':
      line = `Excellent! ${first} was present every single school day this month — a wonderful record. Please keep it up! 👏`;
      break;
    case 'great':
      line = `Very good! ${first} maintained strong attendance this month. Thank you for ensuring such regularity. 🌟`;
      break;
    case 'good':
      line = `${first} attended fairly well this month, with a little room to improve. Please try to reduce absences next month. 🙂`;
      break;
    default:
      line = `${first}'s attendance needs improvement this month. Regular attendance greatly helps learning — kindly ensure ${first} comes to school regularly. 🙏`;
  }
  const leaveNote = s.leave > 0 ? `\n\n(${s.leave} approved leave${s.leave === 1 ? '' : 's'} are not counted against attendance.)` : '';
  return `${stats}\n\n${line}${leaveNote}`;
}

/**
 * Aggregate each student's month of attendance for a class (or the whole school),
 * with per-day image data, counts, %, and the appreciation/improvement tier.
 * Only students who have at least one attendance record that month are returned.
 */
export async function getClassMonth(month: string, classId?: string | null): Promise<{ monthLabel: string; students: StudentMonth[] }> {
  const [yy, mm] = month.split('-').map(Number);
  const monthLabel = `${MONTHS[mm - 1]} ${yy}`;
  const monthStart = new Date(Date.UTC(yy, mm - 1, 1));
  const monthEnd = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
  const year = await getActiveYear();

  // Roster from the active-year enrollment (year-correct class), + contact fields.
  const enrWhere: any = { yearId: year.id, status: 'ACTIVE', student: { status: 'ACTIVE' } };
  if (classId) enrWhere.classId = classId;
  const enr = await prisma.enrollment.findMany({
    where: enrWhere,
    orderBy: { student: { name: 'asc' } },
    include: {
      class: { select: { id: true, name: true } },
      student: {
        select: {
          id: true, name: true,
          fatherName: true, fatherPhone: true, motherName: true, motherPhone: true,
          altGuardianName: true, altGuardianPhone: true, guardianName: true, guardianPhone: true,
          smsFor: true, whatsappEnabled: true,
        },
      },
    },
  });
  if (enr.length === 0) return { monthLabel, students: [] };

  // School holidays this month — a declared holiday applies to students too, so
  // any record on that day is shown as Holiday (not absent) and counted as Off.
  const holidayRows = await prisma.holiday.findMany({
    where: { date: { gte: monthStart, lte: monthEnd } },
    select: { date: true },
  });
  const holidaySet = new Set(holidayRows.map((h) => iso(h.date)));

  const classIds = Array.from(new Set(enr.map((e) => e.classId)));
  const sessions = await prisma.attendanceSession.findMany({
    where: { date: { gte: monthStart, lte: monthEnd }, classId: { in: classIds } },
    select: { date: true, records: { select: { studentId: true, status: true } } },
  });

  // studentId → (dateKey → [statuses])
  const byStudent = new Map<string, Map<string, string[]>>();
  for (const sess of sessions) {
    const dk = iso(sess.date);
    for (const rec of sess.records) {
      let m = byStudent.get(rec.studentId);
      if (!m) { m = new Map(); byStudent.set(rec.studentId, m); }
      const arr = m.get(dk) || [];
      arr.push(rec.status); m.set(dk, arr);
    }
  }

  const students: StudentMonth[] = [];
  for (const e of enr) {
    const dayMap = byStudent.get(e.student.id);
    if (!dayMap || dayMap.size === 0) continue; // no attendance data this month
    let present = 0, absent = 0, leave = 0;
    const days: { date: string; status: string }[] = [];
    for (const [dk, statuses] of dayMap) {
      // A declared holiday overrides whatever was marked: it's Off, never absent.
      const st = holidaySet.has(dk) ? 'HOLIDAY' : collapseDay(statuses);
      days.push({ date: dk, status: st });
      if (st === 'HOLIDAY') continue; // not counted in present/absent/leave
      if (st === 'PRESENT' || st === 'HALF_DAY') present++;
      else if (st === 'ABSENT') absent++;
      else leave++;
    }
    const denom = present + absent;
    const pct = denom > 0 ? Math.round((present / denom) * 100) : 100;
    students.push({
      studentId: e.student.id,
      name: e.student.name,
      className: e.class?.name || null,
      present, absent, leave, pct,
      tier: tierOf(present, absent, pct),
      days,
    });
  }
  return { monthLabel, students };
}

export interface MonthlySendResult {
  monthLabel: string;
  total: number;              // students with data
  sent: number;
  failed: number;
  skipped: number;
  already: number;            // recipients who already got this month's report (not re-sent)
  held: number;               // recipients held back by the daily WhatsApp limit — send again tomorrow
  dailyLimit: number;         // unique recipients Meta allows per 24h (WHATSAPP_DAILY_LIMIT)
  usedToday: number;          // unique numbers messaged in the last 24h, before this run
  details: { student: string; className: string | null; tier: Tier; pct: number; status: string; to?: string; error?: string }[];
  tiers: Record<Tier, number>;
}

// Meta caps business-initiated conversations at N unique recipients per rolling
// 24h (250 on a new/unverified number, 1K+ after it's upgraded). Every kind of
// message counts — fee receipts, absence alerts, reminders — so the budget is shared.
const DAILY_LIMIT = Math.max(1, Number(process.env.WHATSAPP_DAILY_LIMIT) || 250);

// Meta errors that mean "stop sending for now" (rate / messaging limit reached).
const LIMIT_ERROR = /\b(130429|131048|131056)\b|rate limit|messaging limit/i;

/** Unique numbers we successfully messaged in the last 24h (all message kinds). */
async function phonesUsedLast24h(): Promise<Set<string>> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.messageDelivery.findMany({
    where: { createdAt: { gte: since }, status: { not: 'FAILED' } },
    select: { phone: true },
    distinct: ['phone'],
  });
  return new Set(rows.map((r) => r.phone));
}

/** "studentId|phone" pairs that already received this month's report. */
async function alreadySentFor(month: string): Promise<Set<string>> {
  const rows = await prisma.messageDelivery.findMany({
    where: { kind: 'ATTENDANCE_MONTHLY', batchId: { startsWith: `monthatt-${month}-` }, status: { not: 'FAILED' } },
    select: { studentId: true, phone: true },
  });
  return new Set(rows.map((r) => `${r.studentId}|${r.phone}`));
}

/**
 * Send each student's monthly attendance image + tiered message to their parents.
 * `dry` renders + tallies but sends nothing (used for the preview). Gated by the
 * caller. Best-effort per student — one failure never stops the run.
 */
export async function sendMonthlyReports(opts: { month: string; classId?: string | null; dry?: boolean; sentById?: string | null; toOverride?: string | null }): Promise<MonthlySendResult> {
  const { monthLabel, students } = await getClassMonth(opts.month, opts.classId);
  const res: MonthlySendResult = { monthLabel, total: students.length, sent: 0, failed: 0, skipped: 0, already: 0, held: 0, dailyLimit: DAILY_LIMIT, usedToday: 0, tiers: { perfect: 0, great: 0, good: 0, low: 0 }, details: [] };
  const deliveries: WaDeliveryInput[] = [];
  const batchId = `monthatt-${opts.month}-${Date.now()}`;
  const live = !opts.dry && whatsappConfigured();

  // Resumable sends: skip parents who already got this month's report, and stop
  // at the daily limit — the rest are "held" and go out on the next Send.
  // A test send (toOverride) bypasses both.
  const used = await phonesUsedLast24h();
  res.usedToday = used.size;
  const done = opts.toOverride ? new Set<string>() : await alreadySentFor(opts.month);
  let limitHit = false;
  // A number already messaged in the last 24h doesn't use a new slot.
  const fits = (to: string) => !limitHit && (opts.toOverride || used.has(to) || used.size < DAILY_LIMIT);

  // Batch-fetch every student's contact fields in ONE query (avoids an N+1 —
  // previously one findUnique per student inside the loop).
  const contactById = new Map<string, any>();
  if (!opts.toOverride && students.length) {
    const contactRows = await prisma.student.findMany({
      where: { id: { in: students.map((s) => s.studentId) } },
      select: {
        id: true, fatherName: true, fatherPhone: true, motherName: true, motherPhone: true,
        altGuardianName: true, altGuardianPhone: true, guardianName: true, guardianPhone: true,
        smsFor: true, whatsappEnabled: true,
      },
    });
    for (const r of contactRows) contactById.set(r.id, r);
  }

  for (const s of students) {
    res.tiers[s.tier]++;
    // Resolve recipients: a test override, else the student's own contact setting
    // (father / mother / guardian), the same targeting used for fee messages.
    let reps: { name: string; to: string }[];
    if (opts.toOverride) {
      const to = toWaNumber(opts.toOverride);
      reps = to ? [{ name: 'Test', to }] : [];
    } else {
      reps = feeWaRecipients((contactById.get(s.studentId) || {}) as any);
    }
    if (!reps.length) { res.skipped++; res.details.push({ student: s.name, className: s.className, tier: s.tier, pct: s.pct, status: 'skipped', error: 'no WhatsApp number' }); continue; }

    const parentName = reps[0].name;
    const message = buildMessage(s, monthLabel);
    const row = { student: s.name, className: s.className, tier: s.tier, pct: s.pct };

    // Split this student's recipients: already sent / held by the limit / to send now.
    const toSend: typeof reps = [];
    for (const rcp of reps) {
      if (done.has(`${s.studentId}|${rcp.to}`)) { res.already++; res.details.push({ ...row, status: 'already', to: rcp.to }); }
      else if (!fits(rcp.to)) { res.held++; res.details.push({ ...row, status: 'held', to: rcp.to, error: 'daily WhatsApp limit — send again tomorrow' }); }
      else { toSend.push(rcp); used.add(rcp.to); }
    }
    if (!toSend.length) continue;

    if (!live) {
      res.sent += toSend.length; // count as "would send" in dry mode
      for (const rcp of toSend) res.details.push({ ...row, status: opts.dry ? 'preview' : 'wa-off', to: rcp.to });
      continue;
    }

    try {
      const png = renderAttendanceCalendarPng({ staffName: s.name, designation: cleanClass(s.className) ? `Class ${cleanClass(s.className)}` : '', month: opts.month, days: s.days, schoolName: SCHOOL });
      const mediaId = await uploadWhatsAppMedia(png);
      for (const rcp of toSend) {
        if (limitHit) { res.held++; res.details.push({ ...row, status: 'held', to: rcp.to, error: 'daily WhatsApp limit — send again tomorrow' }); continue; }
        const send = await sendImageTemplate({ to: rcp.to, templateName: MONTHLY_TEMPLATE, lang: TEMPLATE_LANG, mediaId, bodyParams: [rcp.name || parentName, message] });
        if (send.ok) { res.sent++; res.details.push({ ...row, status: 'sent', to: rcp.to }); }
        else if (LIMIT_ERROR.test(send.error || '')) {
          // Meta says we've hit the limit — hold this and everyone after it.
          limitHit = true; res.held++;
          res.details.push({ ...row, status: 'held', to: rcp.to, error: `WhatsApp limit reached — send again tomorrow (${send.error})` });
          continue; // not logged as a delivery, so the next run retries it
        }
        else { res.failed++; res.details.push({ ...row, status: 'failed', to: rcp.to, error: send.error }); }
        deliveries.push({ kind: 'ATTENDANCE_MONTHLY', batchId, title: `Monthly attendance · ${monthLabel}`, studentId: s.studentId, studentName: s.name, className: s.className, recipient: rcp.name, phone: rcp.to, ok: send.ok, error: send.ok ? null : (send.error || 'send failed'), wamid: send.id, sentById: opts.sentById });
      }
      await sleep(300);
    } catch (e) {
      res.failed++;
      res.details.push({ student: s.name, className: s.className, tier: s.tier, pct: s.pct, status: 'error', error: e instanceof Error ? e.message : 'render/send error' });
    }
  }

  if (live && deliveries.length) await recordWaDeliveries(deliveries);
  return res;
}
