import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, requireSession, can, authErrorResponse } from '@/lib/rbac/roles';
import { leaveDays } from '@/lib/staffAttendance/leave';
import { LEAVE_TYPES } from '@/lib/staffAttendance/leaveBalance';

const TYPES: string[] = LEAVE_TYPES;

// GET /api/leave            — my requests
// GET /api/leave?all=1      — all requests (needs LEAVE_APPROVE); ?status=PENDING filters
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = new URL(req.url).searchParams;
    const wantAll = sp.get('all') === '1';
    const status = sp.get('status') || undefined;

    if (wantAll) {
      if (!can(session, 'LEAVE_APPROVE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const rows = await prisma.leaveRequest.findMany({
        where: status ? { status: status as any } : undefined,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: { staff: { select: { id: true, name: true, designation: true } } },
      });
      return NextResponse.json(rows);
    }

    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) return NextResponse.json([]);
    const rows = await prisma.leaveRequest.findMany({
      where: { staffId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(rows);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// POST /api/leave — apply for leave (self)
// { type, fromDate, toDate, halfDay?, reason? }
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission('STAFF_ATTENDANCE_MARK');
    const staffId = (session.user as any)?.staffId as string | undefined;
    if (!staffId) return NextResponse.json({ error: 'No staff profile linked to this account' }, { status: 400 });

    const b = await req.json();
    if (!TYPES.includes(b.type)) return NextResponse.json({ error: 'Invalid leave type' }, { status: 400 });
    const from = new Date(`${b.fromDate}T00:00:00Z`);
    const to = new Date(`${b.toDate || b.fromDate}T00:00:00Z`);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return NextResponse.json({ error: 'Invalid dates' }, { status: 400 });
    if (to < from) return NextResponse.json({ error: 'End date is before start date' }, { status: 400 });
    const halfDay = !!b.halfDay;
    if (halfDay && from.getTime() !== to.getTime()) {
      return NextResponse.json({ error: 'Half-day leave must be a single day' }, { status: 400 });
    }
    // Half-day leave must say which session (morning/afternoon) is off.
    let halfSession: string | null = null;
    if (halfDay) {
      halfSession = b.halfSession === 'AFTERNOON' ? 'AFTERNOON' : b.halfSession === 'MORNING' ? 'MORNING' : null;
      if (!halfSession) return NextResponse.json({ error: 'Choose morning or afternoon for half-day leave' }, { status: 400 });
    }

    const row = await prisma.leaveRequest.create({
      data: {
        staffId,
        type: b.type,
        fromDate: from,
        toDate: to,
        halfDay,
        halfSession,
        days: leaveDays(from, to, halfDay),
        reason: b.reason || null,
        status: 'PENDING',
      },
    });
    return NextResponse.json(row);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
