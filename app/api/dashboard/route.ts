import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { getClassScope, can } from '@/lib/rbac/roles';
import { parseSessions } from '@/lib/attendance/sessions';
import { getActiveYear } from '@/lib/services/fees';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo } from '@/lib/staffAttendance/rules';
import { daySession, emptyStatusForSession, parseWeekSchedule, parseWorkPattern, parseWorkDays, weekdayOfKey } from '@/lib/staffAttendance/schedule';

// Use UTC date components consistently — attendance sessions are stored at
// UTC midnight (parsed from "YYYY-MM-DD"), and the attendance page uses the
// UTC date string for "today", so the dashboard must match.
function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDaysUTC(d: Date, days: number) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Scope everything class-bound to the user's assigned classes (unless all-access)
    const scope = await getClassScope(session);
    const classFilter = scope.all ? {} : { id: { in: scope.classIds } };
    const sessionClassFilter = scope.all ? {} : { classId: { in: scope.classIds } };
    const studentClassFilter = scope.all ? {} : { classId: { in: scope.classIds } };

    // Roster KPIs are for the SELECTED academic year (enrollment-based).
    const year = await getActiveYear();
    const enrClassScope = scope.all ? {} : { classId: { in: scope.classIds } };
    const [studentsTotal, studentsActive, staffTotal, classesTotal] = await Promise.all([
      prisma.enrollment.count({ where: { yearId: year.id, status: 'ACTIVE', ...enrClassScope } }),
      prisma.enrollment.count({ where: { yearId: year.id, status: 'ACTIVE', student: { status: 'ACTIVE' }, ...enrClassScope } }),
      prisma.staff.count(),
      prisma.schoolClass.count({ where: { ...classFilter } }),
    ]);

    // --- Date range: last 14 days (inclusive of today), in UTC ---
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = addDaysUTC(today, -13);

    // Pull all sessions in range with their records
    const sessions = await prisma.attendanceSession.findMany({
      where: { date: { gte: start }, ...sessionClassFilter },
      include: {
        records: { select: { status: true } },
        class: { select: { id: true, name: true } },
      },
      orderBy: { date: 'asc' },
    });

    // --- 14-day chart: present / total marked per day ---
    const byDay: Record<string, { present: number; total: number }> = {};
    for (let i = 0; i < 14; i++) {
      byDay[dateKey(addDaysUTC(start, i))] = { present: 0, total: 0 };
    }

    sessions.forEach((s) => {
      const key = dateKey(new Date(s.date));
      if (!byDay[key]) return;
      s.records.forEach((r) => {
        byDay[key].total += 1;
        if (r.status === 'PRESENT' || r.status === 'LATE') byDay[key].present += 1;
      });
    });

    const chart = Object.keys(byDay)
      .sort()
      .map((key) => {
        const { present, total } = byDay[key];
        return {
          date: key,
          present,
          total,
          pct: total ? Math.round((present / total) * 1000) / 10 : 0,
        };
      });

    // --- Configured sessions (school-wide) ---
    const settingsRow = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    const sessionDefs = parseSessions(settingsRow?.sessions);
    const orderedKeys = sessionDefs.map((s) => s.key);

    // --- Today's attendance (deduped per student) ---
    // Each student counted once/day. The FIRST configured session is the canonical
    // roll call; later sessions only fill gaps.
    const todayKey = dateKey(today);
    const todaySessions = sessions.filter((s) => dateKey(new Date(s.date)) === todayKey);

    // Need per-record studentId + slot + class — re-query today's records.
    const todayRecords = await prisma.attendanceRecord.findMany({
      where: { session: { date: today, ...sessionClassFilter } },
      select: { studentId: true, status: true, session: { select: { slot: true, classId: true } } },
    });

    const statusByStudent = new Map<string, string>();
    // Per-class: classId -> Map<studentId, status>  (deduped, first session canonical)
    const statusByClass = new Map<string, Map<string, string>>();
    const setIfAbsent = (map: Map<string, string>, k: string, v: string) => {
      if (!map.has(k)) map.set(k, v);
    };
    // Configured sessions in order — first occurrence wins
    for (const key of orderedKeys) {
      todayRecords.forEach((r) => {
        if (r.session.slot !== key) return;
        setIfAbsent(statusByStudent, r.studentId, r.status);
        const cid = r.session.classId;
        if (!statusByClass.has(cid)) statusByClass.set(cid, new Map());
        setIfAbsent(statusByClass.get(cid)!, r.studentId, r.status);
      });
    }
    // Any records on legacy/unknown slots — fill remaining gaps
    todayRecords.forEach((r) => {
      setIfAbsent(statusByStudent, r.studentId, r.status);
      const cid = r.session.classId;
      if (!statusByClass.has(cid)) statusByClass.set(cid, new Map());
      setIfAbsent(statusByClass.get(cid)!, r.studentId, r.status);
    });

    let present = 0,
      absent = 0,
      leave = 0,
      late = 0;
    const absentIds: string[] = [];
    const leaveIds: string[] = [];
    statusByStudent.forEach((status, sid) => {
      if (status === 'PRESENT') present += 1;
      else if (status === 'ABSENT') { absent += 1; absentIds.push(sid); }
      else if (status === 'LEAVE') { leave += 1; leaveIds.push(sid); }
      else if (status === 'LATE') late += 1;
    });
    const marked = statusByStudent.size;
    const todayPct = marked ? Math.round(((present + late) / marked) * 1000) / 10 : 0;

    // Names of absent / on-leave students (for dashboard hover tooltips)
    const flaggedStudents = await prisma.student.findMany({
      where: { id: { in: [...absentIds, ...leaveIds] } },
      select: { id: true, name: true, class: { select: { name: true } } },
    });
    const nameOf = new Map(
      flaggedStudents.map((s) => [s.id, s.class ? `${s.name} (${s.class.name.replace(/\s?STD$/, '')})` : s.name])
    );
    const absentNames = absentIds.map((id) => nameOf.get(id) || '').filter(Boolean).sort();
    const leaveNames = leaveIds.map((id) => nameOf.get(id) || '').filter(Boolean).sort();

    // --- Today's sessions overview (per class: morning/afternoon taken?) ---
    const classes = await prisma.schoolClass.findMany({
      where: { ...classFilter },
      orderBy: { order: 'asc' },
    });
    // Per-class roster size for the selected year (enrollment-based).
    const enrGrouped = await prisma.enrollment.groupBy({
      by: ['classId'],
      where: { yearId: year.id, status: 'ACTIVE', student: { status: 'ACTIVE' } },
      _count: { _all: true },
    });
    const studentsByClass: Record<string, number> = Object.fromEntries(enrGrouped.map((g) => [g.classId, g._count._all]));
    const sessionMap = new Map<string, { locked: boolean; count: number }>();
    todaySessions.forEach((s) => sessionMap.set(`${s.classId}|${s.slot}`, { locked: s.locked, count: s.records.length }));

    const todaySessionRows = classes.map((c) => ({
      classId: c.id,
      className: c.name,
      students: studentsByClass[c.id] || 0,
      slots: sessionDefs.map((def) => {
        const e = sessionMap.get(`${c.id}|${def.key}`);
        const status = !e || e.count === 0 ? 'pending' : e.locked ? 'locked' : 'taken';
        return { key: def.key, label: def.label, status };
      }),
    }));

    // --- Class-wise attendance (today) ---
    const classAttendance = classes.map((c) => {
      const m = statusByClass.get(c.id);
      let cPresent = 0,
        cAbsent = 0,
        cLeave = 0;
      if (m) {
        m.forEach((st) => {
          if (st === 'PRESENT' || st === 'LATE') cPresent += 1;
          else if (st === 'ABSENT') cAbsent += 1;
          else if (st === 'LEAVE') cLeave += 1;
        });
      }
      const cMarked = m ? m.size : 0;
      return {
        classId: c.id,
        className: c.name,
        total: studentsByClass[c.id] || 0,
        marked: cMarked,
        present: cPresent,
        absent: cAbsent,
        leave: cLeave,
        pct: cMarked ? Math.round((cPresent / cMarked) * 1000) / 10 : 0,
      };
    });

    // --- Recent activity: latest sessions + latest students ---
    const recentSessions = await prisma.attendanceSession.findMany({
      where: { ...sessionClassFilter },
      take: 5,
      orderBy: { updatedAt: 'desc' },
      include: { class: { select: { name: true } }, _count: { select: { records: true } } },
    });

    const recentStudents = await prisma.student.findMany({
      where: { ...studentClassFilter },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, createdAt: true, class: { select: { name: true } } },
    });

    const activity = [
      ...recentSessions.map((s) => ({
        type: 'attendance' as const,
        text: `Attendance ${s.locked ? 'closed' : 'taken'} for ${s.class.name} · ${s.slot === 'MORNING' ? 'Morning' : 'Afternoon'}`,
        meta: `${s._count.records} students`,
        at: s.updatedAt,
      })),
      ...recentStudents.map((s) => ({
        type: 'student' as const,
        text: `Student added: ${s.name}`,
        meta: s.class?.name || 'Unassigned',
        at: s.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8);

    // --- Staff attendance (today) — only for users who can view it ---
    // Mirrors the staff-attendance board: stored day status, else the derived
    // empty-day status (holiday / weekly-off / absent) from each staff schedule.
    let staffToday: {
      present: number; halfDay: number; absent: number; leave: number; off: number; late: number; total: number;
    } | null = null;
    if (can(session, 'STAFF_ATTENDANCE_VIEW')) {
      const cfg = await loadStaffAttConfig();
      const staffDateKey = localDayInfo(new Date(), cfg.timezone).dateKey;
      const staffDate = new Date(`${staffDateKey}T00:00:00Z`);
      const staffWeekday = weekdayOfKey(staffDateKey);
      const [staffRows, staffDays, staffHoliday] = await Promise.all([
        prisma.staff.findMany({
          where: { archived: false, NOT: { user: { role: { key: 'admin' } } } },
          select: { id: true, weekSchedule: true, workPattern: true, workDays: true },
        }),
        prisma.staffAttendanceDay.findMany({ where: { date: staffDate }, select: { staffId: true, status: true, late: true } }),
        prisma.holiday.findUnique({ where: { date: staffDate }, select: { id: true } }),
      ]);
      const dayByStaff = new Map(staffDays.map((d) => [d.staffId, d]));
      const s = { present: 0, halfDay: 0, absent: 0, leave: 0, off: 0, late: 0, total: staffRows.length };
      for (const st of staffRows) {
        const day = dayByStaff.get(st.id);
        const status = day?.status ?? emptyStatusForSession(
          daySession(staffWeekday, parseWeekSchedule(st.weekSchedule), { workPattern: parseWorkPattern(st.workPattern), workDays: parseWorkDays(st.workDays) }, cfg.schedule.weeklyOffDays),
          !!staffHoliday
        );
        if (status === 'PRESENT') s.present += 1;
        else if (status === 'HALF_DAY') s.halfDay += 1;
        else if (status === 'LEAVE') s.leave += 1;
        else if (status === 'HOLIDAY' || status === 'WEEKLY_OFF') s.off += 1;
        else s.absent += 1;
        if (day?.late) s.late += 1;
      }
      staffToday = s;
    }

    return NextResponse.json({
      kpis: { studentsTotal, studentsActive, staffTotal, classesTotal },
      today: { present, absent, leave, late, marked, pct: todayPct, activeStudents: studentsActive, absentNames, leaveNames },
      staffToday,
      chart,
      todaySessions: todaySessionRows,
      classAttendance,
      activity,
    });
  } catch (error) {
    console.error('Error building dashboard:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
