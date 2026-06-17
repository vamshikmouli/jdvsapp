import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, can, authErrorResponse } from '@/lib/rbac/roles';
import { getBalances, getLeaveYearStartMonth, leaveYearOf, LEAVE_TYPES } from '@/lib/staffAttendance/leaveBalance';

// GET /api/leave/balance?staffId=&year=  — leave balances for a staff member
// (self by default; LEAVE_APPROVE may query anyone). `year` = leave-year start year.
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = new URL(req.url).searchParams;
    const myStaffId = (session.user as any)?.staffId as string | undefined;
    const staffId = sp.get('staffId') || myStaffId;
    if (!staffId) return NextResponse.json({ error: 'No staff profile' }, { status: 400 });
    if (staffId !== myStaffId && !can(session, 'LEAVE_APPROVE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const startMonth = await getLeaveYearStartMonth();
    const ref = sp.get('year') ? new Date(Date.UTC(Number(sp.get('year')), startMonth - 1, 2)) : new Date();
    const ly = leaveYearOf(ref, startMonth);
    const balances = await getBalances(staffId, ly);
    return NextResponse.json({ year: ly.label, startYear: ly.startYear, balances });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// POST /api/leave/balance — set/clear a per-staff entitlement override (LEAVE_APPROVE)
// { staffId, year, type, days }   — days === null clears the override
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!can(session, 'LEAVE_APPROVE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { staffId, year, type, days } = await req.json();
    if (!staffId || !type || !LEAVE_TYPES.includes(type) || typeof year !== 'number') {
      return NextResponse.json({ error: 'staffId, year and a valid type are required' }, { status: 400 });
    }

    if (days === null || days === undefined || days === '') {
      await prisma.leaveEntitlement.deleteMany({ where: { staffId, leaveYear: year, type } });
      return NextResponse.json({ ok: true, cleared: true });
    }
    const d = Number(days);
    if (isNaN(d) || d < 0) return NextResponse.json({ error: 'Invalid days' }, { status: 400 });
    const row = await prisma.leaveEntitlement.upsert({
      where: { staffId_leaveYear_type: { staffId, leaveYear: year, type } },
      update: { days: d },
      create: { staffId, leaveYear: year, type, days: d },
    });
    return NextResponse.json({ ok: true, entitlement: row });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
