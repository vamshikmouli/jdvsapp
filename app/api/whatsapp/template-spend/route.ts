import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getTemplateSpend, getWaInsightsEnabled, enableWaInsights, whatsappConfigured } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD → per-template amount spent (from Meta).
// If analytics isn't enabled for the WABA yet, returns { insightsEnabled: false }
// so the UI can offer the one-time Enable action (POST below).
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!whatsappConfigured()) return NextResponse.json({ error: 'WhatsApp is not configured on the server.' }, { status: 400 });

    const sp = new URL(req.url).searchParams;
    const start = sp.get('start') || '';
    const end = sp.get('end') || '';
    if (!validDate(start) || !validDate(end)) return NextResponse.json({ error: 'start and end must be YYYY-MM-DD' }, { status: 400 });
    if (start > end) return NextResponse.json({ error: 'The start date must be on or before the end date.' }, { status: 400 });

    const insightsEnabled = await getWaInsightsEnabled();
    if (insightsEnabled === false) return NextResponse.json({ insightsEnabled: false, rows: [], total: 0 });

    const report = await getTemplateSpend(start, end);
    return NextResponse.json({ insightsEnabled: insightsEnabled ?? true, ...report });
  } catch (err) {
    console.error('template-spend GET', err);
    return NextResponse.json({ error: 'Failed to load spend' }, { status: 500 });
  }
}

// POST { action: 'enable' } → turn on WhatsApp analytics for the WABA (irreversible).
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'NOTICES_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    if (b.action !== 'enable') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    const r = await enableWaInsights();
    if (!r.ok) return NextResponse.json({ error: r.error || 'Could not enable analytics.' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('template-spend POST', err);
    return NextResponse.json({ error: 'Failed to enable analytics' }, { status: 500 });
  }
}
