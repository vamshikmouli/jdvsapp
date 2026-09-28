import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';

export const dynamic = 'force-dynamic';

// GET /api/attendance/holidays?from=&to=  — list school holidays (default: this year).
// Read-only for any signed-in user. Holidays are school-wide (the same table the
// staff-attendance side declares into), so student attendance can reflect them too.
// Declaring/removing holidays stays on /api/staff-attendance/holidays (config perm).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(req.url).searchParams;
    const year = new Date().getFullYear();
    const from = new Date(`${sp.get('from') || `${year}-01-01`}T00:00:00Z`);
    const to = new Date(`${sp.get('to') || `${year}-12-31`}T00:00:00Z`);
    const holidays = await prisma.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: { date: true, name: true },
    });
    // Normalise to plain YYYY-MM-DD keys the client can match on.
    return NextResponse.json(
      holidays.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name })),
    );
  } catch (err) {
    console.error('attendance/holidays GET', err);
    return NextResponse.json({ error: 'Failed to load holidays' }, { status: 500 });
  }
}
