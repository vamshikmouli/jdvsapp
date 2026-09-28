import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { getClassScope } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST

// GET /api/dashboard/attendance-coverage?month=YYYY-MM
// Per class × per day of the month: was attendance taken (any session with marks)?
// Used by the dashboard coverage heatmap so admins can spot classes/days that were
// missed at a glance.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(req.url).searchParams;
    const month = sp.get('month') || todayIso().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });

    const [yy, mm] = month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(yy, mm - 1, 1));
    const monthEnd = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
    const nDays = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const today = todayIso();

    const scope = await getClassScope(session);
    const classFilter = scope.all ? {} : { id: { in: scope.classIds } };
    const sessionClassFilter = scope.all ? {} : { classId: { in: scope.classIds } };

    const [classes, sessions, holidayRows] = await Promise.all([
      prisma.schoolClass.findMany({ where: classFilter, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
      prisma.attendanceSession.findMany({
        where: { ...sessionClassFilter, date: { gte: monthStart, lte: monthEnd } },
        select: { classId: true, date: true, _count: { select: { records: true } } },
      }),
      prisma.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } }, select: { date: true, name: true } }),
    ]);

    const holidayMap = new Map(holidayRows.map((h) => [iso(h.date), h.name]));
    const days = Array.from({ length: nDays }, (_, i) => {
      const d = new Date(Date.UTC(yy, mm - 1, i + 1));
      const key = iso(d);
      return { day: i + 1, dow: d.getUTCDay(), sunday: d.getUTCDay() === 0, holiday: holidayMap.get(key) || null, future: key > today };
    });
    const offDay = (day: number) => { const d = days[day - 1]; return d.sunday || !!d.holiday || d.future; };
    const schoolDays = days.filter((d) => !d.sunday && !d.holiday && !d.future).length;

    // classId -> set of day numbers that have marks (any session with records > 0).
    const takenByClass = new Map<string, Set<number>>();
    for (const s of sessions) {
      if (s._count.records === 0) continue;
      const day = new Date(s.date).getUTCDate();
      let set = takenByClass.get(s.classId);
      if (!set) { set = new Set(); takenByClass.set(s.classId, set); }
      set.add(day);
    }

    const out = classes.map((c) => {
      const set = takenByClass.get(c.id) || new Set<number>();
      const taken = Array.from(set).sort((a, b) => a - b);
      const markedSchoolDays = taken.filter((d) => !offDay(d)).length;
      return { id: c.id, name: c.name, taken, marked: markedSchoolDays, schoolDays };
    });

    return NextResponse.json({ monthLabel: `${MONTHS[mm - 1]} ${yy}`, month, nDays, days, classes: out, schoolDays });
  } catch (err) {
    console.error('dashboard/attendance-coverage GET', err);
    return NextResponse.json({ error: 'Failed to load coverage' }, { status: 500 });
  }
}
