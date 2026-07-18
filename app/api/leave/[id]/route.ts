import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, can, authErrorResponse } from '@/lib/rbac/roles';
import { sendPushToUsers } from '@/lib/push';
import { applyLeave, revertLeave } from '@/lib/staffAttendance/leave';
import { getBalances, getLeaveYearStartMonth, leaveYearOf } from '@/lib/staffAttendance/leaveBalance';

// PATCH /api/leave/[id]  { action: 'approve' | 'reject' | 'cancel', note? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    const userId = (session.user as any)?.id as string | undefined;
    const myStaffId = (session.user as any)?.staffId as string | undefined;
    const { action, note, force } = await req.json();

    const lr = await prisma.leaveRequest.findUnique({
      where: { id: params.id },
      include: { staff: { select: { id: true, name: true, userId: true } } },
    });
    if (!lr) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

    // ----- Cancel: owner (or an approver) may cancel -----
    if (action === 'cancel') {
      const isOwner = myStaffId && myStaffId === lr.staffId;
      if (!isOwner && !can(session, 'LEAVE_APPROVE')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (lr.status === 'REJECTED' || lr.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Already closed' }, { status: 400 });
      }
      if (lr.status === 'APPROVED') await revertLeave(lr.staffId, lr.fromDate, lr.toDate);
      const row = await prisma.leaveRequest.update({
        where: { id: lr.id },
        data: { status: 'CANCELLED', decidedById: userId ?? null, decidedAt: new Date(), decisionNote: note || null },
      });
      return NextResponse.json(row);
    }

    // ----- Approve / reject: needs LEAVE_APPROVE -----
    if (action === 'approve' || action === 'reject') {
      if (!can(session, 'LEAVE_APPROVE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (lr.status !== 'PENDING') return NextResponse.json({ error: 'Already decided' }, { status: 400 });

      const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
      if (action === 'approve') {
        // Enforce the annual quota (0 = unlimited, e.g. UNPAID). The approver can
        // override by passing { force: true } to convert/approve beyond balance.
        const startMonth = await getLeaveYearStartMonth();
        const ly = leaveYearOf(lr.fromDate, startMonth);
        const bal = (await getBalances(lr.staffId, ly)).find((b) => b.type === lr.type);
        if (bal && !bal.unlimited && !force && bal.used + lr.days > bal.entitlement) {
          return NextResponse.json(
            { error: `Exceeds ${lr.type} balance: ${bal.remaining} of ${bal.entitlement} day(s) left, request is ${lr.days}.`, balance: bal },
            { status: 409 }
          );
        }
        await applyLeave(lr.staffId, lr.fromDate, lr.toDate, lr.halfDay, lr.type, lr.halfSession);
      }

      const row = await prisma.leaveRequest.update({
        where: { id: lr.id },
        data: { status, decidedById: userId ?? null, decidedAt: new Date(), decisionNote: note || null },
      });

      if (lr.staff.userId) {
        await sendPushToUsers([lr.staff.userId], {
          title: `Leave ${action === 'approve' ? 'approved' : 'rejected'}`,
          body: `Your leave from ${lr.fromDate.toISOString().slice(0, 10)} was ${action === 'approve' ? 'approved' : 'rejected'}.`,
          url: '/admin/leave',
          tag: `leave-${lr.id}`,
        });
      }
      return NextResponse.json(row);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
