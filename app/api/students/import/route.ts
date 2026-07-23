import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { ensureParentUser } from '@/lib/services/parents';
import { getActiveYear, autoAssignClassFees } from '@/lib/services/fees';
import { upsertEnrollment } from '@/lib/services/enrollment';
import { generateAdmissionNo } from '@/lib/services/admissionNo';

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

// Normalise a class label to a comparable key. Handles "10th STD", "10",
// Roman numerals ("IV STD", "X"), and Pre-KG variants ("PKG", "Pre-KG", "PREKG").
function normClass(v: string): string {
  let s = String(v || '').toUpperCase().replace(/STANDARD|STD/g, '').replace(/[^A-Z0-9]/g, '');
  if (s === 'PKG' || s === 'PREKG' || s === 'PREKINDERGARTEN') return 'PREKG';
  s = s.replace(/(\d+)(ST|ND|RD|TH)$/, '$1'); // 1ST → 1
  if (ROMAN[s]) return String(ROMAN[s]); // IV → 4
  return s;
}

function normGender(v: string): 'M' | 'F' | null {
  const s = String(v || '').trim().toUpperCase();
  if (['M', 'MALE', 'BOY', 'B'].includes(s)) return 'M';
  if (['F', 'FEMALE', 'GIRL', 'G'].includes(s)) return 'F';
  return null;
}

interface ImportRow {
  id?: string;
  name?: string;
  class?: string;
  roll?: string;
  gender?: string;
  dob?: string;
  religion?: string;
  category?: string;
  caste?: string;
  address?: string;
  fatherName?: string;
  fatherPhone?: string;
  motherName?: string;
  motherPhone?: string;
  smsFor?: string;
  photoUrl?: string;
  guardianName?: string;
  guardianPhone?: string;
  village?: string;
  taluk?: string;
  district?: string;
  placeOfBirth?: string;
  motherTongue?: string;
  aadharNumber?: string;
  previousSchool?: string;
  annualIncome?: string;
  noOfDependents?: string;
  joinedDate?: string;
  satsId?: string;
  admissionNo?: string;
}

function parseDate(v: string): Date | null {
  const s = String(v || '').trim();
  if (!s) return null;
  // Try DD/MM/YYYY format (school register format)
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [_, d, mo, y] = m;
    const date = new Date(+y, +mo - 1, +d);
    if (!isNaN(date.getTime())) return date;
  }
  // Fall back to JS-native parsing (handles YYYY-MM-DD, etc.)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function normSmsFor(v: string): 'FATHER' | 'MOTHER' | 'BOTH' {
  const s = String(v || '').trim().toUpperCase();
  if (s.startsWith('MOT') || s === 'M') return 'MOTHER';
  if (s.startsWith('BOT')) return 'BOTH';
  return 'FATHER';
}

// Is a DB value "empty" for the purposes of fill-blanks mode?
function isBlank(v: any): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

