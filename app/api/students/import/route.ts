import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { ensureParentUser } from '@/lib/services/parents';
import { getActiveYear, autoAssignClassFees } from '@/lib/services/fees';
import { upsertEnrollment } from '@/lib/services/enrollment';

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
}

function parseDate(v: string): Date | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function normSmsFor(v: string): 'FATHER' | 'MOTHER' | 'BOTH' {
  const s = String(v || '').trim().toUpperCase();
  if (s.startsWith('MOT') || s === 'M') return 'MOTHER';
  if (s.startsWith('BOT')) return 'BOTH';
  return 'FATHER';
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STUDENTS_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const rows: ImportRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    if (rows.length > 2000) return NextResponse.json({ error: 'Too many rows (max 2000 at a time)' }, { status: 400 });

    // Build a flexible class lookup.
    const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true } });
    const classKey: Record<string, string> = {};
    for (const c of classes) { classKey[normClass(c.id)] = c.id; classKey[normClass(c.name)] = c.id; }

    const activeYear = await getActiveYear();

    // ---- Phase 1: validate EVERY row first (no writes) ----
    const providedIds = rows.map((r) => String(r.id || '').trim()).filter(Boolean);
    const existing = providedIds.length
      ? await prisma.student.findMany({ where: { id: { in: providedIds } }, select: { id: true } })
      : [];
    const existingIds = new Set(existing.map((e) => e.id));

    const errors: { row: number; name: string; reason: string }[] = [];
    const prepared: { id: string; classId: string | null; primaryName: string; primaryPhone: string; data: any }[] = [];
    const seenIds = new Set<string>();
    let seq = 0;
    const stamp = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2; // +1 header, +1 for 1-based

      const name = String(r.name || '').trim();
      if (!name) { errors.push({ row: rowNo, name: '(no name)', reason: 'Missing name' }); continue; }

      const gender = normGender(r.gender || '');
      if (!gender) { errors.push({ row: rowNo, name, reason: `Invalid gender "${String(r.gender || '')}" (use M / F)` }); continue; }

      const rawClass = String(r.class || '').trim();
      if (!rawClass) { errors.push({ row: rowNo, name, reason: 'Missing class' }); continue; }
      const classId = classKey[normClass(rawClass)] || null;
      if (!classId) { errors.push({ row: rowNo, name, reason: `Unknown class "${rawClass}"` }); continue; }

      let id = String(r.id || '').trim();
      if (id) {
        if (existingIds.has(id)) { errors.push({ row: rowNo, name, reason: `Admission no "${id}" already exists in the system` }); continue; }
        if (seenIds.has(id)) { errors.push({ row: rowNo, name, reason: `Duplicate admission no "${id}" within this file` }); continue; }
      } else {
        id = `JD${stamp}${String(++seq).padStart(3, '0')}`;
      }
      seenIds.add(id);

      const fatherName = String(r.fatherName || '').trim();
      const fatherPhone = String(r.fatherPhone || '').trim();
      const motherName = String(r.motherName || '').trim();
      const motherPhone = String(r.motherPhone || '').trim();
      const smsFor = normSmsFor(r.smsFor || '');
      const primaryName = (smsFor === 'MOTHER' ? motherName || fatherName : fatherName || motherName) || String(r.guardianName || '').trim();
      const primaryPhone = (smsFor === 'MOTHER' ? motherPhone || fatherPhone : fatherPhone || motherPhone) || String(r.guardianPhone || '').trim();

      prepared.push({
        id, classId, primaryName, primaryPhone,
        data: {
          id, name, classId, roll: String(r.roll || '').trim() || null, gender,
          dob: parseDate(r.dob || ''),
          religion: String(r.religion || '').trim() || null,
          category: String(r.category || '').trim() || null,
          caste: String(r.caste || '').trim() || null,
          address: String(r.address || '').trim() || null,
          fatherName: fatherName || null, fatherPhone: fatherPhone || null,
          motherName: motherName || null, motherPhone: motherPhone || null,
          smsFor, photoUrl: String(r.photoUrl || '').trim() || null,
          guardianName: primaryName || '—', guardianPhone: primaryPhone || '',
          village: String(r.village || '').trim() || null, status: 'ACTIVE',
        },
      });
    }

    // ---- If ANY row is invalid, import NOTHING and report the problems ----
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, total: rows.length, created: 0, failed: errors.length, errors: errors.slice(0, 300) });
    }

    // ---- Phase 2: the whole file is valid → create all ----
    let created = 0;
    for (const p of prepared) {
      const guardianUserId = p.primaryPhone ? await ensureParentUser(p.primaryName, p.primaryPhone) : undefined;
      await prisma.student.create({ data: { ...p.data, guardianUserId: guardianUserId || undefined } });
      if (p.classId) {
        try { await upsertEnrollment(p.id, activeYear.id, p.classId, null, p.data.roll); } catch (e) { console.error('enrollment failed for', p.id, e); }
        try { await autoAssignClassFees(p.id, p.classId, activeYear.id); } catch (e) { console.error('auto-assign failed for', p.id, e); }
      }
      created++;
    }

    return NextResponse.json({ ok: true, total: rows.length, created, failed: 0, errors: [] });
  } catch (err) {
    console.error('students/import POST', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
