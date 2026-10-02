import { prisma } from '@/lib/db';
import type { MarkSheetStatus } from '@prisma/client';
import { gradeFor } from '@/lib/grades';
import { rosterForClass } from '@/lib/services/enrollment';
import { sendPushToUsers } from '@/lib/push';

export interface SheetSelector {
  assessmentId: string;
  classId: string;
  sectionId?: string | null;
  subjectId: string;
}

/**
 * This exam's custom subject list for a class (Marks → Assessments → Class subjects),
 * or null when the class isn't customised. Never throws: if the table isn't there yet
 * (deployed without `prisma db push`), marks keep working the old way.
 */
async function classExamSetup(assessmentId: string, classId: string): Promise<{ subjectId: string; maxMarks: number; order: number }[] | null> {
  try {
    const rows = await prisma.assessmentClassSubject.findMany({ where: { assessmentId, classId }, orderBy: { order: 'asc' }, select: { subjectId: true, maxMarks: true, order: true } });
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

// The configured max for a subject in an assessment: the class's exam setup, else the
// exam's per-subject override, else defaultMax.
async function resolveMax(assessmentId: string, subjectId: string, defaultMax: number, classId?: string): Promise<number> {
  if (classId) {
    const setup = await classExamSetup(assessmentId, classId);
    const row = setup?.find((x) => x.subjectId === subjectId);
    if (row) return row.maxMarks;
  }
  const o = await prisma.assessmentSubject.findUnique({ where: { assessmentId_subjectId: { assessmentId, subjectId } }, select: { maxMarks: true } });
  return o?.maxMarks ?? defaultMax;
}

// Find the one sheet for a selector. The @@unique includes a nullable sectionId,
// and Postgres treats NULLs as distinct, so we match explicitly rather than upsert.
async function findSheet(sel: SheetSelector) {
  return prisma.markSheet.findFirst({
    where: {
      assessmentId: sel.assessmentId,
      classId: sel.classId,
      subjectId: sel.subjectId,
      sectionId: sel.sectionId ?? null,
    },
  });
}

/** Build the entry grid: roster + any saved marks + status. */
export async function getMarkSheetGrid(sel: SheetSelector) {
  const [assessment, klass, section, subject] = await Promise.all([
    prisma.assessment.findUnique({ where: { id: sel.assessmentId } }),
    prisma.schoolClass.findUnique({ where: { id: sel.classId }, select: { id: true, name: true } }),
    sel.sectionId ? prisma.section.findUnique({ where: { id: sel.sectionId }, select: { id: true, name: true } }) : Promise.resolve(null),
    prisma.subject.findUnique({ where: { id: sel.subjectId }, select: { id: true, name: true } }),
  ]);
  if (!assessment || !klass || !subject) return null;

  const sheet = await findSheet(sel);
  const maxMarks = sheet?.maxMarks ?? await resolveMax(sel.assessmentId, sel.subjectId, assessment.defaultMax, sel.classId);

  const students = await rosterForClass(assessment.yearId, sel.classId, sel.sectionId);

  const marks = sheet ? await prisma.mark.findMany({ where: { markSheetId: sheet.id } }) : [];
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));

  let enteredBy: string | null = null, approvedBy: string | null = null;
  if (sheet?.enteredById) enteredBy = (await prisma.user.findUnique({ where: { id: sheet.enteredById }, select: { name: true } }))?.name || null;
  if (sheet?.approvedById) approvedBy = (await prisma.user.findUnique({ where: { id: sheet.approvedById }, select: { name: true } }))?.name || null;

  return {
    assessment: { id: assessment.id, name: assessment.name, type: assessment.type, defaultMax: assessment.defaultMax },
    class: klass, section, subject,
    sheetId: sheet?.id || null,
    status: (sheet?.status || 'DRAFT') as MarkSheetStatus,
    maxMarks,
    enteredBy, approvedBy,
    submittedAt: sheet?.submittedAt?.toISOString() || null,
    approvedAt: sheet?.approvedAt?.toISOString() || null,
    students: students.map((s) => {
      const m = byStudent.get(s.id);
      return { id: s.id, name: s.name, roll: s.roll, marksObtained: m?.marksObtained ?? null, isAbsent: m?.isAbsent ?? false, remark: m?.remark ?? null };
    }),
  };
}

/** Same grid, looked up by sheet id (for the admin review/approve screen). */
export async function getMarkSheetGridById(sheetId: string) {
  const sheet = await prisma.markSheet.findUnique({ where: { id: sheetId }, select: { assessmentId: true, classId: true, sectionId: true, subjectId: true } });
  if (!sheet) return null;
  return getMarkSheetGrid({ assessmentId: sheet.assessmentId, classId: sheet.classId, sectionId: sheet.sectionId, subjectId: sheet.subjectId });
}

