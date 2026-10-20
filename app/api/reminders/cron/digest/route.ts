import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { sendRemindersDigest } from '@/lib/services/reminders';

export const dynamic = 'force-dynamic';

// GET|POST /api/reminders/cron/digest — notify each person of reminders due today
// or overdue (in-app + push). Run once each morning from the VM cron.
// Auth: `Authorization: Bearer <CRON_SECRET>`, or an admin for a manual run.
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const session = await getServerSession(authOptions);
  const authed =
    (secret && req.headers.get('authorization') === `Bearer ${secret}`) ||
    (session && canAny(session, ['SETTINGS_MANAGE', 'USERS_MANAGE']));
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const res = await sendRemindersDigest();
  return NextResponse.json({ ok: true, ...res });
}

export const GET = handler;
export const POST = handler;
