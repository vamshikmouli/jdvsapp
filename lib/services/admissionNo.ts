import { prisma } from '@/lib/db';

// ============================================================================
// Admission number = JDVS + YY + CC + RR  (a permanent snapshot taken at admission)
//   YY = 2-digit admission (academic) year, e.g. 2026-27 → "26"
//   CC = 2-digit class code (below)
//   RR = 2-digit roll number
// Example: admitted 2026 into 1st STD roll 5 → "JDVS260105".
// It is fixed when the student is added and never changes on promotion.
// ============================================================================

// Grades 1..10 keep their number (01..10); pre-primary: PreKG=11, LKG=12, UKG=13.
const CLASS_CODE: Record<string, string> = {
  prekg: '11', lkg: '12', ukg: '13',
  '1': '01', '2': '02', '3': '03', '4': '04', '5': '05',
  '6': '06', '7': '07', '8': '08', '9': '09', '10': '10',
};

export function classCode(classId: string | null | undefined): string | null {
  if (classId == null) return null;
  return CLASS_CODE[String(classId).trim().toLowerCase()] ?? null;
}

// 2-digit admission year from an academic-year id ("2026-27" → "26").
export function yearCode(yearId: string): string {
  const m = String(yearId).match(/(\d{4})/);
  const y = m ? m[1] : String(new Date().getFullYear());
  return y.slice(-2);
}

/**
 * Build the admission number for a new student. Returns null when the class is
 * unknown or the roll is missing (caller should fall back to a safe unique id).
 * If the base is already taken (e.g. the same roll exists in another section),
 * a "-2", "-3"… suffix is appended so the id stays unique.
 *
 * Pass `taken` (a Set of ids already chosen this batch) when importing so
 * in-flight ids don't collide before they hit the database.
 */
export async function generateAdmissionNo(opts: {
  classId: string | null | undefined;
  roll: string | number | null | undefined;
  yearId: string;
  taken?: Set<string>;
}): Promise<string | null> {
  const cc = classCode(opts.classId);
  const rr = String(opts.roll ?? '').replace(/\D/g, '');
  if (!cc || !rr) return null;

  const base = `JDVS${yearCode(opts.yearId)}${cc}${rr.padStart(2, '0')}`;

  // The base, then "-2" … "-99": the first one not taken in the database or this batch.
  // All candidates are checked in one query.
  const candidates = [base, ...Array.from({ length: 98 }, (_, k) => `${base}-${k + 2}`)];
  const inDb = new Set((await prisma.student.findMany({ where: { id: { in: candidates } }, select: { id: true } })).map((s) => s.id));
  const free = candidates.find((id) => !opts.taken?.has(id) && !inDb.has(id));
  if (!free) return null;
  opts.taken?.add(free);
  return free;
}
