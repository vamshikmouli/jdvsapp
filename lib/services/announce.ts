import { prisma } from '@/lib/db';
import { getActiveYear } from '@/lib/services/fees';
import { feeWaRecipients, sendTextTemplate, whatsappConfigured } from '@/lib/services/whatsapp';
import { recordWaDeliveries, type WaDeliveryInput } from '@/lib/services/waLog';

// One generic, Meta-approved "notice" template with a single free-text variable —
// lets the office send ANY announcement (van delayed, festival holiday, PTM…) as {{1}}.
// Suggested body: "Notice from Jnana Deepika Vidhya Samsthe:\n\n{{1}}\n\nFor any
// queries, please contact the school office."
const NOTICE_TEMPLATE = process.env.WHATSAPP_NOTICE_TEMPLATE || 'school_notice';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

const CONTACT_SELECT = {
  id: true, name: true,
  fatherName: true, fatherPhone: true, motherName: true, motherPhone: true,
  altGuardianName: true, altGuardianPhone: true, guardianName: true, guardianPhone: true,
  smsFor: true, whatsappEnabled: true,
} as const;

/** Active students for a notice audience (whole school / classes / explicit list). */
async function studentsForAudience(audience: string, classIds: string[], studentIds: string[]) {
  if (audience === 'STUDENT') {
    return prisma.student.findMany({ where: { id: { in: studentIds }, status: 'ACTIVE' }, select: CONTACT_SELECT });
  }
  const year = await getActiveYear();
  const where: any = { yearId: year.id, status: 'ACTIVE', student: { status: 'ACTIVE' } };
  if (audience === 'CLASS') where.classId = { in: classIds };
  const enr = await prisma.enrollment.findMany({ where, select: { student: { select: CONTACT_SELECT } } });
  // Dedupe (a student could appear once per enrollment row).
  const seen = new Set<string>();
  return enr.map((e) => e.student).filter((s) => !seen.has(s.id) && seen.add(s.id));
}

/**
 * Broadcast a free-text notice to parents on WhatsApp via the generic notice
 * template. Best-effort, paced, and logged to Analytics (kind ANNOUNCEMENT). Meant
 * to run in the background after the circular is created (the VM keeps the promise
 * alive after the HTTP response). Never throws into the caller.
 */
export async function broadcastNotice(opts: {
  circularId: string; audience: string; classIds: string[]; studentIds: string[];
  title: string; body: string; lang?: string; sentById?: string | null;
}): Promise<{ sent: number; failed: number; recipients: number }> {
  const res = { sent: 0, failed: 0, recipients: 0 };
  try {
    if (!whatsappConfigured()) return res;
    const students = await studentsForAudience(opts.audience, opts.classIds, opts.studentIds);
    if (!students.length) return res;

    // 'kn' = Kannada. The template must have an approved translation for this language.
    const lang = opts.lang === 'kn' ? 'kn' : TEMPLATE_LANG;
    const message = opts.title ? `${opts.title}\n${opts.body}` : opts.body;
    const deliveries: WaDeliveryInput[] = [];
    const batchId = `notice-${opts.circularId}`;
    let n = 0;
    for (const st of students) {
      for (const rcp of feeWaRecipients(st as any)) {
        const r = await sendTextTemplate({ to: rcp.to, templateName: NOTICE_TEMPLATE, lang, bodyParams: [message] });
        if (r.ok) res.sent++; else res.failed++;
        deliveries.push({
          kind: 'ANNOUNCEMENT', batchId, title: opts.title || 'Notice',
          studentName: st.name, recipient: rcp.name, phone: rcp.to,
          ok: r.ok, error: r.ok ? null : (r.error || 'send failed'), wamid: r.id, sentById: opts.sentById,
        });
        if (++n % 20 === 0) await new Promise((r2) => setTimeout(r2, 400)); // gentle pacing for big blasts
      }
    }
    res.recipients = deliveries.length;
    await recordWaDeliveries(deliveries);
  } catch (e) {
    console.error('[announce] broadcastNotice failed', e);
  }
  return res;
}
