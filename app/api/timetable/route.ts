import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, authErrorResponse } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

// GET /api/timetable — the live (latest published) timetable.
//   ?class=LKG        → just that class's week
//   ?teacher=Saniya   → just that teacher's week
//   (no params)       → every class and teacher
// Each day is a list of periods; a class cell is { period, subject, teacher, co, support }
// and a teacher cell is { period, class, subject, role } or null when free.
export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const latest = await prisma.publishedTimetable.findFirst({ orderBy: { publishedAt: 'desc' } });
    if (!latest) {
      return NextResponse.json({ error: 'No timetable has been published yet' }, { status: 404 });
    }

    const data = latest.data as any;
    const meta = {
      publishedAt: latest.publishedAt.toISOString(),
      academicYear: latest.academicYear,
      forDate: latest.forDate,
      days: data.days,
      periodsPerDay: data.periodsPerDay,
    };

    const cls = req.nextUrl.searchParams.get('class');
    const teacher = req.nextUrl.searchParams.get('teacher');
    if (cls) {
      const week = data.classes?.[cls];
      if (!week) return NextResponse.json({ error: `No timetable for class ${cls}` }, { status: 404 });
      return NextResponse.json({ ...meta, class: cls, week });
    }
    if (teacher) {
      const week = data.teachers?.[teacher];
      if (!week) return NextResponse.json({ error: `No timetable for teacher ${teacher}` }, { status: 404 });
      return NextResponse.json({ ...meta, teacher, week });
    }
    return NextResponse.json({
      ...meta, classes: data.classes, teachers: data.teachers,
      availability: data.availability ?? {}, report: latest.report,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
