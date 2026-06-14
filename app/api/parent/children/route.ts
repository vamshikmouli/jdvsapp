import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { parseSessions } from '@/lib/attendance/sessions';

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDaysUTC(d: Date, n: number) {
  const o = new Date(d);
  o.setUTCDate(o.getUTCDate() + n);
  return o;
}

// GET /api/parent/children — the logged-in guardian's children + attendance summary
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const children = await prisma.student.findMany({
      where: { guardianUserId: userId },
      include: { class: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    if (children.length === 0) return NextResponse.json({ children: [] });

    const childIds = children.map((c) => c.id);

    // Configured sessions (first = canonical roll call for a day's status)
    const settingsRow = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    const orderedKeys = parseSessions(settingsRow?.sessions).map((s) => s.key);

    // Date windows (UTC)
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const since = addDaysUTC(today, -29); // last 30 days
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const todayKey = dateKey(today);

    const records = await prisma.attendanceRecord.findMany({
      where: { studentId: { in: childIds }, session: { date: { gte: since } } },
      select: { studentId: true, status: true, session: { select: { date: true, slot: true } } },
    });

    // child -> dayKey -> status (deduped by first configured session)
    const rank = (slot: string) => {
      const i = orderedKeys.indexOf(slot);
      return i === -1 ? 999 : i;
    };
    const byChildDay = new Map<string, Map<string, { status: string; rank: number }>>();
    for (const r of records) {
      const dk = dateKey(new Date(r.session.date));
      if (!byChildDay.has(r.studentId)) byChildDay.set(r.studentId, new Map());
      const dm = byChildDay.get(r.studentId)!;
      const rk = rank(r.session.slot);
      const cur = dm.get(dk);
      if (!cur || rk < cur.rank) dm.set(dk, { status: r.status, rank: rk });
    }

    const result = children.map((c) => {
      const dm = byChildDay.get(c.id) || new Map();
      let present = 0, absent = 0, leave = 0, marked = 0;
      const days: { date: string; status: string }[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = addDaysUTC(today, -i);
        const dk = dateKey(d);
        const st = dm.get(dk)?.status || null;
        days.push({ date: dk, status: st || 'none' });
        // month stats (current calendar month only)
        if (st && d >= monthStart) {
          marked += 1;
          if (st === 'PRESENT' || st === 'LATE') present += 1;
          else if (st === 'ABSENT') absent += 1;
          else if (st === 'LEAVE') leave += 1;
        }
      }
      return {
        id: c.id,
        name: c.name,
        className: c.class?.name || 'Unassigned',
        roll: c.roll,
        gender: c.gender,
        todayStatus: dm.get(todayKey)?.status || 'none',
        present, absent, leave, marked,
        pct: marked ? Math.round((present / marked) * 100) : 0,
        days,
      };
    });

    return NextResponse.json({ children: result });
  } catch (err) {
    console.error('parent children error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