/** Whole-class grid: every subject (columns) × every student (rows) for one assessment. */
export async function getClassGrid(sel: { assessmentId: string; classId: string; sectionId?: string | null }) {
  const [assessment, klass, section] = await Promise.all([
    prisma.assessment.findUnique({ where: { id: sel.assessmentId } }),
    prisma.schoolClass.findUnique({ where: { id: sel.classId }, select: { id: true, name: true } }),
    sel.sectionId ? prisma.section.findUnique({ where: { id: sel.sectionId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  if (!assessment || !klass) return null;

  const csubs = await prisma.classSubject.findMany({
    where: { classId: sel.classId },
    include: { subject: { select: { id: true, name: true, order: true, active: true, gradeOnly: true } } },
    orderBy: { order: 'asc' },
  });
  let subjects = csubs.map((c) => c.subject).filter((s) => s.active).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  // This exam customised for this class → exactly its subjects, in its order, with its maxes.
  const setup = await classExamSetup(sel.assessmentId, sel.classId);
  const setupMax = new Map((setup || []).map((x) => [x.subjectId, x.maxMarks]));
  if (setup) {
    const info = await prisma.subject.findMany({ where: { id: { in: setup.map((x) => x.subjectId) }, active: true }, select: { id: true, name: true, order: true, active: true, gradeOnly: true } });
    const byId = new Map(info.map((x) => [x.id, x]));
    subjects = setup.map((x) => byId.get(x.subjectId)).filter(Boolean) as typeof subjects;
  }

  const students = await rosterForClass(assessment.yearId, sel.classId, sel.sectionId);

  const [sheets, overrides, bands] = await Promise.all([
    prisma.markSheet.findMany({
      where: { assessmentId: sel.assessmentId, classId: sel.classId, sectionId: sel.sectionId ?? null, subjectId: { in: subjects.map((s) => s.id) } },
      include: { marks: true },
    }),
    prisma.assessmentSubject.findMany({ where: { assessmentId: sel.assessmentId }, select: { subjectId: true, maxMarks: true } }),
    prisma.gradeBand.findMany({ orderBy: [{ order: 'asc' }, { minPercent: 'desc' }], select: { label: true, minPercent: true, maxPercent: true } }),
  ]);
  const bySubject = new Map(sheets.map((sh) => [sh.subjectId, sh]));
  const maxOverride = new Map(overrides.map((o) => [o.subjectId, o.maxMarks]));

  return {
    assessment: { id: assessment.id, name: assessment.name, type: assessment.type, defaultMax: assessment.defaultMax },
    class: klass, section,
    students: students.map((s) => ({ id: s.id, name: s.name, roll: s.roll })),
    subjects: subjects.map((s) => {
      const sh = bySubject.get(s.id);
      const marks: Record<string, { marksObtained: number | null; isAbsent: boolean }> = {};
      if (sh) for (const m of sh.marks) marks[m.studentId] = { marksObtained: m.marksObtained, isAbsent: m.isAbsent };
      return { id: s.id, name: s.name, gradeOnly: s.gradeOnly, max: sh?.maxMarks ?? setupMax.get(s.id) ?? maxOverride.get(s.id) ?? assessment.defaultMax, status: (sh?.status || 'DRAFT') as MarkSheetStatus, sheetId: sh?.id || null, marks };
    }),
    // Grade scale — grade-only subjects (PE, Drawing…) are entered as these labels.
    bands,
  };
}

export interface MarkInput { studentId: string; marksObtained: number | null; isAbsent?: boolean; remark?: string | null }

/** Save the grid (create sheet on first save). action: 'save' → DRAFT, 'submit' → SUBMITTED. */
export async function saveMarkSheet(sel: SheetSelector, marks: MarkInput[], action: 'save' | 'submit', userId: string | null) {
  const assessment = await prisma.assessment.findUnique({ where: { id: sel.assessmentId } });
  if (!assessment) throw new Error('Assessment not found');

  let sheet = await findSheet(sel);
  const maxMarks = sheet?.maxMarks ?? await resolveMax(sel.assessmentId, sel.subjectId, assessment.defaultMax, sel.classId);

  // Validate marks against the max.
  for (const m of marks) {
    if (m.isAbsent) continue;
    if (m.marksObtained == null) continue;
    if (m.marksObtained < 0 || m.marksObtained > maxMarks) {
      throw new Error(`Marks must be between 0 and ${maxMarks}`);
    }
  }

  const status: MarkSheetStatus = action === 'submit' ? 'SUBMITTED' : 'DRAFT';

  if (!sheet) {
    sheet = await prisma.markSheet.create({
      data: {
        assessmentId: sel.assessmentId, classId: sel.classId, sectionId: sel.sectionId ?? null, subjectId: sel.subjectId,
        maxMarks, status, enteredById: userId,
        submittedAt: action === 'submit' ? new Date() : null,
      },
    });
  } else {
    sheet = await prisma.markSheet.update({
      where: { id: sheet.id },
      data: {
        status, enteredById: userId,
        submittedAt: action === 'submit' ? new Date() : sheet.submittedAt,
      },
    });
  }

  // Upsert each student's mark.
  await prisma.$transaction(
    marks.map((m) =>
      prisma.mark.upsert({
        where: { markSheetId_studentId: { markSheetId: sheet!.id, studentId: m.studentId } },
        create: {
          markSheetId: sheet!.id, studentId: m.studentId,
          marksObtained: m.isAbsent ? null : m.marksObtained, isAbsent: !!m.isAbsent, remark: m.remark || null,
        },
        update: {
          marksObtained: m.isAbsent ? null : m.marksObtained, isAbsent: !!m.isAbsent, remark: m.remark || null,
        },
      })
    )
  );

  return { sheetId: sheet.id, status };
}

/** Admin approves or returns a submitted sheet. */
export async function decideMarkSheet(sheetId: string, action: 'approve' | 'return', userId: string | null) {
  const sheet = await prisma.markSheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error('Mark sheet not found');
  if (action === 'approve') {
    await prisma.markSheet.update({ where: { id: sheetId }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } });
  } else {
    await prisma.markSheet.update({ where: { id: sheetId }, data: { status: 'DRAFT', approvedById: null, approvedAt: null } });
    // Tell the teacher who entered it that the admin wants a revision.
    if (sheet.enteredById) {
      const [assessment, klass, section, subject] = await Promise.all([
        prisma.assessment.findUnique({ where: { id: sheet.assessmentId }, select: { name: true } }),
        prisma.schoolClass.findUnique({ where: { id: sheet.classId }, select: { name: true } }),
        sheet.sectionId ? prisma.section.findUnique({ where: { id: sheet.sectionId }, select: { name: true } }) : Promise.resolve(null),
        prisma.subject.findUnique({ where: { id: sheet.subjectId }, select: { name: true } }),
      ]);
      const where = `${(klass?.name || '').replace(/\s?STD$/i, '')}${section?.name ? ' ' + section.name : ''} · ${subject?.name || ''}`;
      await sendPushToUsers([sheet.enteredById], {
        title: 'Marks returned for review',
        body: `${assessment?.name || 'Assessment'} — ${where}: please review and resubmit.`,
        url: '/admin/marks',
        tag: `marks-return-${sheetId}`,
      });
    }
  }
  return { ok: true };
}

/**
 * Parent report card for one student: every PUBLISHED assessment with the
 * student's APPROVED subject marks, totals, percentage and grade.
 */
export async function getStudentReport(studentId: string, yearId: string) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, name: true, photoUrl: true } });
  if (!student) return null;

  // The class/section to grade against is the student's enrollment FOR THIS YEAR.
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: { class: { select: { name: true } }, section: { select: { name: true } } },
  });
  if (!enrollment) {
    return { student: { id: student.id, name: student.name, photoUrl: student.photoUrl, className: null, section: null }, assessments: [], hasGrades: false };
  }
  const classId = enrollment.classId;
  const enrSectionId = enrollment.sectionId;

  const bands = await prisma.gradeBand.findMany({ orderBy: { minPercent: 'desc' } });

  const assessments = await prisma.assessment.findMany({
    where: { yearId, publishedToParents: true, archived: false },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });

  const out: any[] = [];
  for (const a of assessments) {
    // Approved sheets for this child's class — whole-class (sectionId null) or their section.
    const sheets = await prisma.markSheet.findMany({
      where: {
        assessmentId: a.id, status: 'APPROVED', classId,
        OR: [{ sectionId: null }, ...(enrSectionId ? [{ sectionId: enrSectionId }] : [])],
      },
      include: { subject: { select: { name: true, order: true, gradeOnly: true } }, marks: { where: { studentId } } },
    });

    const subjects: { name: string; order: number; marks: number | null; isAbsent: boolean; max: number; grade: string | null; gradeOnly: boolean }[] = [];
    let totObt = 0, totMax = 0;
    for (const sh of sheets) {
      const m = sh.marks[0];
      if (!m) continue; // no mark recorded for this student
      const isAbsent = m.isAbsent;
      const marks = isAbsent ? null : (m.marksObtained ?? null);
      const pct = (!isAbsent && marks != null) ? (marks / sh.maxMarks) * 100 : null;
      const gradeOnly = sh.subject.gradeOnly;
      // Co-scholastic subjects show a grade only; academic subjects show marks.
      subjects.push({ name: sh.subject.name, order: sh.subject.order, marks, isAbsent, max: sh.maxMarks, grade: gradeOnly ? gradeFor(pct, bands) : null, gradeOnly });
      if (!gradeOnly && !isAbsent && marks != null) { totObt += marks; totMax += sh.maxMarks; }
    }
    if (subjects.length === 0) continue;
    // Keep the configured subject order everywhere (don't regroup grade-only subjects).
    subjects.sort((x, y) => x.order - y.order || x.name.localeCompare(y.name));
    const percent = totMax > 0 ? (totObt / totMax) * 100 : null;
    out.push({
      id: a.id, name: a.name, type: a.type, term: a.term,
      subjects: subjects.map(({ order, ...s }) => s),
      totalObtained: totObt, totalMax: totMax,
      percent: percent == null ? null : Math.round(percent * 10) / 10,
      grade: gradeFor(percent, bands),
    });
  }

  return {
    student: { id: student.id, name: student.name, photoUrl: student.photoUrl, className: enrollment.class?.name || null, section: enrollment.section?.name || null },
    assessments: out,
    hasGrades: bands.length > 0,
  };
}

