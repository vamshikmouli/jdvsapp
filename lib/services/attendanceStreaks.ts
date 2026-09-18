import { prisma } from '@/lib/db';
import { getActiveYear } from '@/lib/services/fees';
import { sendTextTemplate, toWaNumber, whatsappConfigured } from '@/lib/services/whatsapp';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';

// Admin-summary template: "⚠️ {{1}} student(s) have been away (absent/leave) 3+ days
// in a row as of {{2}}:\n{{3}}\nPlease follow up. — Jnana Deepika Vidhya Samsthe"
// params [count, dateLabel, list]. The list is one line per student (newlines ok in
// a body variable; no tabs / 4+ spaces).
const STREAK_TEMPLATE = process.env.WHATSAPP_ABSENCE_STREAK_TEMPLATE || 'student_absence_streak';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cleanClass = (n: string | null) => (n ? n.replace(/\s?STD$/i, '') : '');

function labelFromKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
}

// A day counts as "away" when the student did not attend for any reason (absent or
// leave) — present/late in any slot means they came, so it breaks the streak.
function isAwayDay(statuses: string[]): boolean {
  const came = statuses.some((s) => s === 'PRESENT' || s === 'LATE');
  if (came) return false;
  return statuses.some((s) => s === 'ABSENT' || s === 'LEAVE' || s === 'EXCUSED');
}

export interface StreakRow {
  studentId: string;
  name: string;
  className: string | null;
  streak: number;      // consecutive school days away, ending at their latest marked day
  fromKey: string;     // first day of the current run
  toKey: string;       // most recent day (latest marked school day)
}

/**
 * Students currently on a run of `minStreak`+ consecutive school days away
 * (absent or leave). "Consecutive school days" skips weekends/holidays (days with no
 * session for the class). Only the CURRENT trailing run is counted, so a student who
 * has since returned is not flagged. Looks back `lookbackDays` calendar days.
 */
export async function getContinuousAbsentees(minStreak = 3, lookbackDays = 30): Promise<StreakRow[]> {
  const year = await getActiveYear();
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 86400_000);
  from.setUTCHours(0, 0, 0, 0);

  const enr = await prisma.enrollment.findMany({
    where: { yearId: year.id, status: 'ACTIVE', student: { status: 'ACTIVE' } },
    select: { classId: true, student: { select: { id: true, name: true } }, class: { select: { name: true } } },
  });
  if (!enr.length) return [];
  const classOf = new Map(enr.map((e) => [e.student.id, { classId: e.classId, className: e.class?.name || null, name: e.student.name }]));
  const classIds = Array.from(new Set(enr.map((e) => e.classId)));

  const sessions = await prisma.attendanceSession.findMany({
    where: { date: { gte: from, lte: to }, classId: { in: classIds } },
    select: { date: true, classId: true, records: { select: { studentId: true, status: true } } },
  });

  // Per class: the sorted list of school days (dates a session was taken).
  const classDays = new Map<string, Set<string>>();
  // Per student: date -> collapsed statuses.
  const studentDay = new Map<string, Map<string, string[]>>();
  for (const s of sessions) {
    const dk = iso(s.date);
    (classDays.get(s.classId) || classDays.set(s.classId, new Set()).get(s.classId)!).add(dk);
    for (const rec of s.records) {
      let m = studentDay.get(rec.studentId);
      if (!m) { m = new Map(); studentDay.set(rec.studentId, m); }
      (m.get(dk) || m.set(dk, []).get(dk)!).push(rec.status);
    }
  }

  const rows: StreakRow[] = [];
  for (const [sid, info] of classOf) {
    const dayMap = studentDay.get(sid);
    if (!dayMap) continue;
    const schoolDays = Array.from(classDays.get(info.classId) || []).sort(); // asc
    // Walk school days the student has a record for, ascending, tracking the run
    // ending at the last such day.
    let run = 0, runStart = '', lastKey = '';
    for (const dk of schoolDays) {
      const statuses = dayMap.get(dk);
      if (!statuses) continue; // student not marked this school day — ignore
      if (isAwayDay(statuses)) { if (run === 0) runStart = dk; run++; lastKey = dk; }
      else { run = 0; runStart = ''; lastKey = dk; }
    }
    if (run >= minStreak && lastKey && isAwayDay(dayMap.get(lastKey) || [])) {
      rows.push({ studentId: sid, name: info.name, className: info.className, streak: run, fromKey: runStart, toKey: lastKey });
    }
  }
  rows.sort((a, b) => b.streak - a.streak || a.className?.localeCompare(b.className || '', undefined, { numeric: true }) || 0);
  return rows;
}

/** Admin WhatsApp numbers from Settings (falls back to env). */
async function adminNumbers(): Promise<string[]> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { waAdminRecipients: true } });
  const src = s?.waAdminRecipients || process.env.WHATSAPP_ADMIN_RECIPIENTS || '';
  return src.split(',').map((x) => x.trim()).filter(Boolean).map(toWaNumber).filter(Boolean) as string[];
}

export interface StreakSendResult { flagged: number; sent: number; failed: number; recipients: number; rows: StreakRow[] }

/**
 * Send the admins one WhatsApp summarising every student currently on a 3+ day
 * absent/leave streak. Best-effort. `dry` computes but sends nothing.
 */
export async function sendAbsenceStreakSummary(opts: { minStreak?: number; dry?: boolean; toOverride?: string | null } = {}): Promise<StreakSendResult> {
  const minStreak = opts.minStreak ?? 3;
  const rows = await getContinuousAbsentees(minStreak);
  const res: StreakSendResult = { flagged: rows.length, sent: 0, failed: 0, recipients: 0, rows };
  if (opts.dry || rows.length === 0) return res;
  if (!whatsappConfigured()) return res;

  const recipients = opts.toOverride ? [toWaNumber(opts.toOverride)].filter(Boolean) as string[] : await adminNumbers();
  res.recipients = recipients.length;
  if (!recipients.length) return res;

  const today = new Date();
  const dateLabel = `${String(today.getUTCDate()).padStart(2, '0')} ${MONTHS[today.getUTCMonth()]} ${today.getUTCFullYear()}`;
  const list = rows
    .map((r) => `• ${r.name}${r.className ? ` (${cleanClass(r.className)})` : ''} — ${r.streak} days (${labelFromKey(r.fromKey)}–${labelFromKey(r.toKey)})`)
    .join('\n');

  const deliveries: WaDeliveryInput[] = [];
  const batchId = `absstreak-${iso(today)}-${Date.now()}`;
  for (const to of recipients) {
    const r = await sendTextTemplate({ to, templateName: STREAK_TEMPLATE, lang: TEMPLATE_LANG, bodyParams: [String(rows.length), dateLabel, list] });
    if (r.ok) res.sent++; else res.failed++;
    deliveries.push({ kind: 'ABSENCE_STREAK', batchId, title: `3+ day absentees · ${dateLabel}`, studentName: 'Admin', recipient: 'Admin', phone: to, ok: r.ok, error: r.ok ? null : (r.error || 'send failed'), wamid: r.id });
  }
  await recordWaDeliveries(deliveries);
  return res;
}
