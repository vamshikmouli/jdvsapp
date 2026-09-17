import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { sendMonthlyReports } from '@/lib/services/monthlyAttendance';
import { whatsappConfigured } from '@/lib/services/whatsapp';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const validMonth = (m: string) => /^\d{4}-\d{2}$/.test(m);

// GET /api/attendance/monthly-report?month=YYYY-MM&classId=  → preview (renders nothing,
// returns who would be messaged, tier split, no WhatsApp sent).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const sp = new URL(req.url).searchParams;
    const month = sp.get('month') || '';
    const classId = sp.get('classId') || undefined;
    if (!validMonth(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    const result = await sendMonthlyReports({ month, classId, dry: true });
    return NextResponse.json({ ...result, waConfigured: whatsappConfigured() });
  } catch (err) {
    console.error('monthly-report GET', err);
    return NextResponse.json({ error: 'Failed to build preview' }, { status: 500 });
  }
}

// POST /api/attendance/monthly-report  Body: { month, classId?, to? }
// Sends the image + tiered message to each student's parents. `to` overrides the
// recipient (admin test send).
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json();
    const month = String(b.month || '');
    const classId = b.classId ? String(b.classId) : undefined;
    const toOverride = b.to ? String(b.to) : undefined;
    if (!validMonth(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    if (!whatsappConfigured()) return NextResponse.json({ error: 'WhatsApp is not configured.' }, { status: 400 });

    const result = await sendMonthlyReports({ month, classId, toOverride, sentById: (session.user as any)?.id ?? null });
    void logActivity(session, {
      category: 'OTHER', action: 'MONTHLY_ATTENDANCE_SENT',
      summary: `Sent monthly attendance for ${result.monthLabel} — ${result.sent} message(s)${classId ? '' : ' (all classes)'}`,
      meta: { month, classId: classId || null, sent: result.sent, failed: result.failed }, req,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('monthly-report POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send' }, { status: 500 });
  }
}
