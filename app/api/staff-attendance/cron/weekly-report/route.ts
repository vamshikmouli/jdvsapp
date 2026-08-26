import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import {
  synthesizeDays, parseWeekSchedule, parseWorkPattern, parseWorkDays,
} from '@/lib/staffAttendance/schedule';
import { renderAttendanceCalendarPng } from '@/lib/services/attendanceImage';
import { whatsappConfigured, toWaNumber, uploadWhatsAppMedia, sendAttendanceTemplate } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SCHOOL = 'Jnana Deepika Vidhya Samsthe';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST (or GET) /api/staff-attendance/cron/weekly-report
// Sends each active, opted-in staff member their month-to-date attendance
// calendar as a WhatsApp image. Fired weekly by GitHub Actions.
//
// Auth: `Authorization: Bearer <CRON_SECRET>`, or an admin with
// STAFF_ATTENDANCE_MANAGE (manual "send now").
// Query flags (admin testing):
//   ?dry=1        — render + count, but DON'T send (no WhatsApp calls)
//   ?staffId=ID   — only this staff member
//   ?to=NUMBER    — override recipient (send every render to this test number)
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(await getServerSession(authOptions), 'STAFF_ATTENDANCE_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dry = sp.get('dry') === '1';
  const onlyStaff = sp.get('staffId');
  const toOverride = sp.get('to');

  if (!dry && !whatsappConfigured()) {
    return NextResponse.json({ ok: false, error: 'WhatsApp not configured (set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)' }, { status: 400 });
  }

  const cfg = await loadStaffAttConfig();

  // Current month, month-to-date, in the configured timezone (IST).
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const yy = ist.getUTCFullYear();
  const mo = ist.getUTCMonth();               // 0-based
  const monthStr = `${yy}-${String(mo + 1).padStart(2, '0')}`;
  const monthLabel = `${MONTHS[mo]} ${yy}`;
  const fromKey = `${monthStr}-01`;
  const todayKey = ist.toISOString().slice(0, 10);
  const from = new Date(`${fromKey}T00:00:00Z`);
  const to = now;

  const staff = await prisma.staff.findMany({
    where: {
      archived: false,
      attendanceTracked: true,
      waReportOptIn: true,
      ...(onlyStaff ? { id: onlyStaff } : {}),
    },
    select: {
      id: true, name: true, designation: true, phone: true,
      weekSchedule: true, workPattern: true, workDays: true,
    },
    orderBy: { name: 'asc' },
  });

  const holidays = await prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } });
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

  const results: { sent: number; skipped: number; failed: number; details: any[] } = { sent: 0, skipped: 0, failed: 0, details: [] };

  for (const s of staff) {
    const wa = toWaNumber(toOverride || s.phone);
    if (!wa) { results.skipped++; results.details.push({ name: s.name, status: 'skipped', reason: 'no valid phone' }); continue; }

    try {
      const stored = await prisma.staffAttendanceDay.findMany({
        where: { staffId: s.id, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      });
      const existing = new Set(stored.map((d) => d.date.toISOString().slice(0, 10)));
      const synthetic = synthesizeDays({
        fromKey, toKey: todayKey, todayKey, existing, holidays: holidaySet,
        weekSchedule: parseWeekSchedule(s.weekSchedule),
        workPattern: parseWorkPattern(s.workPattern),
        workDays: parseWorkDays(s.workDays),
        weeklyOffDays: cfg.schedule.weeklyOffDays,
      });
      const days = [
        ...stored.map((d) => ({ date: d.date.toISOString().slice(0, 10), status: d.status, late: d.late, halfSession: d.halfSession })),
        ...synthetic.map((d: any) => ({ date: String(d.date).slice(0, 10), status: d.status, late: d.late, halfSession: d.halfSession })),
      ];

      const png = renderAttendanceCalendarPng({ staffName: s.name, designation: s.designation, month: monthStr, days, schoolName: SCHOOL });

      if (dry) { results.sent++; results.details.push({ name: s.name, status: 'rendered', bytes: png.length, to: wa }); continue; }

      const mediaId = await uploadWhatsAppMedia(png);
      const send = await sendAttendanceTemplate({ to: wa, name: s.name.split(' ')[0] || s.name, monthLabel, mediaId });
      if (send.ok) { results.sent++; results.details.push({ name: s.name, status: 'sent', to: wa, id: send.id }); }
      else { results.failed++; results.details.push({ name: s.name, status: 'failed', to: wa, error: send.error }); }
      await sleep(350); // gentle pacing
    } catch (e: any) {
      results.failed++;
      results.details.push({ name: s.name, status: 'error', error: e?.message || String(e) });
    }
  }

  return NextResponse.json({ ok: true, month: monthLabel, dry, total: staff.length, ...results });
}

export const GET = handler;
export const POST = handler;
