import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { whatsappConfigured } from '@/lib/services/whatsapp';
import { runStaffAppreciation, type HalfMonthWindow } from '@/lib/services/staffAppreciation';

export const dynamic = 'force-dynamic';

// POST (or GET) /api/staff-attendance/cron/appreciation
// Appreciates staff for attendance over the completed 15-day window (1–15 / 16–end).
// Fire on the 1st & 16th via VM cron.
//
// Auth: `Authorization: Bearer <CRON_SECRET>`, or an admin with STAFF_ATTENDANCE_MANAGE.
// Query flags (admin testing):
//   ?dry=1          — classify + count, but DON'T send
//   ?staffId=ID     — only this staff member
//   ?to=NUMBER      — send every message to this test number
//   ?window=YYYY-MM-H1|H2  — override the window (e.g. 2026-10-H1)
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    can(await getServerSession(authOptions), 'STAFF_ATTENDANCE_MANAGE');
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dry = sp.get('dry') === '1';

  if (!dry && !whatsappConfigured()) {
    return NextResponse.json({ ok: false, error: 'WhatsApp not configured (set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)' }, { status: 400 });
  }

  // Optional explicit window override: "2026-10-H1" / "2026-10-H2".
  let window: HalfMonthWindow | undefined;
  const w = sp.get('window');
  if (w) {
    const mch = /^(\d{4})-(\d{2})-H([12])$/.exec(w);
    if (!mch) return NextResponse.json({ error: 'Bad window — use YYYY-MM-H1 or YYYY-MM-H2' }, { status: 400 });
    const [, yy, mm, h] = mch;
    const y = Number(yy), m0 = Number(mm) - 1;
    const lastDay = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    const start = h === '1' ? 1 : 16;
    const end = h === '1' ? 15 : lastDay;
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    window = {
      fromKey: `${yy}-${mm}-${String(start).padStart(2, '0')}`,
      toKey: `${yy}-${mm}-${String(end).padStart(2, '0')}`,
      label: `${start}–${end} ${MONTHS[m0]} ${y}`,
      key: `${yy}-${mm}-H${h}`,
    };
  }

  const out = await runStaffAppreciation({
    window,
    dry,
    onlyStaffId: sp.get('staffId'),
    toOverride: sp.get('to'),
  });
  return NextResponse.json(out);
}

export const GET = handler;
export const POST = handler;
