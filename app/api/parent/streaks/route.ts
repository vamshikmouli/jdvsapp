import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { parseSessions } from '@/lib/attendance/sessions';
import { computeStreakStats, earnedBadges, type DayStatus } from '@/lib/streaks';

function dateKey(d: Date) { return d.toISOString().slice(0, 10); }

// GET /api/parent/streaks?studentId=..
// Attendance streak + badges for one of the guardian's children (last ~12 months).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const studentId = new URL(req.url).searchParams.get('studentId') || '';
    const student = await prisma.student.findFirst({
      where: { id: studentId, guardianUserId: userId },
      select: { id: true },
    });
    if (!student) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const since = new Date(Date.now() - 366 * 24 * 3600_000);
    const orderedKeys = parseSessions(
      (await prisma.settings.findUnique({ where: { id: 'singleton' } }))?.sessions
    ).map((s) => s.key);
    const rank = (slot: string) => {
      const i = orderedKeys.indexOf(slot);
      return i === -1 ? 999 : i;
    };

    const records = await prisma.attendanceRecord.findMany({
      where: { studentId, session: { date: { gte: since } } },
      select: { status: true, session: { select: { date: true, slot: true } } },
    });

    // Collapse multiple sessions per day → the first configured session wins.
    const byDay = new Map<string, { status: string; rank: number }>();
    for (const r of records) {
      const dk = dateKey(new Date(r.session.date));
      const rk = rank(r.session.slot);
      const cur = byDay.get(dk);
      if (!cur || rk < cur.rank) byDay.set(dk, { status: r.status, rank: rk });
    }
    const days: DayStatus[] = Array.from(byDay.entries()).map(([date, v]) => ({ date, status: v.status }));

    const stats = computeStreakStats(days);
    const badges = earnedBadges(days, stats);
    return NextResponse.json({ stats, badges });
  } catch (err) {
    console.error('parent streaks error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
