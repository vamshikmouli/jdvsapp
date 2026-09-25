import { prisma } from '@/lib/db';
import { sendTextTemplate, toWaNumber, whatsappConfigured } from '@/lib/services/whatsapp';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';

// Admin digest template: which classes have SUBMITTED student attendance today and
// which are still PENDING. Suggested Utility template (3 vars):
//   "Student attendance — {{1}}\n\nSubmitted: {{2}}\nPending: {{3}}\n\n— Jnana
//    Deepika Vidhya Samsthe"
const TEMPLATE = process.env.WHATSAPP_ATTENDANCE_STATUS_TEMPLATE || 'attendance_status';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const cleanClass = (n: string | null) => (n ? n.replace(/\s?STD$/i, '') : '');
const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export interface AttendanceStatus {
  dateKey: string;
  dateLabel: string;
  submitted: string[];   // class names with a locked (submitted) session today
  started: string[];     // session exists but not submitted yet
  pending: string[];     // no session started at all
}

/** Per-class student-attendance status for a day (IST). */
export async function getClassAttendanceStatus(dateKey?: string): Promise<AttendanceStatus> {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const dk = dateKey || ist.toISOString().slice(0, 10);
  const [y, m, d] = dk.split('-').map(Number);
  const from = new Date(`${dk}T00:00:00.000Z`);
  const to = new Date(`${dk}T23:59:59.999Z`);

  const [classes, sessions] = await Promise.all([
    prisma.schoolClass.findMany({ select: { id: true, name: true } }),
    prisma.attendanceSession.findMany({ where: { date: { gte: from, lte: to } }, select: { classId: true, locked: true } }),
  ]);

  // A class is Submitted if any of its sessions today is locked; Started if it has a
  // session but none locked; Pending if it has no session at all.
  const hasLocked = new Set<string>();
  const hasAny = new Set<string>();
  for (const s of sessions) { hasAny.add(s.classId); if (s.locked) hasLocked.add(s.classId); }

  const submitted: string[] = [], started: string[] = [], pending: string[] = [];
  for (const c of classes) {
    const name = cleanClass(c.name);
    if (hasLocked.has(c.id)) submitted.push(name);
    else if (hasAny.has(c.id)) started.push(name);
    else pending.push(name);
  }
  submitted.sort(naturalSort); started.sort(naturalSort); pending.sort(naturalSort);
  return { dateKey: dk, dateLabel: `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`, submitted, started, pending };
}

/** Recipients for this report — the in-app list (Settings), managed on the WhatsApp
 *  page; falls back to the admin digest recipients if none are set. */
async function recipients(toOverride?: string | null): Promise<string[]> {
  if (toOverride) { const t = toWaNumber(toOverride); return t ? [t] : []; }
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { attendanceStatusRecipients: true, waAdminRecipients: true } });
  const src = s?.attendanceStatusRecipients || process.env.WHATSAPP_ATTENDANCE_STATUS_RECIPIENTS || s?.waAdminRecipients || process.env.WHATSAPP_ADMIN_RECIPIENTS || '';
  return src.split(',').map((x) => x.trim()).filter(Boolean).map(toWaNumber).filter(Boolean) as string[];
}

export interface StatusSendResult { dateLabel: string; submitted: number; started: number; pending: number; sent: number; failed: number; to: number; status: AttendanceStatus }

/** WhatsApp the class-attendance status to the configured recipients. Best-effort. */
export async function sendAttendanceStatusReport(opts: { dry?: boolean; toOverride?: string | null } = {}): Promise<StatusSendResult> {
  const status = await getClassAttendanceStatus();
  const res: StatusSendResult = { dateLabel: status.dateLabel, submitted: status.submitted.length, started: status.started.length, pending: status.pending.length, sent: 0, failed: 0, to: 0, status };
  if (opts.dry) return res;
  if (!whatsappConfigured()) return res;
  const to = await recipients(opts.toOverride);
  res.to = to.length;
  if (!to.length) return res;

  // "Started but not submitted" folds into the Pending line so admins chase them.
  const submittedText = status.submitted.length ? status.submitted.join(' · ') : 'None';
  const pendingList = [...status.started.map((c) => `${c} (not submitted)`), ...status.pending];
  const pendingText = pendingList.length ? pendingList.join(' · ') : 'None — all classes submitted 🎉';

  const deliveries: WaDeliveryInput[] = [];
  const batchId = `attstatus-${status.dateKey}-${Date.now()}`;
  for (const num of to) {
    const r = await sendTextTemplate({ to: num, templateName: TEMPLATE, lang: TEMPLATE_LANG, bodyParams: [status.dateLabel, submittedText, pendingText] });
    if (r.ok) res.sent++; else res.failed++;
    deliveries.push({ kind: 'ATTENDANCE_STATUS', batchId, title: `Attendance status · ${status.dateLabel}`, studentName: 'Admin', recipient: 'Admin', phone: num, ok: r.ok, error: r.ok ? null : (r.error || 'send failed'), wamid: r.id });
  }
  await recordWaDeliveries(deliveries);
  return res;
}