// Plain text fields that can be copied straight from the sheet (row key → student column).
const TEXT_FIELDS: [keyof ImportRow, string][] = [
  ['religion', 'religion'], ['category', 'category'], ['caste', 'caste'], ['address', 'address'],
  ['fatherName', 'fatherName'], ['fatherPhone', 'fatherPhone'], ['motherName', 'motherName'], ['motherPhone', 'motherPhone'],
  ['photoUrl', 'photoUrl'], ['village', 'village'], ['taluk', 'taluk'], ['district', 'district'],
  ['placeOfBirth', 'placeOfBirth'], ['motherTongue', 'motherTongue'], ['aadharNumber', 'aadharNumber'],
  ['previousSchool', 'previousSchool'], ['satsId', 'satsId'], ['admissionNo', 'admissionNo'],
  ['annualIncome', 'annualIncome'], ['noOfDependents', 'noOfDependents'],
];
// Names are stored upper-cased.
const UPPER_FIELDS = new Set(['fatherName', 'motherName']);

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STUDENTS_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const rows: ImportRow[] = Array.isArray(body?.rows) ? body.rows : [];
    // Import behaviour for rows whose Student ID already exists:
    //   'create' (default) → existing IDs are rejected (import stays additive-only)
    //   'upsert'           → existing IDs are updated instead of erroring
    const mode: 'create' | 'upsert' = body?.mode === 'upsert' ? 'upsert' : 'create';
    // In upsert mode, onlyFillBlanks=true writes a field only when it's currently empty;
    // false overwrites with the sheet value (blank cells are always skipped either way).
    const onlyFillBlanks = mode === 'upsert' && body?.onlyFillBlanks === true;
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    if (rows.length > 2000) return NextResponse.json({ error: 'Too many rows (max 2000 at a time)' }, { status: 400 });

    // Build a flexible class lookup.
    const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true } });
    const classKey: Record<string, string> = {};
    for (const c of classes) { classKey[normClass(c.id)] = c.id; classKey[normClass(c.name)] = c.id; }

    const activeYear = await getActiveYear();

    // ---- Phase 1: validate EVERY row first (no writes) ----
    const providedIds = rows.map((r) => String(r.id || '').trim()).filter(Boolean);
    // In upsert mode we need the full existing record (for fill-blanks + guardian relink);
    // in create mode we only need to know which ids already exist.
    const existingRecords = providedIds.length
      ? (mode === 'upsert'
          ? await prisma.student.findMany({ where: { id: { in: providedIds } } })
          : await prisma.student.findMany({ where: { id: { in: providedIds } }, select: { id: true } }))
      : [];
    const existingById = new Map<string, any>(existingRecords.map((e) => [e.id, e]));
    const existingIds = new Set(existingById.keys());

    const errors: { row: number; name: string; reason: string }[] = [];
    type Prepared =
      | { op: 'create'; id: string; classId: string | null; primaryName: string; primaryPhone: string; data: any }
      | { op: 'update'; id: string; data: any };
    const prepared: Prepared[] = [];
    const seenIds = new Set<string>();
    let seq = 0;
    const stamp = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2; // +1 header, +1 for 1-based

      const id = String(r.id || '').trim();
      const isUpdate = mode === 'upsert' && id !== '' && existingIds.has(id);

      // ---------- UPDATE an existing student ----------
      if (isUpdate) {
        if (seenIds.has(id)) { errors.push({ row: rowNo, name: id, reason: `Duplicate Student ID "${id}" within this file` }); continue; }
        seenIds.add(id);
        const existing = existingById.get(id);
        const name = String(r.name || '').trim().toUpperCase();

        // Collect only the fields the sheet actually provides (blank cells never overwrite).
        const provided: any = {};
        if (name) provided.name = name;

        if (String(r.gender || '').trim()) {
          const g = normGender(r.gender || '');
          if (!g) { errors.push({ row: rowNo, name: name || id, reason: `Invalid gender "${String(r.gender || '')}" (use M / F)` }); continue; }
          provided.gender = g;
        }
        if (String(r.roll || '').trim()) provided.roll = String(r.roll).trim();

        // Dates: if provided but unparseable, fail the whole import so nothing is half-written.
        let dateBad = false;
        for (const [key, col] of [['dob', 'dob'], ['joinedDate', 'joinedDate']] as [keyof ImportRow, string][]) {
          const raw = String(r[key] || '').trim();
          if (raw) { const d = parseDate(raw); if (!d) { errors.push({ row: rowNo, name: name || id, reason: `Invalid date "${raw}" in ${col}` }); dateBad = true; break; } provided[col] = d; }
        }
        if (dateBad) continue;

        // Numbers
        let numBad = false;
        for (const [key, col] of [['annualIncome', 'annualIncome'], ['noOfDependents', 'noOfDependents']] as [keyof ImportRow, string][]) {
          const raw = String(r[key] || '').replace(/[,\s]/g, '');
          if (raw) { const n = Number(raw); if (!Number.isFinite(n)) { errors.push({ row: rowNo, name: name || id, reason: `"${raw}" in ${col} is not a number` }); numBad = true; break; } provided[col] = n; }
        }
        if (numBad) continue;

        for (const [rowKey, col] of TEXT_FIELDS) {
          const raw = String(r[rowKey] || '').trim();
          if (raw) provided[col] = UPPER_FIELDS.has(col) ? raw.toUpperCase() : raw;
        }
        if (String(r.smsFor || '').trim()) provided.smsFor = normSmsFor(r.smsFor || '');

        // Guardian: if the sheet supplies a phone, recompute the primary contact from the
        // effective (provided-or-existing) values so guardianName/Phone stay in sync.
        const gaveContact = ['fatherPhone', 'motherPhone', 'guardianPhone', 'guardianName']
          .some((k) => String((r as any)[k] || '').trim());
        if (gaveContact) {
          const smsFor = provided.smsFor || existing.smsFor || 'FATHER';
          const fName = provided.fatherName ?? existing.fatherName ?? '';
          const fPhone = provided.fatherPhone ?? existing.fatherPhone ?? '';
          const mName = provided.motherName ?? existing.motherName ?? '';
          const mPhone = provided.motherPhone ?? existing.motherPhone ?? '';
          const gName = String(r.guardianName || '').trim().toUpperCase();
          const gPhone = String(r.guardianPhone || '').trim();
          const primaryName = (smsFor === 'MOTHER' ? mName || fName : fName || mName) || gName;
          const primaryPhone = (smsFor === 'MOTHER' ? mPhone || fPhone : fPhone || mPhone) || gPhone;
          if (primaryName) provided.guardianName = primaryName;
          if (primaryPhone) provided.guardianPhone = primaryPhone;
        }

        // Apply the fill-blanks filter: keep a field only if the current DB value is empty.
        let updateData: any = provided;
        if (onlyFillBlanks) {
          updateData = {};
          for (const [k, v] of Object.entries(provided)) {
            if (isBlank(existing[k])) updateData[k] = v;
          }
        }

        prepared.push({ op: 'update', id, data: updateData });
        continue;
      }

      // ---------- CREATE a new student ----------
      const name = String(r.name || '').trim().toUpperCase();
      if (!name) { errors.push({ row: rowNo, name: '(no name)', reason: 'Missing name' }); continue; }

      const gender = normGender(r.gender || '');
      if (!gender) { errors.push({ row: rowNo, name, reason: `Invalid gender "${String(r.gender || '')}" (use M / F)` }); continue; }

      const rawClass = String(r.class || '').trim();
      if (!rawClass) { errors.push({ row: rowNo, name, reason: 'Missing class' }); continue; }
      const classId = classKey[normClass(rawClass)] || null;
      if (!classId) { errors.push({ row: rowNo, name, reason: `Unknown class "${rawClass}"` }); continue; }

      let newId = id;
      if (newId) {
        // Non-empty id that isn't an existing student. In create mode an existing id is a hard
        // error; here (id present but not found) we honour it as the new student's id.
        if (mode === 'create' && existingIds.has(newId)) { errors.push({ row: rowNo, name, reason: `Student ID "${newId}" already exists in the system` }); continue; }
        if (seenIds.has(newId)) { errors.push({ row: rowNo, name, reason: `Duplicate Student ID "${newId}" within this file` }); continue; }
      } else {
        // JDVS+YY+CC+RR from the row's class + roll; fall back to a unique id if roll is blank.
        newId = (await generateAdmissionNo({ classId, roll: r.roll, yearId: activeYear.id, taken: seenIds }))
          || `JD${stamp}${String(++seq).padStart(3, '0')}`;
      }
      seenIds.add(newId);

      const fatherName = String(r.fatherName || '').trim().toUpperCase();
      const fatherPhone = String(r.fatherPhone || '').trim();
      const motherName = String(r.motherName || '').trim().toUpperCase();
      const motherPhone = String(r.motherPhone || '').trim();
      const smsFor = normSmsFor(r.smsFor || '');
      const primaryName = (smsFor === 'MOTHER' ? motherName || fatherName : fatherName || motherName) || String(r.guardianName || '').trim().toUpperCase();
      const primaryPhone = (smsFor === 'MOTHER' ? motherPhone || fatherPhone : fatherPhone || motherPhone) || String(r.guardianPhone || '').trim();

      prepared.push({
        op: 'create', id: newId, classId, primaryName, primaryPhone,
        data: {
          id: newId, name, classId, roll: String(r.roll || '').trim() || null, gender,
          admissionNo: String(r.admissionNo || '').trim() || null,
          dob: parseDate(r.dob || ''),
          religion: String(r.religion || '').trim() || null,
          category: String(r.category || '').trim() || null,
          caste: String(r.caste || '').trim() || null,
          address: String(r.address || '').trim() || null,
          fatherName: fatherName || null, fatherPhone: fatherPhone || null,
          motherName: motherName || null, motherPhone: motherPhone || null,
          smsFor, photoUrl: String(r.photoUrl || '').trim() || null,
          guardianName: primaryName || '—', guardianPhone: primaryPhone || '',
          village: String(r.village || '').trim() || null,
          taluk: String(r.taluk || '').trim() || null,
          district: String(r.district || '').trim() || null,
          placeOfBirth: String(r.placeOfBirth || '').trim() || null,
          motherTongue: String(r.motherTongue || '').trim() || null,
          aadharNumber: String(r.aadharNumber || '').trim() || null,
          previousSchool: String(r.previousSchool || '').trim() || null,
          satsId: String(r.satsId || '').trim() || null,
          annualIncome: String(r.annualIncome ?? '').replace(/[,\s]/g, '') !== '' ? Number(String(r.annualIncome).replace(/[,\s]/g, '')) : null,
          noOfDependents: String(r.noOfDependents ?? '').replace(/[,\s]/g, '') !== '' ? Number(String(r.noOfDependents).replace(/[,\s]/g, '')) : null,
          joinedDate: parseDate(r.joinedDate || ''),
          status: 'ACTIVE',
        },
      });
    }

    // ---- If ANY row is invalid, import NOTHING and report the problems ----
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, total: rows.length, created: 0, updated: 0, skipped: 0, failed: errors.length, errors: errors.slice(0, 300) });
    }

    // ---- Phase 2: the whole file is valid → apply all ----
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const p of prepared) {
      if (p.op === 'update') {
        // Nothing to change (e.g. fill-blanks with every field already populated).
        if (Object.keys(p.data).length === 0) { skipped++; continue; }
        let guardianUserId: string | undefined;
        if (p.data.guardianPhone) {
          guardianUserId = await ensureParentUser(p.data.guardianName || 'PARENT', p.data.guardianPhone) || undefined;
        }
        await prisma.student.update({
          where: { id: p.id },
          data: { ...p.data, ...(guardianUserId ? { guardianUserId } : {}) },
        });
        updated++;
        continue;
      }
      const guardianUserId = p.primaryPhone ? await ensureParentUser(p.primaryName, p.primaryPhone) : undefined;
      await prisma.student.create({ data: { ...p.data, guardianUserId: guardianUserId || undefined } });
      if (p.classId) {
        try { await upsertEnrollment(p.id, activeYear.id, p.classId, null, p.data.roll); } catch (e) { console.error('enrollment failed for', p.id, e); }
        try { await autoAssignClassFees(p.id, p.classId, activeYear.id); } catch (e) { console.error('auto-assign failed for', p.id, e); }
      }
      created++;
    }

    return NextResponse.json({ ok: true, total: rows.length, created, updated, skipped, failed: 0, errors: [] });
  } catch (err) {
    console.error('students/import POST', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
