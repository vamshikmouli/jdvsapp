import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo } from '@/lib/staffAttendance/rules';
import { parseWorkDays, parseWorkPattern, parseWeekSchedule, daySession, emptyStatusForSession, weekdayOfKey } from '@/lib/staffAttendance/schedule';
import { whatsappConfigured, toWaNumber, sendTextTemplate } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Kolkata';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST (or GET) /api/staff-attendance/cron/attendance-reminder
// End-of-day nudge: for staff who were expected to work today but have NO punch
// and NO leave request, WhatsApp them to either apply for leave or submit a
// punch-miss (regularization) request. Fired by VM cron in the evening.
//   ?dry=1        — list candidates, don't send
//   ?to=NUMBER    — send every candidate render to this test number
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(await getServerSession(authOptions), 'STAFF_ATTENDANCE_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dry = sp.get('dry') === '1';
  const toOverride = sp.get('to');

  if (!dry && !whatsappConfigured()) {
    return NextResponse.json({ ok: false, error: 'WhatsApp not configured' }, { status: 400 });
  }

  const cfg = await loadStaffAttConfig();
  const now = new Date();
  const dateKey = localDayInfo(now, cfg.timezone).dateKey;
  const date = new Date(`${dateKey}T00:00:00Z`);
  const dateShort = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });

  const [staff, days, holiday, leaves] = await Promise.all([
    prisma.staff.findMany({
      where: { archived: false, attendanceTracked: true, NOT: { user: { role: { key: 'admin' } } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, weekSchedule: true, workPattern: true, workDays: true },
    }),
    prisma.staffAttendanceDay.findMany({ where: { date } }),
    prisma.holiday.findUnique({ where: { date }, select: { name: true } }),
    prisma.leaveRequest.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: date }, toDate: { gte: date } },
      select: { staffId: true },
    }),
  ]);

  const byStaff = new Map(days.map((d) => [d.staffId, d]));
  const onLeave = new Set(leaves.map((l) => l.staffId));
  const weekday = weekdayOfKey(dateKey);
  const weeklyOff = cfg.schedule.weeklyOffDays;
  const template = process.env.WHATSAPP_REMINDER_TEMPLATE_NAME || 'attendance_reminder';
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

  const results = { sent: 0, skipped: 0, failed: 0, candidates: [] as any[] };

  for (const s of staff) {
    const session = daySession(weekday, parseWeekSchedule(s.weekSchedule), { workPattern: parseWorkPattern(s.workPattern), workDays: parseWorkDays(s.workDays) }, weeklyOff);
    const expected = emptyStatusForSession(session, !!holiday) === 'ABSENT'; // ABSENT fallback = a working day they missed
    if (!expected) { results.skipped++; continue; }

    const day = byStaff.get(s.id);
    const accounted = !!day && (!!day.firstIn || ['PRESENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].includes(day.status));
    if (accounted) { results.skipped++; continue; }
    if (onLeave.has(s.id)) { results.skipped++; continue; }

    // Candidate: expected to work, no punch, no leave.
    const wa = toWaNumber(toOverride || s.phone);
    if (!wa) { results.skipped++; results.candidates.push({ name: s.name, status: 'no-phone' }); continue; }

    if (dry) { results.sent++; results.candidates.push({ name: s.name, to: wa, status: 'would-remind' }); continue; }

    const r = await sendTextTemplate({ to: wa, templateName: template, lang, bodyParams: [s.name.split(' ')[0] || s.name, dateShort] });
    if (r.ok) { results.sent++; results.candidates.push({ name: s.name, to: wa, status: 'sent', id: r.id }); }
    else { results.failed++; results.candidates.push({ name: s.name, to: wa, status: 'failed', error: r.error }); }
    await sleep(300);
  }

  return NextResponse.json({ ok: true, date: dateShort, dry, ...results });
}

export const GET = handler;
export const POST = handler;
