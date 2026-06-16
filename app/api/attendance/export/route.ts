import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', LEAVE: 'Leave', EXCUSED: 'Excused',
};
const HEADER = ['Admission No', 'Student Name', 'Class', 'Date', 'Session', 'Status', 'Marked By'];

// GET /api/attendance/export?classId=&from=YYYY-MM-DD&to=YYYY-MM-DD
// Human-readable attendance (no ids) — re-importable via /api/attendance/bulk-import.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['ATTENDANCE_VIEW', 'REPORTS_EXPORT', 'SETTINGS_MANAGE'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const classId = sp.get('classId') || '';
    const from = sp.get('from') || '';
    const to = sp.get('to') || '';

    const where: any = {};
    if (classId) where.classId = classId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const [sessions, settings] = await Promise.all([
      prisma.attendanceSession.findMany({
        where,
        orderBy: [{ date: 'asc' }, { classId: 'asc' }, { slot: 'asc' }],
        include: { class: { select: { name: true } }, records: { include: { student: { select: { id: true, name: true } } } } },
      }),
      prisma.settings.findUnique({ where: { id: 'singleton' }, select: { sessions: true } }),
    ]);

    const slotLabel = new Map<string, string>();
    for (const s of ((settings?.sessions as any[]) || [])) if (s?.key) slotLabel.set(s.key, s.label || s.key);

    const takerIds = Array.from(new Set(sessions.map((s) => s.takenById).filter(Boolean))) as string[];
    const users = takerIds.length ? await prisma.user.findMany({ where: { id: { in: takerIds } }, select: { id: true, name: true } }) : [];
    const userName = new Map(users.map((u) => [u.id, u.name]));

    const rows: Record<string, string>[] = [];
    for (const s of sessions) {
      const dateStr = s.date.toISOString().slice(0, 10); // ISO YYYY-MM-DD (unambiguous for re-import)
      const sName = slotLabel.get(s.slot) || s.slot;
      const marker = s.takenById ? (userName.get(s.takenById) || '') : '';
      for (const r of s.records) {
        rows.push({
          'Admission No': r.student.id,
          'Student Name': r.student.name,
          'Class': s.class?.name || s.classId,
          'Date': dateStr,
          'Session': sName,
          'Status': STATUS_LABEL[r.status] || r.status,
          'Marked By': marker,
        });
      }
    }

    const ws = rows.length ? XLSX.utils.json_to_sheet(rows, { header: HEADER }) : XLSX.utils.aoa_to_sheet([HEADER]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="attendance-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('attendance/export', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
