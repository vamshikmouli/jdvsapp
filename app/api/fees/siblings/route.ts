import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getActiveYear, getFamilyForStudent } from '@/lib/services/fees';

// GET /api/fees/siblings?studentId= — the family (siblings under one parent) with
// each child's outstanding charges, plus the Fee-Settings auto-allocate priority.
// Powers the Multi Collect screen. Read-only; changes nothing in the single flow.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_COLLECT')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const studentId = new URL(req.url).searchParams.get('studentId') || '';
    if (!studentId) return NextResponse.json({ error: 'studentId is required' }, { status: 400 });

    const year = await getActiveYear();
    const family = await getFamilyForStudent(studentId, year.id);
    if (!family) return NextResponse.json({ error: 'Student not found' }, { status: 404 });

    const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { feeAllocPriority: true } });
    return NextResponse.json({ ...family, priority: s?.feeAllocPriority || [] });
  } catch (err) {
    console.error('fees/siblings GET', err);
    return NextResponse.json({ error: 'Failed to load family' }, { status: 500 });
  }
}
