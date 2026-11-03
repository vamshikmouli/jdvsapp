import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  saveMarkSheet, saveMarkSheets, listPendingSheets, getStudentReport, diagnoseParentReport, setAssessmentSubjectMaxes, decideMarkSheet,
} from '@/lib/services/marks';

// Marks flow against the local DB with throwaway data (own year-less assessment on the
// active year, own class, subjects and students), cleaned up afterwards. Pins down the
// behaviour of saving, approval coverage, the parent report card and max-marks changes.

const T = 'ZZM' + Date.now().toString(36);
let yearId = '';
let classId = '';
let sectionA = '';
let assessmentId = '';
let subjA = '', subjB = '';
const S1 = `${T}-S1`, S2 = `${T}-S2`, S3 = `${T}-S3`;

const marksOf = async (subjectId: string) => {
  const sh = await prisma.markSheet.findFirst({ where: { assessmentId, classId, subjectId, sectionId: null }, include: { marks: { orderBy: { studentId: 'asc' } } } });
  return { status: sh?.status, max: sh?.maxMarks, marks: (sh?.marks || []).map((m) => [m.studentId, m.marksObtained, m.isAbsent, m.remark]) };
};

beforeAll(async () => {
  const year = await prisma.academicYear.findFirst({ where: { isActive: true } });
  if (!year) throw new Error('No active academic year in the local DB — seed it first.');
  yearId = year.id;
  const cls = await prisma.schoolClass.create({ data: { id: `${T}-C`, name: `${T} STD`, order: 999, group: 'PRIMARY' } });
  classId = cls.id;
  sectionA = (await prisma.section.create({ data: { classId, name: 'A' } })).id;
  subjA = (await prisma.subject.create({ data: { name: `${T} Maths`, order: 9001 } })).id;
  subjB = (await prisma.subject.create({ data: { name: `${T} English`, order: 9002 } })).id;
  for (const [id, sec] of [[S1, null], [S2, sectionA], [S3, sectionA]] as const) {
    await prisma.student.create({ data: { id, name: `${T} ${id.slice(-2)}`, gender: 'F', guardianName: 'T', guardianPhone: '0000000000', status: 'ACTIVE', classId, sectionId: sec } });
    await prisma.enrollment.create({ data: { studentId: id, yearId, classId, sectionId: sec, status: 'ACTIVE' } });
  }
  assessmentId = (await prisma.assessment.create({ data: { yearId, name: `${T} FA1`, type: 'FORMATIVE', defaultMax: 50, publishedToParents: true } })).id;
});

afterAll(async () => {
  await prisma.assessment.deleteMany({ where: { id: assessmentId } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: [S1, S2, S3] } } });
  await prisma.student.deleteMany({ where: { id: { in: [S1, S2, S3] } } });
  await prisma.subject.deleteMany({ where: { id: { in: [subjA, subjB] } } });
  await prisma.section.deleteMany({ where: { classId } });
  await prisma.schoolClass.deleteMany({ where: { id: classId } });
  await prisma.$disconnect();
});

