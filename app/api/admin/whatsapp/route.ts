import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { whatsappConfigured, getPhoneStatus, listTemplates } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

// GET /api/admin/whatsapp — connection status, templates (+ review status), recipients.
export async function GET() {
  try {
    await requirePermission('SETTINGS_MANAGE');
    const [phone, templates, settings] = await Promise.all([
      getPhoneStatus(),
      listTemplates(),
      prisma.settings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } }),
    ]);
    return NextResponse.json({
      configured: whatsappConfigured(),
      phone,
      templates,
      recipients: settings.waAdminRecipients ?? process.env.WHATSAPP_ADMIN_RECIPIENTS ?? '',
      dailyEnabled: settings.waDailyEnabled,
      weeklyEnabled: settings.waWeeklyEnabled,
      weeklyTemplate: process.env.WHATSAPP_TEMPLATE_NAME || 'weekly_attendance_report',
      dailyTemplate: process.env.WHATSAPP_DAILY_TEMPLATE_NAME || 'daily_attendance_summary',
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// PATCH /api/admin/whatsapp — save admin recipients / enable flags.
export async function PATCH(req: NextRequest) {
  try {
    await requirePermission('SETTINGS_MANAGE');
    const b = await req.json();
    const data: any = {};
    if (typeof b.recipients === 'string') {
      // normalise: keep digits + commas
      data.waAdminRecipients = b.recipients.split(',').map((x: string) => x.replace(/[^\d+]/g, '')).filter(Boolean).join(',');
    }
    if (typeof b.dailyEnabled === 'boolean') data.waDailyEnabled = b.dailyEnabled;
    if (typeof b.weeklyEnabled === 'boolean') data.waWeeklyEnabled = b.weeklyEnabled;
    const s = await prisma.settings.upsert({ where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data } });
    return NextResponse.json({ ok: true, recipients: s.waAdminRecipients });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
