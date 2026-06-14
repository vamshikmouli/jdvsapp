import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { parseSessions } from '@/lib/attendance/sessions';

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

// GET /api/parent/attendance?studentId=..&month=YYYY-MM
// Returns the day-by-day status for one of the guardian's children, for a month.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get('studentId') || '';
    const month = searchParams.get('month') || ''; // YYYY-MM

    // Must be this guardian's child
    const student = await prisma.student.findFirst({
      where: { id: studentId, guardianUserId: userId },
      select: { id: true },
    });
    if (!student) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const m = /^(\d{4})-(\d{2})$/.exec(month);
    const now = new Date();
    const year = m ? Number(m[1]) : now.getUTCFullYear();
    const mon = m ? Number(m[2]) - 1 : now.getUTCMonth();
    const start = new Date(Date.UTC(year, mon, 1));
    const end = new Date(Date.UTC(year, mon + 1, 1));

    const orderedKeys = parseSessions(
      (await prisma.settings.findUnique({ where: { id: 'singleton' } }))?.sessions
    ).map((s) => s.key);
    const rank = (slot: string) => {
      const i = orderedKeys.indexOf(slot);
      return i === -1 ? 999 : i;
    };

    const records = await prisma.attendanceRecord.findMany({
      where: { studentId, session: { date: { gte: start, lt: end } } },
      select: { status: true, session: { select: { date: true, slot: true } } },
    });

    // dayKey -> { status, rank } (first configured session wins)
    const byDay = new Map<string, { status: string; rank: number }>();
    for (const r of records) {
      const dk = dateKey(new Date(r.session.date));
      const rk = rank(r.session.slot);
      const cur = byDay.get(dk);
      if (!cur || rk < cur.rank) byDay.set(dk, { status: r.status, rank: rk });
    }

    const statuses: Record<string, string> = {};
    let present = 0, absent = 0, leave = 0, late = 0;
    byDay.forEach((v, k) => {
      statuses[k] = v.status;
      if (v.status === 'PRESENT') present += 1;
      else if (v.status === 'ABSENT') absent += 1;
      else if (v.status === 'LEAVE') leave += 1;
      else if (v.status === 'LATE') late += 1;
    });
    const marked = present + absent + leave + late;

    return NextResponse.json({
      month: `${year}-${String(mon + 1).padStart(2, '0')}`,
      statuses,
      summary: { present, absent, leave, late, marked, pct: marked ? Math.round(((present + late) / marked) * 100) : 0 },
    });
  } catch (err) {
    console.error('parent attendance error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
