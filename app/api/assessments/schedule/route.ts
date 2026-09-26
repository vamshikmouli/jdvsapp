import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, canAny } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

export interface ExamRow { subject: string; date: string; day: string; session: string; time: string }
type Schedule = Record<string, ExamRow[]>;

const clean = (rows: any): ExamRow[] => (Array.isArray(rows) ? rows : [])
  .map((r) => ({
    subject: String(r?.subject || '').trim(),
    date: String(r?.date || '').trim(),
    day: String(r?.day || '').trim(),
    session: String(r?.session || '').trim(),
    time: String(r?.time || '').trim(),
  }))
  .filter((r) => r.subject || r.date || r.time);

// GET /api/assessments/schedule?assessmentId=&classId=
// Returns the exam rows for that class (or the whole {classId:rows} map if no classId).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  // Readable by anyone who can see marks or generate hall tickets.
  if (!session || !canAny(session, ['MARKS_VIEW', 'MARKS_SETUP', 'HALL_TICKETS_ACCESS', 'STUDENTS_MANAGE'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const assessmentId = sp.get('assessmentId') || '';
  const classId = sp.get('classId') || '';
  if (!assessmentId) return NextResponse.json({ error: 'assessmentId required' }, { status: 400 });
  const a = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { examSchedule: true } });
  const schedule = (a?.examSchedule as Schedule | null) || {};
  return NextResponse.json(classId ? { rows: schedule[classId] || [] } : { schedule });
}

// PUT /api/assessments/schedule  Body: { assessmentId, classId, rows: ExamRow[] }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'MARKS_SETUP')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const assessmentId = String(b.assessmentId || '');
  const classId = String(b.classId || '');
  if (!assessmentId || !classId) return NextResponse.json({ error: 'assessmentId and classId required' }, { status: 400 });

  const a = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { examSchedule: true } });
  if (!a) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
  const schedule = { ...((a.examSchedule as Schedule | null) || {}) };
  const rows = clean(b.rows);
  if (rows.length) schedule[classId] = rows; else delete schedule[classId];
  await prisma.assessment.update({ where: { id: assessmentId }, data: { examSchedule: schedule as any } });
  return NextResponse.json({ ok: true, rows });
}
