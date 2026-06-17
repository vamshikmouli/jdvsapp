import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { hashPassword } from '@/lib/auth/password';

// POST /api/staff-attendance/manage/pin   { staffId, pin }   — set / reset kiosk PIN
// DELETE /api/staff-attendance/manage/pin?staffId=...        — remove PIN
export async function POST(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const { staffId, pin } = await req.json();
    if (!staffId || !pin) {
      return NextResponse.json({ error: 'Staff and PIN are required.' }, { status: 400 });
    }
    if (!/^\d{4,6}$/.test(String(pin))) {
      return NextResponse.json({ error: 'PIN must be 4–6 digits.' }, { status: 400 });
    }
    await prisma.staff.update({
      where: { id: staffId },
      data: { pinHash: await hashPassword(String(pin)) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission('STAFF_ATTENDANCE_MANAGE');
    const staffId = new URL(req.url).searchParams.get('staffId');
    if (!staffId) return NextResponse.json({ error: 'staffId required' }, { status: 400 });
    await prisma.staff.update({ where: { id: staffId }, data: { pinHash: null } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
