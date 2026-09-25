import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getActiveYear } from '@/lib/services/fees';
import { generateAdmissionNo } from '@/lib/services/admissionNo';

// Next roll number for a class + the student ID it would produce, so the Add
// Student form can auto-fill the roll (staff don't have to remember it) and show
// a live "Will be created as JDVS…" preview.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'STUDENTS_CREATE')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const classId = req.nextUrl.searchParams.get('classId');
  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });

  const rows = await prisma.student.findMany({
    where: { classId, status: 'ACTIVE' },
    select: { roll: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.roll || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const roll = String(max + 1).padStart(2, '0');
  const year = await getActiveYear();
  const studentId = await generateAdmissionNo({ classId, roll, yearId: year.id });
  return NextResponse.json({ roll, studentId });
}
