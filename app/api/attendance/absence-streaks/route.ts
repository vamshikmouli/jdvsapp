import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getContinuousAbsentees, sendAbsenceStreakSummary } from '@/lib/services/attendanceStreaks';
import { whatsappConfigured } from '@/lib/services/whatsapp';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

// GET /api/attendance/absence-streaks?min=3 — students currently on a 3+ day
// absent/leave streak (for the analytics view).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const min = Math.max(2, Number(new URL(req.url).searchParams.get('min')) || 3);
    const rows = await getContinuousAbsentees(min);
    return NextResponse.json({ min, rows, waConfigured: whatsappConfigured() });
  } catch (err) {
    console.error('absence-streaks GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

// POST /api/attendance/absence-streaks — send the admin summary now. Body: { min?, to? }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    if (!whatsappConfigured()) return NextResponse.json({ error: 'WhatsApp is not configured.' }, { status: 400 });
    const result = await sendAbsenceStreakSummary({ minStreak: b.min ? Math.max(2, Number(b.min)) : 3, toOverride: b.to ? String(b.to) : undefined });
    void logActivity(session, { category: 'OTHER', action: 'ABSENCE_STREAK_SENT', summary: `Sent 3+ day absentee summary — ${result.flagged} student(s), ${result.sent} message(s)`, meta: { flagged: result.flagged }, req });
    return NextResponse.json(result);
  } catch (err) {
    console.error('absence-streaks POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send' }, { status: 500 });
  }
}