/** Per-assessment max marks for every active subject (override or the assessment default). */
export async function getAssessmentSubjectMaxes(assessmentId: string) {
  const a = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { id: true, name: true, defaultMax: true } });
  if (!a) return null;
  const [subjects, overrides] = await Promise.all([
    prisma.subject.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, gradeOnly: true } }),
    prisma.assessmentSubject.findMany({ where: { assessmentId }, select: { subjectId: true, maxMarks: true } }),
  ]);
  const ov = new Map(overrides.map((o) => [o.subjectId, o.maxMarks]));
  return {
    assessment: a,
    subjects: subjects.map((s) => ({ id: s.id, name: s.name, gradeOnly: s.gradeOnly, max: ov.get(s.id) ?? a.defaultMax, isOverride: ov.has(s.id) })),
  };
}

/** Save per-subject max overrides; sync existing non-approved sheets to the new max. */
export async function setAssessmentSubjectMaxes(assessmentId: string, items: { subjectId: string; max: number }[]) {
  const a = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { defaultMax: true } });
  if (!a) throw new Error('Assessment not found');
  for (const it of items) {
    const max = Math.round(Number(it.max));
    if (!(max > 0)) throw new Error('Max marks must be greater than 0');
    if (max === a.defaultMax) {
      await prisma.assessmentSubject.deleteMany({ where: { assessmentId, subjectId: it.subjectId } });
    } else {
      await prisma.assessmentSubject.upsert({
        where: { assessmentId_subjectId: { assessmentId, subjectId: it.subjectId } },
        create: { assessmentId, subjectId: it.subjectId, maxMarks: max },
        update: { maxMarks: max },
      });
    }
    // Keep already-created (not-yet-approved) sheets in sync with the new max — except in
    // classes whose exam setup sets their own max for this subject.
    let custom: string[] = [];
    try { custom = (await prisma.assessmentClassSubject.findMany({ where: { assessmentId, subjectId: it.subjectId }, select: { classId: true } })).map((x) => x.classId); } catch { /* table not created yet */ }
    await prisma.markSheet.updateMany({ where: { assessmentId, subjectId: it.subjectId, status: { not: 'APPROVED' }, ...(custom.length ? { classId: { notIn: custom } } : {}) }, data: { maxMarks: max } });
  }
  return { ok: true };
}

