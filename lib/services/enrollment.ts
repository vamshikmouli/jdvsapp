import { prisma } from '@/lib/db';

/** Next free roll number in a class ("01", "02"…) = highest active roll + 1. */
export async function nextRollForClass(classId: string, excludeStudentId?: string): Promise<string> {
  const rows = await prisma.student.findMany({
    where: { classId, status: 'ACTIVE', ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}) },
    select: { roll: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.roll || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(2, '0');
}

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

  let created = 0, graduated = 0, noClass = 0, skippedExisting = 0;
  // Work out every student's target class / section first, then write them together
  // (was one upsert per student). Same rules: a new enrollment gets class, section and
  // roll; an existing one (overwrite) only has its class and section changed.
  const plan: { studentId: string; classId: string; sectionId: string | null; roll: string | null }[] = [];
  for (const e of source) {
    if (existing.has(e.studentId)) { skippedExisting++; continue; }
    const target = byOrder.get(e.class.order + shift);
    if (!target) { if (shift > 0) graduated++; else noClass++; continue; }
    const sec = e.section ? target.sections.find((s) => s.name === e.section!.name) : null;
    plan.push({ studentId: e.studentId, classId: target.id, sectionId: sec?.id ?? null, roll: e.roll });
    created++; // counted as before: every student written (created or, with overwrite, updated)
  }
  if (plan.length) {
    const before = new Set((await prisma.enrollment.findMany({ where: { yearId: targetYearId, studentId: { in: plan.map((p) => p.studentId) } }, select: { studentId: true } })).map((x) => x.studentId));
    const fresh = plan.filter((p) => !before.has(p.studentId));
    if (fresh.length) {
      await prisma.enrollment.createMany({ data: fresh.map((p) => ({ studentId: p.studentId, yearId: targetYearId, classId: p.classId, sectionId: p.sectionId, roll: p.roll, status: 'ACTIVE' as const })), skipDuplicates: true });
    }
    // Existing ones (and any inserted meanwhile by someone else): set class + section,
    // one update per target class/section.
    const now = await prisma.enrollment.findMany({ where: { yearId: targetYearId, studentId: { in: plan.map((p) => p.studentId) } }, select: { id: true, studentId: true, classId: true, sectionId: true } });
    const nowBy = new Map(now.map((x) => [x.studentId, x]));
    const groups = new Map<string, { classId: string; sectionId: string | null; ids: string[] }>();
    for (const p of plan) {
      const cur = nowBy.get(p.studentId);
      if (!cur || (cur.classId === p.classId && cur.sectionId === p.sectionId)) continue;
      const k = `${p.classId}|${p.sectionId ?? ''}`;
      (groups.get(k) || groups.set(k, { classId: p.classId, sectionId: p.sectionId, ids: [] }).get(k)!).ids.push(cur.id);
    }
    if (groups.size) {
      await prisma.$transaction(Array.from(groups.values()).map((g) => prisma.enrollment.updateMany({ where: { id: { in: g.ids } }, data: { classId: g.classId, sectionId: g.sectionId } })));
    }
  }
  return { source: source.length, created, graduated, noClass, skippedExisting };
}
