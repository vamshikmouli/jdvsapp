import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { createImageTemplate } from '@/lib/services/whatsapp';
import { renderDailyBoardPng } from '@/lib/services/attendanceImage';

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

// POST /api/admin/whatsapp/template — create an image-header template in Meta.
// { name, category: 'UTILITY'|'MARKETING', body, footer? }
export async function POST(req: NextRequest) {
  try {
    await requirePermission('SETTINGS_MANAGE');
    const b = await req.json();
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
