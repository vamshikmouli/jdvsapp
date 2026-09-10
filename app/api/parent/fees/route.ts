import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getParentUser } from '@/lib/auth/parentAuth';
import { getActiveYear, getStudentAccount } from '@/lib/services/fees';

// GET /api/parent/fees?studentId=  — fee summary for one of the guardian's children.
export async function GET(req: NextRequest) {
  try {
    const auth = await getParentUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = auth.userId;

    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get('studentId') || '';

    // Must be this guardian's child.
    const child = await prisma.student.findFirst({ where: { id: studentId, guardianUserId: userId }, select: { id: true } });
    if (!child) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const year = await getActiveYear();
    const account = await getStudentAccount(studentId, year.id);
    if (!account) return NextResponse.json({ error: 'No fees' }, { status: 404 });

    return NextResponse.json({
      year: year.label,
      summary: account.summary,
      payments: account.payments.filter((p) => !p.voided).slice(0, 6),
      concessions: account.concessions.filter((c) => c.status !== 'REJECTED'),
    });
  } catch (err) {
    console.error('parent fees error:', err);
    return NextResponse.json({ error: 'Failed to load fees' }, { status: 500 });
  }
}