describe('saving marks', () => {
  it('first save creates the sheet and every mark', async () => {
    const r = await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [
      { studentId: S1, marksObtained: 40 }, { studentId: S2, marksObtained: null, isAbsent: true }, { studentId: S3, marksObtained: null },
    ], 'save', null);
    expect(r.status).toBe('DRAFT');
    expect(await marksOf(subjA)).toEqual({ status: 'DRAFT', max: 50, marks: [[S1, 40, false, null], [S2, null, true, null], [S3, null, false, null]] });
  });

  it('re-save updates changed marks, keeps unchanged ones, adds new rows, last duplicate wins', async () => {
    await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [
      { studentId: S1, marksObtained: 40 },                       // unchanged
      { studentId: S2, marksObtained: 33 },                       // absent → mark
      { studentId: S3, marksObtained: 10 }, { studentId: S3, marksObtained: 12, remark: 'retest' }, // duplicate → last wins
    ], 'submit', null);
    expect(await marksOf(subjA)).toEqual({ status: 'SUBMITTED', max: 50, marks: [[S1, 40, false, null], [S2, 33, false, null], [S3, 12, false, 'retest']] });
  });

  it('remarks: kept when a save does not send one, cleared when sent empty, replaced when sent', async () => {
    // Class grid save (never sends remarks) — S3 keeps 'retest', marks still update.
    await saveMarkSheets({ assessmentId, classId, sectionId: null }, [{ subjectId: subjA, action: 'submit', marks: [{ studentId: S3, marksObtained: 13, isAbsent: false }] }], null);
    expect((await marksOf(subjA)).marks[2]).toEqual([S3, 13, false, 'retest']);
    // Single-subject save without a remark field — kept too.
    await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [{ studentId: S3, marksObtained: 12 }], 'submit', null);
    expect((await marksOf(subjA)).marks[2]).toEqual([S3, 12, false, 'retest']);
    // Sent → replaced; sent empty → cleared.
    await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [{ studentId: S3, marksObtained: 12, remark: 'absent for 1 paper' }], 'submit', null);
    expect((await marksOf(subjA)).marks[2][3]).toBe('absent for 1 paper');
    await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [{ studentId: S3, marksObtained: 12, remark: '' }], 'submit', null);
    expect((await marksOf(subjA)).marks[2][3]).toBeNull();
    await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [{ studentId: S3, marksObtained: 12, remark: 'retest' }], 'submit', null);
  });

  it('rejects a mark over the max and changes nothing', async () => {
    await expect(saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [{ studentId: S1, marksObtained: 51 }], 'save', null)).rejects.toThrow('Marks must be between 0 and 50');
    expect((await marksOf(subjA)).marks[0]).toEqual([S1, 40, false, null]);
  });

  it('approved sheet: an approver edit stays approved; without keepApproved it goes back to draft', async () => {
    const sh = await prisma.markSheet.findFirst({ where: { assessmentId, classId, subjectId: subjA } });
    await decideMarkSheet(sh!.id, 'approve', null);
    await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [{ studentId: S1, marksObtained: 41 }], 'save', null, { keepApproved: true });
    expect((await marksOf(subjA)).status).toBe('APPROVED');
    expect((await marksOf(subjA)).marks[0]).toEqual([S1, 41, false, null]);
    await saveMarkSheet({ assessmentId, classId, subjectId: subjA }, [{ studentId: S1, marksObtained: 42 }], 'save', null);
    expect((await marksOf(subjA)).status).toBe('DRAFT');
    await decideMarkSheet(sh!.id, 'approve', null);
  });

  it('uses the exam override as the max for a new sheet', async () => {
    await prisma.assessmentSubject.create({ data: { assessmentId, subjectId: subjB, maxMarks: 80 } });
    await expect(saveMarkSheet({ assessmentId, classId, subjectId: subjB }, [{ studentId: S1, marksObtained: 81 }], 'save', null)).rejects.toThrow('between 0 and 80');
    await saveMarkSheet({ assessmentId, classId, subjectId: subjB }, [{ studentId: S1, marksObtained: 70 }, { studentId: S2, marksObtained: 60 }], 'submit', null);
    expect(await marksOf(subjB)).toEqual({ status: 'SUBMITTED', max: 80, marks: [[S1, 70, false, null], [S2, 60, false, null]] });
  });
});

describe('approval queue coverage', () => {
  it('roster = active students of the class (of the section when the sheet has one)', async () => {
    await saveMarkSheet({ assessmentId, classId, subjectId: subjB, sectionId: sectionA }, [{ studentId: S2, marksObtained: 5 }], 'submit', null);
    const mine = (await listPendingSheets()).filter((x: any) => x.assessment === `${T} FA1`);
    const whole = mine.find((x: any) => x.section === null);
    const secA = mine.find((x: any) => x.section === 'A');
    expect(whole.roster).toBe(3);
    expect(secA.roster).toBe(2);
    expect(whole.entered).toBe(2);
  });
});