/** Admin approval queue: all submitted sheets with names + progress. */
export async function listPendingSheets() {
  const sheets = await prisma.markSheet.findMany({
    where: { status: 'SUBMITTED' },
    orderBy: { submittedAt: 'asc' },
    include: {
      assessment: { select: { name: true, type: true } },
      class: { select: { name: true } },
      section: { select: { name: true } },
      subject: { select: { name: true } },
      enteredBy: { select: { name: true } },
      _count: { select: { marks: true } },
    },
  });
  // roster size per (class, section) to show coverage
  const result = [] as any[];
  for (const s of sheets) {
    const roster = await prisma.student.count({ where: { classId: s.classId, ...(s.sectionId ? { sectionId: s.sectionId } : {}), status: 'ACTIVE' } });
    result.push({
      id: s.id,
      assessment: s.assessment.name, type: s.assessment.type,
      className: s.class.name, section: s.section?.name || null, subject: s.subject.name,
      teacher: s.enteredBy?.name || '—',
      entered: s._count.marks, roster,
      submittedAt: s.submittedAt?.toISOString() || null,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per-exam, per-class subjects + max marks (Marks → Assessments → Class subjects)

export async function getClassExamSetup(assessmentId: string, classId: string) {
  const a = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { id: true, name: true, defaultMax: true } });
  if (!a) return null;
  const [all, mapped, overrides, setup, sheets] = await Promise.all([
    prisma.subject.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, gradeOnly: true } }),
    prisma.classSubject.findMany({ where: { classId }, select: { subjectId: true } }),
    prisma.assessmentSubject.findMany({ where: { assessmentId }, select: { subjectId: true, maxMarks: true } }),
    classExamSetup(assessmentId, classId),
    prisma.markSheet.findMany({ where: { assessmentId, classId }, select: { subjectId: true, status: true, marks: { where: { OR: [{ marksObtained: { not: null } }, { isAbsent: true }] }, select: { id: true }, take: 1 } } }),
  ]);
  const inClass = new Set(mapped.map((m) => m.subjectId));
  const ov = new Map(overrides.map((o) => [o.subjectId, o.maxMarks]));
  const custom = new Map((setup || []).map((x) => [x.subjectId, x]));
  const withMarks = new Set(sheets.filter((sh) => sh.marks.length > 0).map((sh) => sh.subjectId));
  const order = (id: string) => (custom.has(id) ? custom.get(id)!.order : 1000);
  const subjects = all
    .map((sub) => ({
      id: sub.id, name: sub.name, gradeOnly: sub.gradeOnly,
      inClass: inClass.has(sub.id),
      included: setup ? custom.has(sub.id) : inClass.has(sub.id),
      max: custom.get(sub.id)?.maxMarks ?? ov.get(sub.id) ?? a.defaultMax,
      hasMarks: withMarks.has(sub.id),
    }))
    .sort((x, y) => order(x.id) - order(y.id));
  return { assessment: a, customised: !!setup, subjects };
}

