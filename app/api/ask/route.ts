import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { classify, runQuery, askConfigured } from '@/lib/ai/ask';

export const dynamic = 'force-dynamic';

// POST /api/ask  { question }  → natural-language answer over fees + attendance.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canFees = can(session, 'FEES_VIEW');
  const canAttendance = can(session, 'ATTENDANCE_VIEW');
  if (!canFees && !canAttendance) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!askConfigured()) {
    return NextResponse.json({ error: 'Ask is not configured yet (missing ANTHROPIC_API_KEY on the server).' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const question = String(body?.question || '').trim();
  if (!question) return NextResponse.json({ error: 'Type a question.' }, { status: 400 });

  try {
    const parsed = await classify(question);
    const result = await runQuery(parsed, { canFees, canAttendance });
    return NextResponse.json(result);
  } catch (e) {
    console.error('ask', e);
    return NextResponse.json({ error: 'Sorry, I couldn’t answer that right now.' }, { status: 500 });
  }
}
