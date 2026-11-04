import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/timetable/publish
// Called by the offline timetable app (D:\apps\timetableapp) when the admin clicks
// "Publish to ERP". Body: { academicYear?, forDate?, days, periodsPerDay, classes,
// teachers, report? } — see PublishedTimetable in prisma/schema.prisma.
// Auth: Authorization: Bearer <TIMETABLE_PUBLISH_KEY> (its own key, so the timetable
// PC never holds CRON_SECRET).
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.TIMETABLE_PUBLISH_KEY;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { academicYear, forDate, days, periodsPerDay, classes, teachers, report } = body ?? {};
    if (!Array.isArray(days) || !classes || typeof classes !== 'object' || !Object.keys(classes).length) {
      return NextResponse.json({ error: 'days and classes are required' }, { status: 400 });
    }

    const row = await prisma.publishedTimetable.create({
      data: {
        academicYear: academicYear ? String(academicYear) : null,
        forDate: forDate ? String(forDate) : null,
        data: { days, periodsPerDay: periodsPerDay ?? {}, classes, teachers: teachers ?? {} },
        report: report ?? undefined,
      },
      select: { id: true, publishedAt: true },
    });

    // Every publish is kept (never hard-delete); the newest row is the live timetable.
    return NextResponse.json({
      ok: true,
      id: row.id,
      publishedAt: row.publishedAt.toISOString(),
      classes: Object.keys(classes).length,
      teachers: Object.keys(teachers ?? {}).length,
    });
  } catch (err: any) {
    console.error('timetable publish error:', err);
    return NextResponse.json({ error: 'Failed to publish timetable' }, { status: 500 });
  }
}
