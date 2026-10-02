import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { createImageTemplate } from '@/lib/services/whatsapp';
import { renderDailyBoardPng, renderAttendanceCalendarPng } from '@/lib/services/attendanceImage';
import { WA_TEMPLATE_PRESETS } from '@/lib/waTemplatePresets';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// A representative sample image for Meta's template review (image header).
function sampleImage(): Buffer {
  const rows = [
    { name: 'Asha Rao', designation: '', status: 'PRESENT', firstIn: null, lastOut: null, late: false, lateMinutes: 0 },
    { name: 'Ravi Kumar', designation: '', status: 'LEAVE', firstIn: null, lastOut: null, late: false, lateMinutes: 0 },
    { name: 'Meena S', designation: '', status: 'ABSENT', firstIn: null, lastOut: null, late: false, lateMinutes: 0 },
  ];
  return renderDailyBoardPng({ dateLabel: 'Monday, 4 August 2026', timeLabel: '5:00 PM', rows, schoolName: 'Jnana Deepika Vidhya Samsthe' });
}

// Sample month calendar (a student's month) for the monthly-attendance template review.
function sampleCalendar(schoolName: string): Buffer {
  const days: { date: string; status: string }[] = [];
  for (let d = 1; d <= 30; d++) {
    const date = `2025-09-${String(d).padStart(2, '0')}`;
    if (new Date(date).getDay() === 0) continue; // Sundays off
    days.push({ date, status: d === 10 ? 'ABSENT' : d === 16 || d === 17 ? 'LEAVE' : 'PRESENT' });
  }
  return renderAttendanceCalendarPng({ staffName: 'ASHA', designation: 'Class 3', month: '2025-09', days, schoolName });
}

// POST /api/admin/whatsapp/template — create an image-header template in Meta.
// { name, category: 'UTILITY'|'MARKETING', body, footer? }  or  { preset: '<key>' }
// (a ready-made UTILITY template from lib/waTemplatePresets).
export async function POST(req: NextRequest) {
  try {
    await requirePermission('SETTINGS_MANAGE');
    const b = await req.json();
    if (b.preset) {
      const p = WA_TEMPLATE_PRESETS.find((x) => x.key === b.preset);
      if (!p) return NextResponse.json({ ok: false, error: 'Unknown template' }, { status: 400 });
      const schoolName = (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { schoolName: true } }))?.schoolName || 'Jnana Deepika Vidhya Samsthe';
      const result = await createImageTemplate({ name: p.name, category: p.category, body: p.body, footer: schoolName.slice(0, 60), sample: sampleCalendar(schoolName), examples: p.examples });
      if (!result.ok) return NextResponse.json(result, { status: 400 });
      return NextResponse.json(result);
    }
    const name = String(b.name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    const category = b.category === 'MARKETING' ? 'MARKETING' : 'UTILITY';
    const body = String(b.body || '').trim();
    const footer = String(b.footer || '').trim() || undefined;

    if (!name) return NextResponse.json({ ok: false, error: 'Template name is required' }, { status: 400 });
    if (!body) return NextResponse.json({ ok: false, error: 'Body text is required' }, { status: 400 });
    // Meta rejects a variable at the very start or end of the body.
    if (/^\s*\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}\s*$/.test(body)) {
      return NextResponse.json({ ok: false, error: 'A variable ({{1}}) cannot be at the very start or end of the body — add words around it.' }, { status: 400 });
    }

    const result = await createImageTemplate({ name, category, body, footer, sample: sampleImage() });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
