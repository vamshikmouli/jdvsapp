import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, canAny, getClassScope } from '@/lib/rbac/roles';
import { getActiveYear } from '@/lib/services/fees';
import { parseSessions } from '@/lib/attendance/sessions';
import type { AttendanceStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
// Today's calendar date in IST — attendance can't be marked for future days.
const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const VALID: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'EXCUSED'];

async function classInScope(session: any, classId: string): Promise<boolean> {
  const scope = await getClassScope(session);
  return scope.all || scope.classIds.includes(classId);
}

// The register writes one mark per day into the school's FIRST configured session.
async function primarySlot(): Promise<string> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { sessions: true } });
  return parseSessions(s?.sessions)[0]?.key || 'MORNING';
}

// GET /api/attendance/register?classId=&month=YYYY-MM
// Month grid: roster + a day column list (with Sunday/holiday flags) + saved marks.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAny(session, ['ATTENDANCE_REGISTER', 'SETTINGS_MANAGE'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const sp = new URL(req.url).searchParams;
    const classId = sp.get('classId');
    const month = sp.get('month'); // YYYY-MM
    if (!classId || !/^\d{4}-\d{2}$/.test(month || '')) {
      return NextResponse.json({ error: 'classId and month (YYYY-MM) are required' }, { status: 400 });
    }
    if (!(await classInScope(session, classId))) {
      return NextResponse.json({ error: 'You are not assigned to this class' }, { status: 403 });
    }

    const [yy, mm] = month!.split('-').map(Number);
    const monthStart = new Date(Date.UTC(yy, mm - 1, 1));
    const monthEnd = new Date(Date.UTC(yy, mm, 0, 23, 59, 59)); // last day
    const nDays = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const slot = await primarySlot();

    const [year, holidayRows] = await Promise.all([
      getActiveYear(),
      prisma.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } }, select: { date: true, name: true } }),
    ]);
    const holidayMap = new Map(holidayRows.map((h) => [iso(h.date), h.name]));

    const enr = await prisma.enrollment.findMany({
      where: { yearId: year.id, classId, status: 'ACTIVE', student: { status: 'ACTIVE' } },
      orderBy: [{ student: { name: 'asc' } }],
      include: { student: { select: { id: true, name: true } } },
    });
    const roster = enr.map((e) => ({ id: e.student.id, name: e.student.name }));

    // Day columns with weekday + Sunday/holiday/future flags.
    const today = todayIso();
    const days = Array.from({ length: nDays }, (_, i) => {
      const d = new Date(Date.UTC(yy, mm - 1, i + 1));
      const key = iso(d);
      return { day: i + 1, iso: key, dow: d.getUTCDay(), sunday: d.getUTCDay() === 0, holiday: holidayMap.get(key) || null, future: key > today };
    });

    // Existing marks for the primary session across the month.
    const sessions = await prisma.attendanceSession.findMany({
      where: { classId, slot, date: { gte: monthStart, lte: monthEnd } },
      select: { date: true, locked: true, records: { select: { studentId: true, status: true } } },
    });
    const marks: Record<string, Record<number, AttendanceStatus>> = {};
    const lockedDays: string[] = [];
    for (const s of sessions) {
      const day = new Date(s.date).getUTCDate();
      if (s.locked) lockedDays.push(iso(s.date));
      for (const r of s.records) {
        (marks[r.studentId] ||= {})[day] = r.status;
      }
    }

    return NextResponse.json({
      monthLabel: `${MONTHS[mm - 1]} ${yy}`,
      month, slot, nDays, days, roster, marks, lockedDays,
    });
  } catch (err) {
    console.error('attendance/register GET', err);
    return NextResponse.json({ error: 'Failed to load register' }, { status: 500 });
  }
}

// PUT /api/attendance/register
// Body: { classId, month:'YYYY-MM', cells: [{ studentId, day, status }] }
// Saves the whole month grid — one session per day at the primary slot. Sundays
// and declared holidays are skipped. Locked days are skipped unless the user can
// reopen sessions. Returns how many marks were written and which days were skipped.
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAny(session, ['ATTENDANCE_REGISTER', 'ATTENDANCE_MARK', 'SETTINGS_MANAGE'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const classId = String(body?.classId || '');
    const month = String(body?.month || '');
    const cells = Array.isArray(body?.cells) ? body.cells : [];
    if (!classId || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'classId and month (YYYY-MM) are required' }, { status: 400 });
    }
    if (!(await classInScope(session, classId))) {
      return NextResponse.json({ error: 'You are not assigned to this class' }, { status: 403 });
    }

    const [yy, mm] = month.split('-').map(Number);
    const nDays = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const monthStart = new Date(Date.UTC(yy, mm - 1, 1));
    const monthEnd = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
    const slot = await primarySlot();
    const canReopen = can(session, 'ATTENDANCE_LOCK');
    const uid = (session.user as any).id;

    // Which days are off (Sunday or holiday) — never create sessions for them.
    const holidayRows = await prisma.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } }, select: { date: true } });
    const holidaySet = new Set(holidayRows.map((h) => iso(h.date)));
    const today = todayIso();
    const isOff = (day: number) => {
      const d = new Date(Date.UTC(yy, mm - 1, day));
      const key = iso(d);
      return d.getUTCDay() === 0 || holidaySet.has(key) || key > today; // Sunday / holiday / future
    };

    // Group incoming cells by day.
    const byDay = new Map<number, { studentId: string; status: AttendanceStatus }[]>();
    for (const c of cells) {
      const day = Number(c?.day);
      const studentId = String(c?.studentId || '');
      const status = String(c?.status || '') as AttendanceStatus;
      if (!studentId || !Number.isInteger(day) || day < 1 || day > nDays || !VALID.includes(status)) continue;
      if (isOff(day)) continue;
      (byDay.get(day) || byDay.set(day, []).get(day)!).push({ studentId, status });
    }

    let written = 0;
    const skippedLockedDays: string[] = [];
    for (const [day, recs] of byDay) {
      if (!recs.length) continue;
      const date = new Date(Date.UTC(yy, mm - 1, day));
      let sess = await prisma.attendanceSession.findUnique({ where: { classId_date_slot: { classId, date, slot } } });
      if (sess?.locked && !canReopen) { skippedLockedDays.push(iso(date)); continue; }
      if (!sess) sess = await prisma.attendanceSession.create({ data: { classId, date, slot, takenById: uid } });
      const sessionId = sess.id;
      await prisma.$transaction(
        recs.map((r) =>
          prisma.attendanceRecord.upsert({
            where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
            update: { status: r.status },
            create: { sessionId, studentId: r.studentId, status: r.status },
          }),
        ),
      );
      written += recs.length;
    }

    return NextResponse.json({ ok: true, written, days: byDay.size, skippedLockedDays });
  } catch (err) {
    console.error('attendance/register PUT', err);
    return NextResponse.json({ error: 'Failed to save register' }, { status: 500 });
  }
}
