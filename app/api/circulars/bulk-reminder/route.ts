import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getStudentAccount } from '@/lib/services/fees';
import { feeMoney } from '@/lib/fees';
import { sendPushToUsers, parentUserIdsForStudents } from '@/lib/push';

const cleanClass = (name: string | null) => (name ? name.replace(/\s?STD$/i, '') : '');

/**
 * Fill a message template with one student's details.
 * Tokens: {name} {firstname} {class} {guardian} {balance} {breakup}
 */
function render(template: string, ctx: { name: string; className: string | null; guardian: string; balance: number; heads: { name: string; balance: number }[] }) {
  const breakup = ctx.heads.filter((h) => h.balance > 0).map((h) => `• ${h.name}: ${feeMoney(h.balance)}`).join('\n');
  return template
    .replace(/\{name\}/gi, ctx.name)
    .replace(/\{firstname\}/gi, ctx.name.split(' ')[0])
    .replace(/\{class\}/gi, cleanClass(ctx.className) || '—')
    .replace(/\{guardian\}/gi, ctx.guardian || 'Parent')
    .replace(/\{balance\}/gi, feeMoney(ctx.balance))
    .replace(/\{breakup\}/gi, breakup);
}

// POST /api/circulars/bulk-reminder — personalized fee reminder to many students at once.
// Each student's parent gets their OWN balance filled into the template.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const b = await req.json();
    const studentIds: string[] = Array.isArray(b.studentIds) ? b.studentIds.map(String) : [];
    const title = String(b.title || 'Fee payment reminder').trim();
    const template = String(b.body || '').trim();
    const skipZero = b.skipZero !== false; // default: skip students with no balance
    if (studentIds.length === 0) return NextResponse.json({ error: 'Pick at least one student' }, { status: 400 });
    if (!template) return NextResponse.json({ error: 'Message template is required' }, { status: 400 });

    const year = await getActiveYear();
    const createdById = (session.user as any)?.id || null;

    let created = 0, skippedZero = 0, skippedMissing = 0, pushSent = 0;

    for (const sid of studentIds) {
      const acc = await getStudentAccount(sid, year.id);
      if (!acc) { skippedMissing++; continue; }
      const balance = acc.summary.totalBalance;
      if (skipZero && balance <= 0) { skippedZero++; continue; }

      const body = render(template, {
        name: acc.student.name,
        className: acc.student.className,
        guardian: acc.student.guardianName,
        balance,
        heads: acc.summary.heads.map((h) => ({ name: h.name, balance: h.balance })),
      });

      const circ = await prisma.circular.create({
        data: {
          title, body, kind: 'FEE_REMINDER', audience: 'STUDENT',
          classIds: [], studentIds: [sid], category: 'Fees', pinned: false, createdById,
        },
        select: { id: true },
      });
      created++;

      // Push to this student's parent with their own balance.
      try {
        const parents = await parentUserIdsForStudents([sid]);
        const r = await sendPushToUsers(parents, {
          title: `Fee reminder: ${title}`,
          body: body.length > 160 ? body.slice(0, 157) + '…' : body,
          url: '/parent',
          tag: `fee-${circ.id}`,
        });
        pushSent += r.sent;
      } catch (e) { console.error('bulk push', e); }
    }

    return NextResponse.json({ created, skippedZero, skippedMissing, pushSent });
  } catch (err) {
    console.error('bulk-reminder POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send' }, { status: 400 });
  }
}
