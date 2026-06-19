import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { AttendanceStatus } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const norm = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function parseDate(s: any): Date | null {
  if (s == null || s === '') return null;
  // Excel may store the date as a serial number or a Date object (when edited/saved).
  if (typeof s === 'number' && s > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(s) * 86400000);
    return isNaN(d.getTime()) ? null : utcDay(d);
  }
  if (s instanceof Date) return isNaN(s.getTime()) ? null : utcDay(s);
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // iso (preferred, unambiguous)
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return isNaN(d.getTime()) ? null : d; }
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd/mm/yyyy
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(Date.UTC(y, +m[2] - 1, +m[1])); return isNaN(d.getTime()) ? null : d; }
  return null;
}

function statusOf(t: any): AttendanceStatus | null {
  const k = norm(t);
  if (!k) return null;
  if (k.startsWith('P')) return 'PRESENT';
  if (k.startsWith('AB') || k === 'A') return 'ABSENT';
  if (k.startsWith('LA')) return 'LATE';
  if (k.startsWith('L')) return 'LEAVE';
  if (k.startsWith('EX') || k === 'E') return 'EXCUSED';
  return null;
}

// POST /api/attendance/bulk-import — raw .xlsx bytes of the friendly export.
// Matches each row by Class + Date + Session + Admission No (no ids), creates/
// updates the session and the student's status. Skips locked sessions.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['ATTENDANCE_MARK', 'ATTENDANCE_LOCK'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) return NextResponse.json({ error: 'The sheet has no rows' }, { status: 400 });

    // Lookups
    const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true } });
    const classByNorm = new Map<string, string>();
    for (const c of classes) { classByNorm.set(norm(c.name), c.id); classByNorm.set(norm(c.id), c.id); }

    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { sessions: true } });
    const slotByNorm = new Map<string, string>();
    for (const s of ((settings?.sessions as any[]) || [])) if (s?.key) { slotByNorm.set(norm(s.label || s.key), s.key); slotByNorm.set(norm(s.key), s.key); }

    const students = await prisma.student.findMany({ select: { id: true, name: true } });
    const studentIds = new Set(students.map((s) => s.id));
    const studentByName = new Map<string, string>();
    for (const s of students) studentByName.set(norm(s.name), s.id);

    const meId = (session.user as any)?.id || null;

    // Group rows into sessions keyed by (classId, date, slot).
    const groups = new Map<string, { classId: string; date: Date; slot: string; recs: { studentId: string; status: AttendanceStatus }[] }>();
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rawClass = String(r['Class'] ?? r['class'] ?? '').trim();
      const rawSession = String(r['Session'] ?? r['session'] ?? r['Slot'] ?? '').trim();
      const rawAdm = String(r['Student ID'] ?? r['StudentID'] ?? r['Admission No'] ?? r['AdmissionNo'] ?? r['Admission'] ?? r['ID'] ?? '').trim();
      const rawName = String(r['Student Name'] ?? r['Name'] ?? '').trim();

      const classId = classByNorm.get(norm(rawClass));
      const date = parseDate(r['Date'] ?? r['date']);
      const slot = slotByNorm.get(norm(rawSession)) || rawSession;
      const status = statusOf(r['Status'] ?? r['status']);
      let sid = studentIds.has(rawAdm) ? rawAdm : '';
      if (!sid && rawName) sid = studentByName.get(norm(rawName)) || '';

      const probs: string[] = [];
      if (!classId) probs.push(`class "${rawClass}"`);
      if (!date) probs.push(`date "${String(r['Date'] ?? '')}"`);
      if (!slot) probs.push('session (blank)');
      if (!status) probs.push(`status "${String(r['Status'] ?? '')}"`);
      if (!sid) probs.push(`student "${rawAdm || rawName}"`);
      if (probs.length) {
        if (errors.length < 25) errors.push(`Row ${i + 2}: unknown ${probs.join(', ')}`);
        continue;
      }
      const key = `${classId}|${date!.toISOString().slice(0, 10)}|${slot}`;
      const g = groups.get(key) || { classId: classId!, date: date!, slot, recs: [] };
      g.recs.push({ studentId: sid, status: status! });
      groups.set(key, g);
    }

    let sessionsTouched = 0, recordsUpserted = 0, skippedLocked = 0;
    for (const g of groups.values()) {
      let s = await prisma.attendanceSession.findUnique({ where: { classId_date_slot: { classId: g.classId, date: g.date, slot: g.slot } } });
      if (s?.locked) { skippedLocked += g.recs.length; continue; }
      if (!s) s = await prisma.attendanceSession.create({ data: { classId: g.classId, date: g.date, slot: g.slot, takenById: meId } });
      await prisma.$transaction(
        g.recs.map((rec) =>
          prisma.attendanceRecord.upsert({
            where: { sessionId_studentId: { sessionId: s!.id, studentId: rec.studentId } },
            update: { status: rec.status },
            create: { sessionId: s!.id, studentId: rec.studentId, status: rec.status },
          }),
        ),
      );
      sessionsTouched++;
      recordsUpserted += g.recs.length;
    }

    return NextResponse.json({ ok: true, sessions: sessionsTouched, records: recordsUpserted, skippedLocked, errors });
  } catch (err) {
    console.error('attendance/bulk-import', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed' }, { status: 400 });
  }
}
