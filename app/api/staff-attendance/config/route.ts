import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { parseQuotas, LEAVE_TYPES } from '@/lib/staffAttendance/leaveBalance';

const SINGLETON = 'singleton';

const NUMERIC = ['geofenceRadiusM', 'gpsAccuracyMaxM', 'lateGraceMins', 'halfDayMins', 'fullDayMins'] as const;
const FLOAT = ['schoolLat', 'schoolLng'] as const;
const STRING = ['shiftStart', 'shiftEnd'] as const;

async function getOrCreate() {
  return prisma.settings.upsert({ where: { id: SINGLETON }, update: {}, create: { id: SINGLETON } });
}

// GET — current staff-attendance configuration
export async function GET() {
  try {
    await requirePermission('STAFF_ATTENDANCE_CONFIG');
    const s = await getOrCreate();
    return NextResponse.json({
      staffAttEnabled: s.staffAttEnabled,
      schoolLat: s.schoolLat,
      schoolLng: s.schoolLng,
      geofenceRadiusM: s.geofenceRadiusM,
      gpsAccuracyMaxM: s.gpsAccuracyMaxM,
      shiftStart: s.shiftStart,
      shiftEnd: s.shiftEnd,
      lateGraceMins: s.lateGraceMins,
      halfDayMins: s.halfDayMins,
      fullDayMins: s.fullDayMins,
      weeklyOffDays: (s.weeklyOffDays as number[] | null) ?? [0],
      leaveQuotas: parseQuotas(s.leaveQuotas),
      leaveYearStartMonth: s.leaveYearStartMonth ?? 6,
      timezone: s.timezone,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// PATCH — update configuration
export async function PATCH(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_CONFIG');
    await getOrCreate();
    const body = await req.json();
    const data: Record<string, any> = {};

    if (body.staffAttEnabled !== undefined) data.staffAttEnabled = !!body.staffAttEnabled;
    for (const k of NUMERIC) if (body[k] !== undefined) data[k] = Math.max(0, Math.round(Number(body[k])));
    for (const k of FLOAT) if (body[k] !== undefined) data[k] = body[k] === null ? null : Number(body[k]);
    for (const k of STRING) if (body[k] !== undefined && /^\d{2}:\d{2}$/.test(body[k])) data[k] = body[k];
    if (body.weeklyOffDays !== undefined) {
      data.weeklyOffDays = Array.isArray(body.weeklyOffDays)
        ? body.weeklyOffDays.map((n: any) => Number(n)).filter((n: number) => n >= 0 && n <= 6)
        : [];
    }
    if (body.leaveQuotas !== undefined) {
      const q = parseQuotas(body.leaveQuotas);
      data.leaveQuotas = Object.fromEntries(LEAVE_TYPES.map((t) => [t, q[t]]));
    }
    if (body.leaveYearStartMonth !== undefined) {
      const m = Math.round(Number(body.leaveYearStartMonth));
      if (m >= 1 && m <= 12) data.leaveYearStartMonth = m;
    }

    // Guard the half/full-day ordering so the rules stay sane.
    if (data.halfDayMins != null && data.fullDayMins != null && data.halfDayMins > data.fullDayMins) {
      return NextResponse.json({ error: 'Half-day minutes cannot exceed full-day minutes.' }, { status: 400 });
    }

    const s = await prisma.settings.update({ where: { id: SINGLETON }, data });
    return NextResponse.json({ ok: true, staffAttEnabled: s.staffAttEnabled });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
