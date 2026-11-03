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

// remark: undefined = not sent → keep the existing remark; null / '' clears it.
export interface MarkInput { studentId: string; marksObtained: number | null; isAbsent?: boolean; remark?: string | null }

/** What saving needs about an exam + class, read once and shared by every subject saved. */
interface SaveContext {
  assessment: { id: string; defaultMax: number };
  sheets: Map<string, Awaited<ReturnType<typeof findSheet>>>; // subjectId → existing sheet (or null)
  setup: { subjectId: string; maxMarks: number }[] | null;   // the class's exam setup
  overrides: Map<string, number>;                             // exam's per-subject max overrides
}

async function loadSaveContext(base: Omit<SheetSelector, 'subjectId'>, subjectIds: string[]): Promise<SaveContext> {
  const assessment = await prisma.assessment.findUnique({ where: { id: base.assessmentId }, select: { id: true, defaultMax: true } });
  if (!assessment) throw new Error('Assessment not found');
  const [rows, setup, overrides] = await Promise.all([
    prisma.markSheet.findMany({ where: { assessmentId: base.assessmentId, classId: base.classId, sectionId: base.sectionId ?? null, subjectId: { in: subjectIds } } }),
    classExamSetup(base.assessmentId, base.classId),
    prisma.assessmentSubject.findMany({ where: { assessmentId: base.assessmentId, subjectId: { in: subjectIds } }, select: { subjectId: true, maxMarks: true } }),
  ]);
  const sheets = new Map<string, Awaited<ReturnType<typeof findSheet>>>();
  for (const id of subjectIds) sheets.set(id, rows.find((r) => r.subjectId === id) ?? null);
  return { assessment, sheets, setup, overrides: new Map(overrides.map((o) => [o.subjectId, o.maxMarks])) };
}

/**
 * Save the grid (create sheet on first save). action: 'save' → DRAFT, 'submit' → SUBMITTED.
 * keepApproved: an approver correcting an already-approved sheet — it stays APPROVED, so
 * published report cards update at once instead of the marks vanishing until re-approval.
 */
export async function saveMarkSheet(sel: SheetSelector, marks: MarkInput[], action: 'save' | 'submit', userId: string | null, opts: { keepApproved?: boolean } = {}) {
  const ctx = await loadSaveContext(sel, [sel.subjectId]);
  return saveOneSheet(ctx, sel, marks, action, userId, opts);
}

/** Save several subjects of one exam + class at once (the class grid) — lookups shared. */
export async function saveMarkSheets(
  base: Omit<SheetSelector, 'subjectId'>,
  items: { subjectId: string; marks: MarkInput[]; action: 'save' | 'submit' }[],
  userId: string | null,
  opts: { keepApproved?: boolean } = {},
) {
  if (!items.length) return [];
  const ctx = await loadSaveContext(base, items.map((it) => it.subjectId));
  const out: { subjectId: string; sheetId: string; status: MarkSheetStatus }[] = [];
  for (const it of items) {
    const res = await saveOneSheet(ctx, { ...base, subjectId: it.subjectId }, it.marks, it.action, userId, opts);
    out.push({ subjectId: it.subjectId, ...res });
  }
  return out;
}

async function saveOneSheet(ctx: SaveContext, sel: SheetSelector, marks: MarkInput[], action: 'save' | 'submit', userId: string | null, opts: { keepApproved?: boolean }) {
  let sheet = ctx.sheets.get(sel.subjectId) ?? null;
  // The configured max: the class's exam setup, else the exam's override, else defaultMax.
  const maxMarks = sheet?.maxMarks
    ?? ctx.setup?.find((x) => x.subjectId === sel.subjectId)?.maxMarks
    ?? ctx.overrides.get(sel.subjectId)
    ?? ctx.assessment.defaultMax;

  // Validate marks against the max.
  for (const m of marks) {
    if (m.isAbsent) continue;
    if (m.marksObtained == null) continue;
    if (m.marksObtained < 0 || m.marksObtained > maxMarks) {
      throw new Error(`Marks must be between 0 and ${maxMarks}`);
    }
  }

  const keep = !!opts.keepApproved && sheet?.status === 'APPROVED';
  const status: MarkSheetStatus = keep ? 'APPROVED' : action === 'submit' ? 'SUBMITTED' : 'DRAFT';

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
      data: keep
        ? { status, approvedById: userId, approvedAt: new Date() }
        : { status, enteredById: userId, submittedAt: action === 'submit' ? new Date() : sheet.submittedAt },
    });
  }
  ctx.sheets.set(sel.subjectId, sheet);
  await writeMarks(sheet.id, marks);
  return { sheetId: sheet.id, status };
}

