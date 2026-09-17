import { prisma } from '@/lib/db';

// Every WhatsApp message the app sends is logged here so it shows up in
// Communications → Analytics, grouped by `kind`. Rows carry Meta's message id
// (`wamid`) so the delivery-status webhook can later flip SENT → DELIVERED/READ/FAILED.
export type WaDeliveryInput = {
  kind: string;                 // FEE_REMINDER | FEE_RECEIPT | ATTENDANCE_REMINDER | ADMIN_REPORT | ADMIN_ALERT | LOGIN_OTP | …
  batchId: string;              // groups one action (a send run, a receipt, one OTP…)
  title?: string | null;
  studentId?: string | null;
  studentName?: string | null;  // the subject (student / staff / person); column is required
  className?: string | null;
  recipient: string;            // who it was addressed to (name)
  phone: string;                // WhatsApp number
  ok: boolean;                  // accepted by Meta at send time
  error?: string | null;
  wamid?: string | null;        // Meta message id (for async status updates)
  sentById?: string | null;
};

/** Write one or more delivery rows. Best-effort — never throws into the caller. */
export async function recordWaDeliveries(rows: WaDeliveryInput[]): Promise<void> {
  if (!rows.length) return;
  try {
    await prisma.messageDelivery.createMany({
      data: rows.map((d) => ({
        batchId: d.batchId,
        kind: d.kind,
        title: d.title ?? null,
        studentId: d.studentId ?? null,
        studentName: d.studentName || '—',
        className: d.className ?? null,
        recipient: d.recipient || '—',
        phone: d.phone || '—',
        status: d.ok ? 'SENT' : 'FAILED',
        error: d.error ?? null,
        wamid: d.wamid ?? null,
        sentById: d.sentById ?? null,
      })),
    });
  } catch (e) {
    console.error('[waLog] record failed', e);
  }
}
