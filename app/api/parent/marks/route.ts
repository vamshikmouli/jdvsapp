import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { getActiveYear } from '@/lib/services/fees';
import { getStudentReport } from '@/lib/services/marks';

// GET /api/parent/marks?studentId= — report card for one of the guardian's children.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const studentId = new URL(req.url).searchParams.get('studentId') || '';
    const child = await prisma.student.findFirst({ where: { id: studentId, guardianUserId: userId }, select: { id: true } });
    if (!child) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const year = await getActiveYear();
    const report = await getStudentReport(studentId, year.id);
    if (!report) return NextResponse.json({ error: 'No report' }, { status: 404 });

    return NextResponse.json({ year: year.label, ...report });
  } catch (err) {
    console.error('parent marks error:', err);
    return NextResponse.json({ error: 'Failed to load marks' }, { status: 500 });
  }
}
