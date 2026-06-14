import { prisma } from '@/lib/db';

/** Create or update a student's enrollment for a year (keeps class history in sync). */
export async function upsertEnrollment(studentId: string, yearId: string, classId: string | null, sectionId?: string | null, roll?: string | null) {
  if (!classId) return;
  await prisma.enrollment.upsert({
    where: { studentId_yearId: { studentId, yearId } },
    create: { studentId, yearId, classId, sectionId: sectionId ?? null, roll: roll ?? null, status: 'ACTIVE' },
    update: { classId, sectionId: sectionId ?? null, ...(roll !== undefined ? { roll: roll ?? null } : {}) },
  });
}

/** Active students enrolled in a class (and optional section) for a given year. */
export async function rosterForClass(yearId: string, classId: string, sectionId?: string | null) {
  const enr = await prisma.enrollment.findMany({
    where: { yearId, classId, ...(sectionId ? { sectionId } : {}), status: 'ACTIVE', student: { status: 'ACTIVE' } },
    include: { student: { select: { id: true, name: true } } },
    orderBy: [{ roll: 'asc' }, { student: { name: 'asc' } }],
  });
  return enr.map((e) => ({ id: e.student.id, name: e.student.name, roll: e.roll }));
}

/**
 * Build enrollments for a target year by copying a source year's roster with a
 * class shift along SchoolClass.order:
 *   shift +1 = promote (1st → 2nd); last class has no next → graduated (skipped)
 *   shift  0 = copy same classes (e.g. a repeat year)
 *   shift -1 = demote/backfill (this year's 2nd → last year's 1st); first class skipped
 * Sections are matched by name in the target class when present.
 */
export async function copyEnrollments(opts: { sourceYearId: string; targetYearId: string; shift: number; overwrite?: boolean }) {
  const { sourceYearId, targetYearId, shift } = opts;
  if (!sourceYearId || !targetYearId) throw new Error('Source and target years are required');
  if (sourceYearId === targetYearId) throw new Error('Source and target years must differ');

  const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true, order: true, sections: { select: { id: true, name: true } } } });
  const byOrder = new Map(classes.map((c) => [c.order, c]));

  const source = await prisma.enrollment.findMany({
    where: { yearId: sourceYearId, status: 'ACTIVE' },
    include: { class: { select: { order: true } }, section: { select: { name: true } } },
  });
  if (source.length === 0) throw new Error('The source year has no enrollments to copy from');

  // Optionally skip students who already have a target-year enrollment.
  const existing = opts.overwrite ? new Set<string>() : new Set((await prisma.enrollment.findMany({ where: { yearId: targetYearId }, select: { studentId: true } })).map((e) => e.studentId));

  let created = 0, updated = 0, graduated = 0, noClass = 0, skippedExisting = 0;
  for (const e of source) {
    if (existing.has(e.studentId)) { skippedExisting++; continue; }
    const target = byOrder.get(e.class.order + shift);
    if (!target) { if (shift > 0) graduated++; else noClass++; continue; }
    const sec = e.section ? target.sections.find((s) => s.name === e.section!.name) : null;
    const res = await prisma.enrollment.upsert({
      where: { studentId_yearId: { studentId: e.studentId, yearId: targetYearId } },
      create: { studentId: e.studentId, yearId: targetYearId, classId: target.id, sectionId: sec?.id ?? null, roll: e.roll, status: 'ACTIVE' },
      update: { classId: target.id, sectionId: sec?.id ?? null },
    });
    // upsert doesn't tell us create vs update; count by existence check above
    created++;
    void updated; void res;
  }
  return { source: source.length, created, graduated, noClass, skippedExisting };
}
