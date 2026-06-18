import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

// GET  /api/staff-attendance/holidays?from=&to=   — list holidays (default: this year)
// POST /api/staff-attendance/holidays  { date, name }   — declare a holiday
// DELETE /api/staff-attendance/holidays?date=YYYY-MM-DD — remove a holiday
export async function GET(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_VIEW');
    const sp = new URL(req.url).searchParams;
    const year = new Date().getFullYear();
    const from = new Date(`${sp.get('from') || `${year}-01-01`}T00:00:00Z`);
    const to = new Date(`${sp.get('to') || `${year}-12-31`}T00:00:00Z`);
    const holidays = await prisma.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    return NextResponse.json(holidays);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_CONFIG');
    const { date, name } = await req.json();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !name?.trim()) {
      return NextResponse.json({ error: 'A date and a name are required.' }, { status: 400 });
    }
    const d = new Date(`${date}T00:00:00Z`);
    const holiday = await prisma.holiday.upsert({
      where: { date: d },
      update: { name: name.trim() },
      create: { date: d, name: name.trim() },
    });
    // Flip already-stored no-punch days to HOLIDAY so the board/calendar reflect it.
    await prisma.staffAttendanceDay.updateMany({
      where: { date: d, firstIn: null },
      data: { status: 'HOLIDAY', late: false, lateMinutes: 0 },
    });
    return NextResponse.json(holiday);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_CONFIG');
    const date = new URL(req.url).searchParams.get('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return NextResponse.json({ error: 'date required' }, { status: 400 });
    }
    const d = new Date(`${date}T00:00:00Z`);
    await prisma.holiday.deleteMany({ where: { date: d } });
    // Drop the HOLIDAY rows we auto-created (no punches) so they re-derive as off/absent.
    await prisma.staffAttendanceDay.deleteMany({ where: { date: d, firstIn: null, status: 'HOLIDAY' } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