/**
 * Store each student's mark — same end result as one upsert per student, but: new rows go
 * in one insert, and only rows whose value actually changed are updated.
 */
async function writeMarks(markSheetId: string, marks: MarkInput[]) {
  // Later entries for the same student win, as they did with sequential upserts.
  // A save that doesn't send a remark (the class grid / full-screen entry never do) keeps
  // the student's existing remark instead of blanking it.
  const byStudent = new Map<string, { marksObtained: number | null; isAbsent: boolean; remark?: string | null }>();
  for (const m of marks) byStudent.set(m.studentId, { marksObtained: m.isAbsent ? null : m.marksObtained, isAbsent: !!m.isAbsent, ...(m.remark !== undefined ? { remark: m.remark || null } : {}) });
  if (!byStudent.size) return;
  const existing = await prisma.mark.findMany({
    where: { markSheetId, studentId: { in: Array.from(byStudent.keys()) } },
    select: { id: true, studentId: true, marksObtained: true, isAbsent: true, remark: true },
  });
  const have = new Map(existing.map((e) => [e.studentId, e]));
  const toCreate: { markSheetId: string; studentId: string; marksObtained: number | null; isAbsent: boolean; remark: string | null }[] = [];
  const toUpdate: { id: string; data: { marksObtained: number | null; isAbsent: boolean; remark?: string | null } }[] = [];
  for (const [studentId, v] of byStudent) {
    const e = have.get(studentId);
    if (!e) toCreate.push({ markSheetId, studentId, marksObtained: v.marksObtained, isAbsent: v.isAbsent, remark: v.remark ?? null });
    else if (e.marksObtained !== v.marksObtained || e.isAbsent !== v.isAbsent || (v.remark !== undefined && (e.remark ?? null) !== v.remark)) toUpdate.push({ id: e.id, data: v });
  }
  await prisma.$transaction([
    ...(toCreate.length ? [prisma.mark.createMany({ data: toCreate, skipDuplicates: true })] : []),
    ...toUpdate.map((u) => prisma.mark.update({ where: { id: u.id }, data: u.data })),
  ]);
  // Someone else saved the same student in between (rare): fall back to upserts so our
  // values still win, exactly as the per-student upserts did.
  if (toCreate.length) {
    const now = await prisma.mark.findMany({ where: { markSheetId, studentId: { in: toCreate.map((c) => c.studentId) } }, select: { studentId: true, marksObtained: true, isAbsent: true, remark: true } });
    const stale = toCreate.filter((c) => { const n = now.find((x) => x.studentId === c.studentId); return !n || n.marksObtained !== c.marksObtained || n.isAbsent !== c.isAbsent || (n.remark ?? null) !== c.remark; });
    if (stale.length) {
      await prisma.$transaction(stale.map((c) => prisma.mark.upsert({
        where: { markSheetId_studentId: { markSheetId, studentId: c.studentId } },
        create: c,
        update: { marksObtained: c.marksObtained, isAbsent: c.isAbsent, ...(byStudent.get(c.studentId)!.remark !== undefined ? { remark: c.remark } : {}) },
      })));
    }
  }
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
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, name: true, photoUrl: true, class: { select: { name: true } } } });
  if (!student) return null;

  // Class / section shown on the report: this year's enrollment (else the student record).
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: { class: { select: { name: true } }, section: { select: { name: true } } },
  });

  const bands = await prisma.gradeBand.findMany({ orderBy: { minPercent: 'desc' } });

  const assessments = await prisma.assessment.findMany({
    where: { yearId, publishedToParents: true, archived: false },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });

  // Approved sheets that hold a mark for this child — whatever class / section they were
  // entered under (section-wise or whole-class), so a section mismatch can't hide them.
  // One query for every published exam, grouped per exam below.
  const allSheets = assessments.length ? await prisma.markSheet.findMany({
    where: { assessmentId: { in: assessments.map((a) => a.id) }, status: 'APPROVED', marks: { some: { studentId } } },
    include: { subject: { select: { name: true, order: true, gradeOnly: true } }, marks: { where: { studentId } } },
  }) : [];
  const sheetsByAssessment = new Map<string, typeof allSheets>();
  for (const sh of allSheets) {
    const list = sheetsByAssessment.get(sh.assessmentId);
    if (list) list.push(sh); else sheetsByAssessment.set(sh.assessmentId, [sh]);
  }

  const out: any[] = [];
  for (const a of assessments) {
    const sheets = sheetsByAssessment.get(a.id) || [];

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
    student: { id: student.id, name: student.name, photoUrl: student.photoUrl, className: enrollment?.class?.name || student.class?.name || null, section: enrollment?.section?.name || null },
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

/** Save per-subject max overrides; sync existing sheets (approved / published too) to the new max. */
export async function setAssessmentSubjectMaxes(assessmentId: string, items: { subjectId: string; max: number }[]) {
  const a = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { defaultMax: true } });
  if (!a) throw new Error('Assessment not found');
  // Refuse a max below a mark already entered (checked for all subjects before saving any).
  // Everything the check needs is read in two queries, then checked subject by subject in
  // the given order (same rule and message as before).
  const subjectIds = items.map((it) => it.subjectId);
  let customRows: { subjectId: string; classId: string }[] = [];
  try { customRows = await prisma.assessmentClassSubject.findMany({ where: { assessmentId, subjectId: { in: subjectIds } }, select: { subjectId: true, classId: true } }); } catch { /* table not created yet */ }
  const customBySubject = new Map<string, Set<string>>();
  for (const r of customRows) (customBySubject.get(r.subjectId) || customBySubject.set(r.subjectId, new Set()).get(r.subjectId)!).add(r.classId);
  const maxes = items.map((it) => Math.round(Number(it.max)));
  const lowest = Math.min(...maxes.filter((m) => m > 0), Infinity);
  const candidates = Number.isFinite(lowest) ? await prisma.mark.findMany({
    where: { marksObtained: { gt: lowest }, markSheet: { assessmentId, subjectId: { in: subjectIds } } },
    select: { marksObtained: true, markSheet: { select: { subjectId: true, classId: true, subject: { select: { name: true } }, class: { select: { name: true } } } } },
    orderBy: { marksObtained: 'desc' },
  }) : [];
  items.forEach((it, i) => {
    const max = maxes[i];
    if (!(max > 0)) throw new Error('Max marks must be greater than 0');
    const custom = customBySubject.get(it.subjectId);
    const over = candidates.find((m) => m.markSheet.subjectId === it.subjectId && (m.marksObtained ?? 0) > max && !custom?.has(m.markSheet.classId));
    if (over) throw new Error(`${over.markSheet.subject.name}: a mark of ${over.marksObtained} is already entered in ${over.markSheet.class.name.replace(/\s?STD$/i, '')} — max can't be below that.`);
  });
  // Save all subjects together; existing sheets (approved ones too) follow the new max —
  // except in classes whose exam setup sets their own max for this subject.
  await prisma.$transaction(items.flatMap((it, i) => {
    const max = maxes[i];
    const custom = Array.from(customBySubject.get(it.subjectId) || []);
    return [
      max === a.defaultMax
        ? prisma.assessmentSubject.deleteMany({ where: { assessmentId, subjectId: it.subjectId } })
        : prisma.assessmentSubject.upsert({
          where: { assessmentId_subjectId: { assessmentId, subjectId: it.subjectId } },
          create: { assessmentId, subjectId: it.subjectId, maxMarks: max },
          update: { maxMarks: max },
        }),
      prisma.markSheet.updateMany({ where: { assessmentId, subjectId: it.subjectId, ...(custom.length ? { classId: { notIn: custom } } : {}) }, data: { maxMarks: max } }),
    ];
  }));
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
  // Roster size per (class, section) to show coverage — one grouped count for all sheets
  // (same rule as before: active students of the class, of the section if the sheet has one).
  const classIds = Array.from(new Set(sheets.map((s) => s.classId)));
  const groups = classIds.length
    ? await prisma.student.groupBy({ by: ['classId', 'sectionId'], where: { status: 'ACTIVE', classId: { in: classIds } }, _count: { _all: true } })
    : [];
  const bySection = new Map<string, number>(), byClass = new Map<string, number>();
  for (const g of groups) {
    bySection.set(`${g.classId}|${g.sectionId ?? ''}`, g._count._all);
    byClass.set(g.classId!, (byClass.get(g.classId!) || 0) + g._count._all);
  }
  const result = [] as any[];
  for (const s of sheets) {
    const roster = s.sectionId ? (bySection.get(`${s.classId}|${s.sectionId}`) || 0) : (byClass.get(s.classId) || 0);
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

/**
 * Approval queue grouped by class + exam (+ section): one row per class exam,
 * with how many of its subjects are submitted / approved / still draft. `ready`
 * means every subject is submitted (or already approved) — so "Approve all" is
 * allowed only then.
 */
export async function listPendingGroups() {
  const submitted = await prisma.markSheet.findMany({
    where: { status: 'SUBMITTED' },
    select: { assessmentId: true, classId: true, sectionId: true, submittedAt: true },
    orderBy: { submittedAt: 'asc' },
  });
  const seen = new Set<string>();
  const keys: { assessmentId: string; classId: string; sectionId: string | null; submittedAt: Date | null }[] = [];
  for (const s of submitted) {
    const k = `${s.assessmentId}|${s.classId}|${s.sectionId ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    keys.push({ assessmentId: s.assessmentId, classId: s.classId, sectionId: s.sectionId, submittedAt: s.submittedAt });
  }
  const out = [];
  for (const g of keys) {
    const grid = await getClassGrid({ assessmentId: g.assessmentId, classId: g.classId, sectionId: g.sectionId });
    if (!grid) continue;
    const subs = grid.subjects;
    const approved = subs.filter((s) => s.status === 'APPROVED').length;
    const submittedN = subs.filter((s) => s.status === 'SUBMITTED').length;
    const draft = subs.filter((s) => s.status === 'DRAFT').length;
    out.push({
      assessmentId: g.assessmentId, classId: g.classId, sectionId: g.sectionId,
      assessment: grid.assessment.name, type: grid.assessment.type,
      className: grid.class.name, section: grid.section?.name || null,
      total: subs.length, approved, submitted: submittedN, draft,
      pendingSubjects: subs.filter((s) => s.status === 'DRAFT').map((s) => s.name),
      ready: draft === 0 && submittedN > 0, // all subjects submitted/approved AND something to approve
      submittedAt: g.submittedAt?.toISOString() || null,
    });
  }
  return out;
}

/** Approve every submitted subject of a class exam at once. Refuses if any
 *  subject is still a draft (all subjects must be submitted first). */
export async function approveClassExam(
  sel: { assessmentId: string; classId: string; sectionId?: string | null },
  userId: string | null,
) {
  const grid = await getClassGrid(sel);
  if (!grid) throw new Error('Class exam not found');
  const draft = grid.subjects.filter((s) => s.status === 'DRAFT');
  if (draft.length) throw new Error(`All subjects must be submitted first — still waiting on ${draft.map((s) => s.name).join(', ')}.`);
  const ids = grid.subjects.filter((s) => s.status === 'SUBMITTED' && s.sheetId).map((s) => s.sheetId!) as string[];
  if (!ids.length) return { approved: 0 };
  await prisma.markSheet.updateMany({ where: { id: { in: ids } }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } });
  return { approved: ids.length };
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
    // Existing sheets of this class (approved / published too) follow the new max —
    // marks above it were refused above.
    ...clean.map((x) => prisma.markSheet.updateMany({ where: { assessmentId, classId, subjectId: x.subjectId }, data: { maxMarks: x.max } })),
  ]);
  return { ok: true, customised: true };
}

/**
 * Why is (or isn't) each exam on this student's parent report card? Used by
 * Marks → "Check parent view". Mirrors getStudentReport's rules exactly.
 */
export async function diagnoseParentReport(studentId: string, yearId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, name: true, classId: true, guardianUserId: true, guardianPhone: true, status: true, class: { select: { name: true } } },
  });
  if (!student) return null;
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_yearId: { studentId, yearId } },
    include: { class: { select: { name: true } }, section: { select: { name: true } } },
  });
  const classId = enrollment?.classId || student.classId;
  const assessments = await prisma.assessment.findMany({ where: { yearId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
  // One query for every exam's sheets (this class's, or any holding a mark for the child).
  const allSheets = assessments.length ? await prisma.markSheet.findMany({
    where: { assessmentId: { in: assessments.map((a) => a.id) }, OR: [...(classId ? [{ classId }] : []), { marks: { some: { studentId } } }] },
    include: { subject: { select: { name: true, order: true } }, section: { select: { name: true } }, marks: { where: { studentId }, select: { marksObtained: true, isAbsent: true } } },
  }) : [];
  const sheetsByAssessment = new Map<string, typeof allSheets>();
  for (const sh of allSheets) {
    const list = sheetsByAssessment.get(sh.assessmentId);
    if (list) list.push(sh); else sheetsByAssessment.set(sh.assessmentId, [sh]);
  }
  const out = [];
  for (const a of assessments) {
    const sheets = sheetsByAssessment.get(a.id) || [];
    const subjects = sheets
      .sort((x, y) => x.subject.order - y.subject.order)
      .map((sh) => {
        const m = sh.marks[0];
        const hasMark = !!m && (m.marksObtained != null || m.isAbsent);
        return { name: sh.subject.name, section: sh.section?.name || null, status: sh.status, hasMark, visible: sh.status === 'APPROVED' && !!m };
      });
    const shown = subjects.filter((x) => x.visible).length;
    let reason = '';
    if (a.archived) reason = 'Archived — restore it in Assessments.';
    else if (!a.publishedToParents) reason = 'Not published — turn on "Published" in Assessments.';
    else if (!subjects.length) reason = 'No marks entered for this class yet.';
    else if (!shown) {
      const pending = subjects.filter((x) => x.status !== 'APPROVED');
      const noMark = subjects.filter((x) => x.status === 'APPROVED' && !x.visible);
      reason = pending.length
        ? `Published, but no subject is approved yet — ${pending.length} waiting (${pending.map((x) => `${x.name}: ${x.status === 'SUBMITTED' ? 'submitted' : 'draft'}`).join(', ')}). Approve them in Marks → Approvals.`
        : `Approved, but this student has no mark in ${noMark.map((x) => x.name).join(', ')}.`;
    }
    out.push({ id: a.id, name: a.name, published: a.publishedToParents, archived: a.archived, visible: a.publishedToParents && !a.archived && shown > 0, shown, subjects, reason });
  }
  return {
    student: { id: student.id, name: student.name, active: student.status === 'ACTIVE', parentLinked: !!student.guardianUserId, guardianPhone: student.guardianPhone },
    enrollment: enrollment ? { className: enrollment.class?.name || null, section: enrollment.section?.name || null } : null,
    className: student.class?.name || null,
    assessments: out,
  };
}
