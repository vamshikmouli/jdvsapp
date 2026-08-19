import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { loadStaffAttConfig } from '@/lib/staffAttendance/config';
import { localDayInfo } from '@/lib/staffAttendance/rules';
import { parseWorkDays, parseWorkPattern, parseWeekSchedule, daySession, emptyStatusForSession, weekdayOfKey } from '@/lib/staffAttendance/schedule';
import { renderDailyBoardPng } from '@/lib/services/attendanceImage';
import { whatsappConfigured, toWaNumber, uploadWhatsAppMedia, sendImageTemplate } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

const SCHOOL = 'Jnana Deepika Vidhya Samsthe';
const TZ = 'Asia/Kolkata';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST (or GET) /api/staff-attendance/cron/daily-admin-report
// Renders the full daily staff-attendance board and WhatsApps it to the admin
// recipients (env WHATSAPP_ADMIN_RECIPIENTS, comma-separated). Fired twice a day
// by VM cron (10:30 & 17:00 IST).
//   ?dry=1        — render + count, don't send
//   ?to=NUMBER    — override recipients (send only to this number)
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

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  if (!toOverride && settings && settings.waDailyEnabled === false) {
    return NextResponse.json({ ok: true, skipped: 'daily digest disabled in settings' });
  }
  const recipientSrc = settings?.waAdminRecipients || process.env.WHATSAPP_ADMIN_RECIPIENTS || '';
  const recipients = (toOverride
    ? [toOverride]
    : recipientSrc.split(',').map((s) => s.trim()).filter(Boolean)
  ).map(toWaNumber).filter(Boolean) as string[];

  if (!dry && recipients.length === 0) {
    return NextResponse.json({ ok: false, error: 'No admin recipients (set WHATSAPP_ADMIN_RECIPIENTS)' }, { status: 400 });
  }

  const cfg = await loadStaffAttConfig();
  const now = new Date();
  const dateKey = localDayInfo(now, cfg.timezone).dateKey;
  const date = new Date(`${dateKey}T00:00:00Z`);

  const [staff, days, holiday] = await Promise.all([
    prisma.staff.findMany({
      where: { archived: false, NOT: { user: { role: { key: 'admin' } } } },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, designation: true, pinHash: true, deviceUserId: true,
        weekSchedule: true, workPattern: true, workDays: true,
        attCredentials: { where: { active: true }, select: { id: true } },
      },
    }),
    prisma.staffAttendanceDay.findMany({ where: { date } }),
    prisma.holiday.findUnique({ where: { date }, select: { name: true } }),
  ]);

  const byStaff = new Map(days.map((d) => [d.staffId, d]));
  const weekday = weekdayOfKey(dateKey);
  const weeklyOff = cfg.schedule.weeklyOffDays;

  const rows = staff.map((s) => {
    const day = byStaff.get(s.id);
    const session = daySession(weekday, parseWeekSchedule(s.weekSchedule), { workPattern: parseWorkPattern(s.workPattern), workDays: parseWorkDays(s.workDays) }, weeklyOff);
    const fallback = emptyStatusForSession(session, !!holiday);
    return {
      name: s.name,
      designation: s.designation,
      status: day?.status ?? fallback,
      late: day?.late ?? false,
      lateMinutes: day?.lateMinutes ?? 0,
      firstIn: day?.firstIn ?? null,
      lastOut: day?.lastOut ?? null,
    };
  });

  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
  const dateShort = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
  const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });

  const png = renderDailyBoardPng({ dateLabel, timeLabel, rows, schoolName: SCHOOL });

  if (dry) {
    return NextResponse.json({ ok: true, date: dateShort, time: timeLabel, staff: rows.length, recipients: recipients.length, bytes: png.length, dry: true });
  }

  const template = process.env.WHATSAPP_DAILY_TEMPLATE_NAME || 'daily_attendance_summary';
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
  const mediaId = await uploadWhatsAppMedia(png);

  const results: any[] = [];
  let sent = 0, failed = 0;
  for (const to of recipients) {
    const r = await sendImageTemplate({ to, templateName: template, lang, mediaId, bodyParams: [dateShort, timeLabel] });
    if (r.ok) { sent++; results.push({ to, status: 'sent', id: r.id }); }
    else { failed++; results.push({ to, status: 'failed', error: r.error }); }
    await sleep(300);
  }

  return NextResponse.json({ ok: true, date: dateShort, time: timeLabel, staff: rows.length, sent, failed, results });
}

export const GET = handler;
export const POST = handler;
