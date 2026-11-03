import { prisma } from '@/lib/db';
import type { AttendanceStatus } from '@prisma/client';

/**
 * Write a month register's marks: for each day, the class's session at `slot` (created
 * already locked, or locked if it exists) and each student's status. The register IS
 * the submission, so it always overwrites (no lock-skip) to stay re-editable.
 * Returns how many marks were written.
 */
export async function writeRegisterDays(
  classId: string, yy: number, mm: number, slot: string, uid: string | null,
  byDay: Map<number, { studentId: string; status: AttendanceStatus }[]>,
): Promise<number> {
  // Same result as one session lookup + one upsert per student per day, in a handful of
  // queries: the month's sessions and records are read once, new rows are inserted in
  // bulk, and only records whose status changed are updated (grouped by status).
  const days = Array.from(byDay.entries()).filter(([, recs]) => recs.length);
  if (!days.length) return 0;
  const dateOf = (d: number) => new Date(Date.UTC(yy, mm - 1, d));
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const dates = days.map(([d]) => dateOf(d));

  const findSessions = () => prisma.attendanceSession.findMany({ where: { classId, slot, date: { in: dates } }, select: { id: true, date: true, locked: true } });
  let sessions = await findSessions();
  const have = new Set(sessions.map((s) => key(s.date)));
  const missing = dates.filter((d) => !have.has(key(d)));
  if (missing.length) {
    // skipDuplicates: if another save created a day meanwhile, keep theirs (as findUnique would have).
    await prisma.attendanceSession.createMany({ data: missing.map((date) => ({ classId, date, slot, takenById: uid, locked: true })), skipDuplicates: true });
    sessions = await findSessions();
  }
  const sessionByDay = new Map(sessions.map((s) => [key(s.date), s]));

  // Wanted status per (session, student) — later cells for the same student win.
  const wanted = new Map<string, Map<string, AttendanceStatus>>();
  let written = 0;
  for (const [d, recs] of days) {
    const sess = sessionByDay.get(key(dateOf(d)));
    if (!sess) continue;
    const m = wanted.get(sess.id) || wanted.set(sess.id, new Map()).get(sess.id)!;
    for (const r of recs) m.set(r.studentId, r.status);
    written += recs.length;
  }

  const sessionIds = Array.from(wanted.keys());
  const existing = await prisma.attendanceRecord.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true, sessionId: true, studentId: true, status: true } });
  const current = new Map(existing.map((r) => [`${r.sessionId}|${r.studentId}`, r]));
  const toCreate: { sessionId: string; studentId: string; status: AttendanceStatus }[] = [];
  const toUpdate = new Map<AttendanceStatus, string[]>(); // new status → record ids
  for (const [sessionId, m] of wanted) {
    for (const [studentId, status] of m) {
      const r = current.get(`${sessionId}|${studentId}`);
      if (!r) toCreate.push({ sessionId, studentId, status });
      else if (r.status !== status) (toUpdate.get(status) || toUpdate.set(status, []).get(status)!).push(r.id);
    }
  }
  const toLock = sessions.filter((s) => wanted.has(s.id) && !s.locked).map((s) => s.id);

  await prisma.$transaction([
    ...(toCreate.length ? [prisma.attendanceRecord.createMany({ data: toCreate, skipDuplicates: true })] : []),
    ...Array.from(toUpdate.entries()).map(([status, ids]) => prisma.attendanceRecord.updateMany({ where: { id: { in: ids } }, data: { status } })),
    ...(toLock.length ? [prisma.attendanceSession.updateMany({ where: { id: { in: toLock } }, data: { locked: true } })] : []),
  ]);

  // Someone else saved the same student in between (rare): make sure our values win, as
  // the per-student upserts did.
  if (toCreate.length) {
    const after = await prisma.attendanceRecord.findMany({ where: { sessionId: { in: Array.from(new Set(toCreate.map((c) => c.sessionId))) } }, select: { sessionId: true, studentId: true, status: true } });
    const got = new Map(after.map((r) => [`${r.sessionId}|${r.studentId}`, r.status]));
    const stale = toCreate.filter((c) => got.get(`${c.sessionId}|${c.studentId}`) !== c.status);
    if (stale.length) {
      await prisma.$transaction(stale.map((c) => prisma.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: c.sessionId, studentId: c.studentId } },
        update: { status: c.status },
        create: c,
      })));
    }
  }
  return written;
}
