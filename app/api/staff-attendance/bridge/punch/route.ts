import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { recordPunch } from '@/lib/staffAttendance/service';

export const dynamic = 'force-dynamic';

// POST /api/staff-attendance/bridge/punch
// Called by the biometric bridge (biometric-bridge/ws-server.js) for each punch the
// SalaryBox terminal pushes. Body: { enrollid, time, inout?, sn? }
//   enrollid — the id enrolled on the terminal; maps to Staff.deviceUserId
//   time     — device-local timestamp "YYYY-MM-DD HH:mm:ss" (school timezone, IST)
// Auth: Authorization: Bearer <CRON_SECRET>.
// Idempotent: the device re-sends buffered logs on reconnect, so an identical
// (staff, timestamp) DEVICE punch is skipped rather than duplicated.
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const enrollid = String(body?.enrollid ?? '').trim();
    const timeStr = String(body?.time ?? '').trim();
    if (!enrollid || !timeStr) {
      return NextResponse.json({ error: 'enrollid and time are required' }, { status: 400 });
    }

    // Device sends local school time; India has no DST so a fixed +05:30 is correct.
    const at = new Date(`${timeStr.replace(' ', 'T')}+05:30`);
    if (isNaN(at.getTime())) {
      return NextResponse.json({ error: `Invalid time: ${timeStr}` }, { status: 400 });
    }

    const staff = await prisma.staff.findFirst({
      where: { deviceUserId: enrollid, archived: false },
      select: { id: true, name: true },
    });
    // Unknown enrollid isn't an error — the bridge shouldn't retry. Surface it so
    // an admin can map the id to a staff member.
    if (!staff) {
      return NextResponse.json({ ok: true, skipped: 'unmapped', enrollid });
    }

    const existing = await prisma.staffPunch.findFirst({
      where: { staffId: staff.id, at, source: 'DEVICE' },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true, staff: staff.name, at: at.toISOString() });
    }

    // Direction is auto-decided (open session -> OUT, else IN), matching the phone
    // and kiosk flows — the terminal's own in/out flag isn't reliable.
    const result = await recordPunch({
      staffId: staff.id,
      source: 'DEVICE',
      at,
      withinFence: true,
      note: body?.sn ? `terminal ${body.sn}` : null,
    });

    return NextResponse.json({
      ok: true,
      staff: staff.name,
      at: at.toISOString(),
      type: result.punch?.type ?? null,
      status: result.day?.status ?? null,
    });
  } catch (err: any) {
    console.error('bridge punch error:', err);
    return NextResponse.json({ error: 'Failed to record punch' }, { status: 500 });
  }
}
