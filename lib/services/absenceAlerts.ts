import { prisma } from '@/lib/db';
import { AttendanceStatus } from '@prisma/client';
import { feeWaRecipients, sendTextTemplate, whatsappConfigured } from '@/lib/services/whatsapp';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';

// Approved Meta template for the "child absent / on leave" alert to the guardian.
// Suggested body (4 variables):
//   "Dear {{1}}, this is to inform you that your child {{2}} was {{3}} on {{4}} at
//    Jnana Deepika Vidhya Samsthe. For any queries, please contact the school
//    office. Thank you."
// params are [parentName, studentName, statusLabel, dateLabel], where statusLabel
// is "absent" or "on leave" — chosen so the sentence reads naturally either way.
const ABSENCE_TEMPLATE = process.env.WHATSAPP_ABSENCE_TEMPLATE_NAME || 'student_absent';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

// Everything feeWaRecipients() needs to resolve who to message (father / mother /
// guardian, per the student's own contact setting).
const CONTACT_SELECT = {
  id: true, name: true,
  fatherName: true, fatherPhone: true,
  motherName: true, motherPhone: true,
  altGuardianName: true, altGuardianPhone: true,
  guardianName: true, guardianPhone: true,
  smsFor: true, whatsappEnabled: true,
} as const;

/** "2026-09-17" → "17 Sep 2026" (no timezone maths — reads the stored date parts). */
function dateLabelFrom(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = d.getUTCMonth();
  const dd = d.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(dd).padStart(2, '0')} ${months[mm]} ${yyyy}`;
}

/** Natural status phrase for the alert body ("...your child X was absent on..."). */
function statusWord(s: string): string {
  return s === 'LEAVE' ? 'on leave' : 'absent';
}

/**
 * Send a WhatsApp "your child was absent / on leave" alert to each such student's
 * guardian for one attendance session (both ABSENT and LEAVE trigger a message).
 * Gated by Settings.notifyAbsence. Best-effort and idempotent: one alert per student
 * per DATE (deduped across slots / re-locks) via the ATTENDANCE_ABSENCE delivery log,
 * so re-submitting a session never re-spams. Never throws into the caller —
 * attendance submit must not fail on a WhatsApp hiccup.
 */
export async function sendAbsenceAlerts(
  sessionId: string,
  sentById?: string | null
): Promise<{ sent: number; skipped: number; failed: number }> {
  const zero = { sent: 0, skipped: 0, failed: 0 };
  try {
    if (!whatsappConfigured()) return zero;
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { notifyAbsence: true } });
    if (!settings?.notifyAbsence) return zero;

    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        date: true,
        class: { select: { name: true } },
        records: { where: { status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.LEAVE] } }, select: { status: true, student: { select: CONTACT_SELECT } } },
      },
    });
    if (!session || session.records.length === 0) return zero;

    const dateStr = session.date.toISOString().slice(0, 10);
    const batchId = `absence:${dateStr}`;               // one alert per student per date
    const dateLabel = dateLabelFrom(session.date);
    const className = session.class?.name || null;
    const studentIds = session.records.map((r) => r.student.id);

    // Skip students already alerted for this date (any slot, earlier lock).
    const already = await prisma.messageDelivery.findMany({
      where: { kind: 'ATTENDANCE_ABSENCE', batchId, status: 'SENT', studentId: { in: studentIds } },
      select: { studentId: true },
    });
    const done = new Set(already.map((a) => a.studentId));

    const rows: WaDeliveryInput[] = [];
    let sent = 0, failed = 0, skipped = 0;
    for (const rec of session.records) {
      const st = rec.student;
      if (done.has(st.id)) { skipped++; continue; }
      const recips = feeWaRecipients(st);             // father/mother/guardian per contact setting
      if (recips.length === 0) { skipped++; continue; }
      const label = statusWord(rec.status);           // "absent" | "on leave"
      const titleLabel = rec.status === 'LEAVE' ? 'On leave' : 'Absent';
      for (const r of recips) {
        const res = await sendTextTemplate({
          to: r.to, templateName: ABSENCE_TEMPLATE, lang: TEMPLATE_LANG,
          bodyParams: [r.name, st.name, label, dateLabel],
        });
        rows.push({
          kind: 'ATTENDANCE_ABSENCE', batchId, title: `${titleLabel} · ${dateLabel}`,
          studentId: st.id, studentName: st.name, className,
          recipient: r.name, phone: r.to, ok: res.ok, error: res.error, wamid: res.id, sentById,
        });
        if (res.ok) sent++; else failed++;
      }
    }
    await recordWaDeliveries(rows);
    return { sent, skipped, failed };
  } catch (e) {
    console.error('[absenceAlerts] failed', e);
    return zero;
  }
}