/**
 * Save this exam's subjects + maxes for a class (items = included subjects, in order),
 * or reset to the default (items = null). Refuses to drop a subject that already has
 * marks, or to lower a max below a mark already entered.
 */
export async function setClassExamSetup(assessmentId: string, classId: string, items: { subjectId: string; max: number }[] | null) {
  const a = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { id: true } });
  if (!a) throw new Error('Assessment not found');
  const sheets = await prisma.markSheet.findMany({
    where: { assessmentId, classId },
    select: { id: true, subjectId: true, status: true, subject: { select: { name: true } }, marks: { select: { marksObtained: true, isAbsent: true } } },
  });
  const entered = (sh: (typeof sheets)[number]) => sh.marks.some((m) => m.marksObtained != null || m.isAbsent);

  if (items === null) {
    await prisma.assessmentClassSubject.deleteMany({ where: { assessmentId, classId } });
    return { ok: true, customised: false };
  }
  const clean = items.map((it) => ({ subjectId: String(it.subjectId), max: Math.round(Number(it.max)) }));
  if (!clean.length) throw new Error('Pick at least one subject for this exam.');
  for (const it of clean) if (!(it.max > 0 && it.max <= 1000)) throw new Error('Max marks must be between 1 and 1000.');
  const keep = new Set(clean.map((x) => x.subjectId));
  for (const sh of sheets) {
    if (!keep.has(sh.subjectId) && entered(sh)) throw new Error(`${sh.subject.name} already has marks for this exam — clear them before removing the subject.`);
    const it = clean.find((x) => x.subjectId === sh.subjectId);
    if (it) {
      const top = Math.max(0, ...sh.marks.map((m) => m.marksObtained ?? 0));
      if (top > it.max) throw new Error(`${sh.subject.name}: a mark of ${top} is already entered — max can't be below that.`);
    }
  }
  await prisma.$transaction([
    prisma.assessmentClassSubject.deleteMany({ where: { assessmentId, classId } }),
    prisma.assessmentClassSubject.createMany({ data: clean.map((x, i) => ({ assessmentId, classId, subjectId: x.subjectId, maxMarks: x.max, order: i })) }),
    // Existing (not approved) sheets of this class follow the new max.
    ...clean.map((x) => prisma.markSheet.updateMany({ where: { assessmentId, classId, subjectId: x.subjectId, status: { not: 'APPROVED' } }, data: { maxMarks: x.max } })),
  ]);
  return { ok: true, customised: true };
}
