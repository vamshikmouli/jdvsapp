// Notifications for online payments. Reuses the existing bell + web-push plumbing:
// admins resolved by permission, parents by the guardian→student link.
import { prisma } from '@/lib/db';
import { sendPushToUsers, parentUserIdsForStudents } from '@/lib/push';
import { userIdsWithPermission } from '@/lib/notifications';
import { feeMoney } from '@/lib/fees';

/** Tell admins an online fee payment landed (informational — no action required). */
export async function notifyAdminsPaid(opts: { studentId: string | null; studentName: string; amount: number; receiptNo: string }): Promise<void> {
  try {
    const admins = await userIdsWithPermission('FEES_COLLECT');
    if (!admins.length) return;
    const title = 'Online fee received';
    const body = `${feeMoney(opts.amount)} from ${opts.studentName} (receipt ${opts.receiptNo}).`;
    const url = '/admin/online-payments';
    await prisma.notification.createMany({ data: admins.map((userId) => ({ userId, type: 'ONLINE_PAYMENT', title, body, url })) });
    await sendPushToUsers(admins, { title, body, url, tag: `onlinepay-${opts.receiptNo}` });
  } catch (e) {
    console.error('[payments] notifyAdminsPaid', e);
  }
}

/** Tell admins an order needs attention (stuck/failed) so they open the monitoring screen. */
export async function notifyAdminsAttention(opts: { studentName: string; amount: number; reason: string }): Promise<void> {
  try {
    const admins = await userIdsWithPermission('FEES_COLLECT');
    if (!admins.length) return;
    const title = 'Online payment needs attention';
    const body = `${feeMoney(opts.amount)} from ${opts.studentName}: ${opts.reason}`;
    const url = '/admin/online-payments';
    await prisma.notification.createMany({ data: admins.map((userId) => ({ userId, type: 'ONLINE_PAYMENT', title, body, url })) });
    await sendPushToUsers(admins, { title, body, url, tag: `onlinepay-attn` });
  } catch (e) {
    console.error('[payments] notifyAdminsAttention', e);
  }
}

/** Tell the parent their payment could not be confirmed (admin reject / failure). */
export async function notifyParentFailed(studentId: string | null, studentName: string): Promise<void> {
  try {
    if (!studentId) return;
    const parents = await parentUserIdsForStudents([studentId]);
    if (!parents.length) return;
    await sendPushToUsers(parents, {
      title: 'Payment not confirmed',
      body: `We couldn't confirm your fee payment for ${studentName}. Please try again or contact the office.`,
      url: '/parent',
      tag: `onlinepay-failed-${studentId}`,
    });
  } catch (e) {
    console.error('[payments] notifyParentFailed', e);
  }
}
