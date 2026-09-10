import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getStudentAccount } from '@/lib/services/fees';
import { feeMoney } from '@/lib/fees';
import { sendPushToUsers, parentUserIdsForStudents } from '@/lib/push';
import { sendTextTemplate, toWaNumber, whatsappConfigured } from '@/lib/services/whatsapp';

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

    let created = 0, skippedZero = 0, skippedMissing = 0, pushSent = 0, waSent = 0, waFailed = 0;
    const waOn = whatsappConfigured();
    const feeTemplate = process.env.WHATSAPP_FEE_TEMPLATE || 'school_fee_reminder';
    const feeLang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

    for (const sid of studentIds) {
      const acc = await getStudentAccount(sid, year.id);
      if (!acc) { skippedMissing++; continue; }
      const balance = acc.summary.totalBalance;
      if (skipZero && balance <= 0) { skippedZero++; continue; }

      // Address the parent by father's name (fall back to guardian, then mother).
      const parentName = acc.student.fatherName || acc.student.guardianName || 'Parent';

      const body = render(template, {
        name: acc.student.name,
        className: acc.student.className,
        guardian: parentName,
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

      // WhatsApp — the approved "school_fee_reminder" template (father, student, class, balance).
      // The template has one balance slot, so pack the head-wise break-up into it
      // (one line, no newlines — WhatsApp template variables forbid them).
      if (waOn) {
        const to = toWaNumber(acc.student.guardianPhone);
        if (to) {
          const dueHeads = acc.summary.heads.filter((h) => h.balance > 0);
          const breakup = dueHeads.map((h) => `${h.name} ${feeMoney(h.balance)}`).join(', ');
          const balanceText = breakup ? `${feeMoney(balance)} (${breakup})` : feeMoney(balance);
          try {
            const wr = await sendTextTemplate({
              to, templateName: feeTemplate, lang: feeLang,
              bodyParams: [parentName, acc.student.name, cleanClass(acc.student.className) || '—', balanceText],
            });
            if (wr.ok) waSent++; else { waFailed++; console.error('wa fee reminder', to, wr.error); }
          } catch (e) { waFailed++; console.error('wa fee reminder', e); }
        } else { waFailed++; }
      }
    }

    return NextResponse.json({ created, skippedZero, skippedMissing, pushSent, waSent, waFailed });
  } catch (err) {
    console.error('bulk-reminder POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send' }, { status: 400 });
  }
}