describe('parent report card + check parent view', () => {
  it('shows only approved subjects that hold a mark for the child', async () => {
    const r = await getStudentReport(S1, yearId);
    const fa = r!.assessments.find((a: any) => a.name === `${T} FA1`);
    expect(fa.subjects.map((x: any) => [x.name, x.marks, x.max])).toEqual([[`${T} Maths`, 42, 50]]);
    expect(fa.totalObtained).toBe(42);
    const d = await diagnoseParentReport(S1, yearId);
    const dfa = d!.assessments.find((a: any) => a.name === `${T} FA1`)!;
    expect(dfa.visible).toBe(true);
    expect(dfa.subjects.map((x) => [x.name, x.status, x.visible]).sort()).toEqual([
      [`${T} English`, 'SUBMITTED', false], [`${T} English`, 'SUBMITTED', false], [`${T} Maths`, 'APPROVED', true],
    ].sort());
  });

  it('unpublished exam disappears from the report and is explained', async () => {
    await prisma.assessment.update({ where: { id: assessmentId }, data: { publishedToParents: false } });
    const r = await getStudentReport(S1, yearId);
    expect(r!.assessments.find((a: any) => a.name === `${T} FA1`)).toBeUndefined();
    const d = await diagnoseParentReport(S1, yearId);
    expect(d!.assessments.find((a: any) => a.name === `${T} FA1`)!.reason).toMatch(/Not published/);
    await prisma.assessment.update({ where: { id: assessmentId }, data: { publishedToParents: true } });
  });
});

describe('max marks for an exam', () => {
  it('refuses a max below an entered mark (first failing subject, highest mark), saves nothing', async () => {
    await expect(setAssessmentSubjectMaxes(assessmentId, [{ subjectId: subjA, max: 45 }, { subjectId: subjB, max: 30 }]))
      .rejects.toThrow(`${T} English: a mark of 70 is already entered in ${T} — max can't be below that.`);
    expect((await marksOf(subjA)).max).toBe(50);
  });

  it('applies a valid max to existing sheets (approved too) and drops an override equal to the default', async () => {
    await setAssessmentSubjectMaxes(assessmentId, [{ subjectId: subjA, max: 60 }, { subjectId: subjB, max: 75 }]);
    expect((await marksOf(subjA)).max).toBe(60);
    expect((await marksOf(subjA)).status).toBe('APPROVED');
    expect((await marksOf(subjB)).max).toBe(75);
    expect((await prisma.assessmentSubject.findFirst({ where: { assessmentId, subjectId: subjA } }))?.maxMarks).toBe(60);
    await setAssessmentSubjectMaxes(assessmentId, [{ subjectId: subjA, max: 50 }]); // = exam default → override removed
    expect((await marksOf(subjA)).max).toBe(50);
    expect(await prisma.assessmentSubject.count({ where: { assessmentId, subjectId: subjA } })).toBe(0);
  });

  it('leaves classes with their own exam setup alone', async () => {
    await prisma.assessmentClassSubject.create({ data: { assessmentId, classId, subjectId: subjA, maxMarks: 60, order: 0 } });
    await setAssessmentSubjectMaxes(assessmentId, [{ subjectId: subjA, max: 30 }]); // 42 > 30, but this class is custom → allowed
    expect((await marksOf(subjA)).max).toBe(50);
    await prisma.assessmentClassSubject.deleteMany({ where: { assessmentId } });
  });

  it('rejects a zero / negative max', async () => {
    await expect(setAssessmentSubjectMaxes(assessmentId, [{ subjectId: subjA, max: 0 }])).rejects.toThrow('Max marks must be greater than 0');
  });
});
