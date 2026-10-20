import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRequestUserId } from '@/lib/auth/mobileSession';
import { parseSessions } from '@/lib/attendance/sessions';
import { computeStreakStats, type DayStatus } from '@/lib/streaks';
import { getActiveYear, getStudentAccount } from '@/lib/services/fees';

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDaysUTC(d: Date, n: number) {
  const o = new Date(d);
  o.setUTCDate(o.getUTCDate() + n);
  return o;
}

// GET /api/parent/home — one aggregated payload for the parent app's Home tab:
// each child's attendance (last 30 days + current month stats), attendance
// streak, fee summary, plus school branding. Composed from the same sources as
// the individual /api/parent/{children,streaks,fees} routes so numbers match.
export async function GET() {
  try {
    const userId = await getRequestUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const children = await prisma.student.findMany({
      where: { guardianUserId: userId },
      include: { class: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const settingsRow = await prisma.settings.findUnique({
      where: { id: 'singleton' },
      select: { schoolName: true, logoUrl: true, sessions: true },
    });
    const branding = {
      schoolName: settingsRow?.schoolName || 'Jnana Deepika',
      logoUrl: settingsRow?.logoUrl || null,
    };

    if (children.length === 0) return NextResponse.json({ children: [], branding });

    const childIds = children.map((c) => c.id);

    // First configured session is the canonical roll call for a day's status.
    const orderedKeys = parseSessions(settingsRow?.sessions).map((s) => s.key);
    const rank = (slot: string) => {
      const i = orderedKeys.indexOf(slot);
      return i === -1 ? 999 : i;
    };

    // Date windows (UTC). Pull ~12 months so the streak is accurate; the 30-day
    // slice below drives the week strip + month stats.
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const since = addDaysUTC(today, -365);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const todayKey = dateKey(today);

    const records = await prisma.attendanceRecord.findMany({
      where: { studentId: { in: childIds }, session: { date: { gte: since } } },
      select: { studentId: true, status: true, session: { select: { date: true, slot: true } } },
    });

    // child -> dayKey -> status (deduped by first configured session)
    const byChildDay = new Map<string, Map<string, { status: string; rank: number }>>();
    for (const r of records) {
      const dk = dateKey(new Date(r.session.date));
      if (!byChildDay.has(r.studentId)) byChildDay.set(r.studentId, new Map());
      const dm = byChildDay.get(r.studentId)!;
      const rk = rank(r.session.slot);
      const cur = dm.get(dk);
      if (!cur || rk < cur.rank) dm.set(dk, { status: r.status, rank: rk });
    }

    // Active fee year (one lookup for everyone).
    let year: Awaited<ReturnType<typeof getActiveYear>> | null = null;
    try {
      year = await getActiveYear();
    } catch {
      year = null;
    }

    const result = await Promise.all(
      children.map(async (c) => {
        const dm = byChildDay.get(c.id) || new Map<string, { status: string; rank: number }>();

        // Last 30 calendar days for the week strip; current-month attendance stats.
        let present = 0, absent = 0, leave = 0, marked = 0;
        const days: { date: string; status: string }[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = addDaysUTC(today, -i);
          const dk = dateKey(d);
          const st = dm.get(dk)?.status || null;
          days.push({ date: dk, status: st || 'none' });
          if (st && d >= monthStart) {
            marked += 1;
            if (st === 'PRESENT' || st === 'LATE') present += 1;
            else if (st === 'ABSENT') absent += 1;
            else if (st === 'LEAVE') leave += 1;
          }
        }

        // Streak over the full window (marked days only — no 'none').
        const allDays: DayStatus[] = Array.from(dm.entries()).map(([date, v]) => ({ date, status: v.status }));
        const stats = computeStreakStats(allDays);

        // Fee summary for the active year (null if the child has no account yet).
        let fee: { totalCharged: number; totalPaid: number; totalBalance: number } | null = null;
        if (year) {
          try {
            const account = await getStudentAccount(c.id, year.id);
            if (account) {
              fee = {
                totalCharged: account.summary.totalCharged,
                totalPaid: account.summary.totalPaid,
                totalBalance: account.summary.totalBalance,
              };
            }
          } catch {
            fee = null;
          }
        }

        return {
          id: c.id,
          name: c.name,
          photoUrl: c.photoUrl,
          className: c.class?.name || 'Unassigned',
          roll: c.roll,
          todayStatus: dm.get(todayKey)?.status || 'none',
          present, absent, leave, marked,
          pct: marked ? Math.round((present / marked) * 100) : 0,
          days,
          fee,
          streak: { current: stats.currentStreak, longest: stats.longestStreak },
        };
      }),
    );

    return NextResponse.json({ children: result, branding, year: year?.label });
  } catch (err) {
    console.error('parent home error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
