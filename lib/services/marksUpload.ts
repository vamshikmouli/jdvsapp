import { prisma } from '@/lib/db';
import { saveMarkSheet, type SheetSelector } from '@/lib/services/marks';
import { rosterForClass } from '@/lib/services/enrollment';

// ============================================================================
// Marks upload — turn a teacher's typed marks file into DRAFT marks.
//
// The teacher converts their handwritten sheet to a clean, typed PDF (e.g. via
// Gemini/Claude) or fills the Excel template, then uploads it. The route pulls
// the *text* out of the file; this module matches each text line to a roster
// student (by Admission No → Roll → Name) and grabs the mark, then saves a DRAFT
// the teacher reviews and submits. Nothing here reads handwriting.
// ============================================================================

const alnum = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const letters = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
const rollKey = (s: any) => String(s ?? '').replace(/[^0-9]/g, '').replace(/^0+/, '');

export interface UploadRow {
  studentId: string;
  name: string;
  roll: string | null;
  marks: number | null;
  isAbsent: boolean;
  matchedBy: 'admission' | 'roll' | 'name' | null;
}

export interface UploadResult {
  roster: number;       // students in the class/section
  matched: number;      // students a mark was parsed for
  maxMarks: number;
  rows: UploadRow[];
  extraneous: string[]; // lines that looked like a mark but matched no student
  applied: boolean;
  sheetId?: string;
  status?: string;
}

// Pull the mark off one line: the last numeric token within [0, max], or AB.
function markFromLine(line: string, max: number): { marks: number | null; isAbsent: boolean } | null {
  const tokens = line.split(/[\s|,;:\t]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (/^(AB|ABS|ABSENT)$/i.test(t)) return { marks: null, isAbsent: true };
    if (/^\d{1,3}(\.\d+)?$/.test(t)) {
      const n = Math.round(Number(t));
      if (n >= 0 && n <= max) return { marks: n, isAbsent: false };
    }
  }
  return null;
}

// Match every roster student to a line and read their mark.
export function matchMarksText(
  roster: { id: string; name: string; roll: string | null }[],
  text: string,
  max: number,
): { rows: UploadRow[]; extraneous: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: UploadRow[] = roster.map((s) => ({ studentId: s.id, name: s.name, roll: s.roll, marks: null, isAbsent: false, matchedBy: null }));
  const used: boolean[] = new Array(lines.length).fill(false);

  const setRow = (i: number, li: number, by: UploadRow['matchedBy']) => {
    const m = markFromLine(lines[li], max);
    if (!m) return false;
    rows[i].marks = m.marks;
    rows[i].isAbsent = m.isAbsent;
    rows[i].matchedBy = by;
    used[li] = true;
    return true;
  };

  // 1) Admission No — most reliable (printed on the template, copied verbatim).
  roster.forEach((s, i) => {
    if (rows[i].matchedBy) return;
    const key = alnum(s.id);
    if (key.length < 4) return;
    const li = lines.findIndex((l, k) => !used[k] && alnum(l).includes(key));
    if (li >= 0) setRow(i, li, 'admission');
  });
  // 2) Roll — first token on a line equals the student's roll.
  roster.forEach((s, i) => {
    if (rows[i].matchedBy || !s.roll) return;
    const rk = rollKey(s.roll);
    if (!rk) return;
    const li = lines.findIndex((l, k) => {
      if (used[k]) return false;
      const first = l.split(/[\s|,;:\t]+/).filter(Boolean)[0];
      return first != null && rollKey(first) === rk;
    });
    if (li >= 0) setRow(i, li, 'roll');
  });
  // 3) Name — normalised letters of the name appear on the line.
  roster.forEach((s, i) => {
    if (rows[i].matchedBy) return;
    const nk = letters(s.name);
    if (nk.length < 4) return;
    const li = lines.findIndex((l, k) => !used[k] && letters(l).includes(nk));
    if (li >= 0) setRow(i, li, 'name');
  });

  const extraneous: string[] = [];
  lines.forEach((l, k) => { if (!used[k] && markFromLine(l, max)) extraneous.push(l); });

  return { rows, extraneous: extraneous.slice(0, 30) };
}

// Resolve roster + max, match the text, and (optionally) write a DRAFT marksheet.
export async function processMarksUpload(opts: {
  selector: SheetSelector;
  text: string;
  apply: boolean;
  userId: string | null;
}): Promise<UploadResult> {
  const { selector } = opts;
  const assessment = await prisma.assessment.findUnique({ where: { id: selector.assessmentId } });
  if (!assessment) throw new Error('Assessment not found');

  const [override, sheet] = await Promise.all([
    prisma.assessmentSubject.findUnique({
      where: { assessmentId_subjectId: { assessmentId: selector.assessmentId, subjectId: selector.subjectId } },
      select: { maxMarks: true },
    }),
    prisma.markSheet.findFirst({
      where: { assessmentId: selector.assessmentId, classId: selector.classId, subjectId: selector.subjectId, sectionId: selector.sectionId ?? null },
      select: { maxMarks: true, status: true },
    }),
  ]);
  if (sheet?.status === 'APPROVED') throw new Error('This sheet is already approved and locked.');
  const max = sheet?.maxMarks ?? override?.maxMarks ?? assessment.defaultMax;

  const roster = await rosterForClass(assessment.yearId, selector.classId, selector.sectionId ?? null);
  if (roster.length === 0) throw new Error('No active students in this class/section.');

  const { rows, extraneous } = matchMarksText(roster, opts.text, max);
  const writable = rows.filter((r) => r.matchedBy && (r.isAbsent || r.marks != null));

  let sheetId: string | undefined;
  let status: string | undefined;
  if (opts.apply) {
    const marks = writable.map((r) => ({ studentId: r.studentId, marksObtained: r.isAbsent ? null : r.marks, isAbsent: r.isAbsent }));
    const res = await saveMarkSheet(selector, marks, 'save', opts.userId);
    sheetId = res.sheetId;
    status = res.status;
  }

  return { roster: roster.length, matched: writable.length, maxMarks: max, rows, extraneous, applied: opts.apply, sheetId, status };
}
