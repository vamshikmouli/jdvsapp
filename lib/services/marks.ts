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

// The configured max for a subject in an assessment: per-subject override, else defaultMax.
async function resolveMax(assessmentId: string, subjectId: string, defaultMax: number): Promise<number> {
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
  const maxMarks = sheet?.maxMarks ?? await resolveMax(sel.assessmentId, sel.subjectId, assessment.defaultMax);

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
    include: { subject: { select: { id: true, name: true, order: true, active: true } } },
    orderBy: { order: 'asc' },
  });
  const subjects = csubs.map((c) => c.subject).filter((s) => s.active).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const students = await rosterForClass(assessment.yearId, sel.classId, sel.sectionId);

  const [sheets, overrides] = await Promise.all([
    prisma.markSheet.findMany({
      where: { assessmentId: sel.assessmentId, classId: sel.classId, sectionId: sel.sectionId ?? null, subjectId: { in: subjects.map((s) => s.id) } },
      include: { marks: true },
    }),
    prisma.assessmentSubject.findMany({ where: { assessmentId: sel.assessmentId }, select: { subjectId: true, maxMarks: true } }),
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
      return { id: s.id, name: s.name, max: sh?.maxMarks ?? maxOverride.get(s.id) ?? assessment.defaultMax, status: (sh?.status || 'DRAFT') as MarkSheetStatus, sheetId: sh?.id || null, marks };
    }),
  };
}

export interface MarkInput { studentId: string; marksObtained: number | null; isAbsent?: boolean; remark?: string | null }

/** Save the grid (create sheet on first save). action: 'save' → DRAFT, 'submit' → SUBMITTED. */
export async function saveMarkSheet(sel: SheetSelector, marks: MarkInput[], action: 'save' | 'submit', userId: string | null) {
  const assessment = await prisma.assessment.findUnique({ where: { id: sel.assessmentId } });
  if (!assessment) throw new Error('Assessment not found');

  let sheet = await findSheet(sel);
  const maxMarks = sheet?.maxMarks ?? await resolveMax(sel.assessmentId, sel.subjectId, assessment.defaultMax);

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
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, name: true } });
  if (!student) return null;

  // The class/section to grade against is the student's enrollment FOR THIS YEAR.
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: { class: { select: { name: true } }, section: { select: { name: true } } },
  });
  if (!enrollment) {
    return { student: { id: student.id, name: student.name, className: null, section: null }, assessments: [], hasGrades: false };
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
    student: { id: student.id, name: student.name, className: enrollment.class?.name || null, section: enrollment.section?.name || null },
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
    // Keep already-created (not-yet-approved) sheets in sync with the new max.
    await prisma.markSheet.updateMany({ where: { assessmentId, subjectId: it.subjectId, status: { not: 'APPROVED' } }, data: { maxMarks: max } });
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
