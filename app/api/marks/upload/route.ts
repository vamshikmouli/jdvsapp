import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { processMarksUpload } from '@/lib/services/marksUpload';
// Deep import avoids pdf-parse's index.js debug block (which reads a sample file).
// @ts-expect-error no type declarations for the deep path
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Pull plain text out of the upload. PDF → text layer; xlsx/csv → row cells joined.
async function extractText(file: File): Promise<string> {
  const name = (file.name || '').toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const data = await pdfParse(buf);
    return String(data?.text || '');
  }
  const wb = XLSX.read(buf, { type: 'buffer' });
  const lines: string[] = [];
  for (const sn of wb.SheetNames) {
    const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    for (const row of aoa) lines.push(row.map((c) => String(c ?? '')).join(' '));
  }
  return lines.join('\n');
}

// POST /api/marks/upload — multipart form: file + assessmentId/classId/subjectId
// (+ optional sectionId) + apply ("true" to write the DRAFT, else dry-run preview).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['MARKS_ENTER', 'MARKS_APPROVE'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const assessmentId = String(form.get('assessmentId') || '');
    const classId = String(form.get('classId') || '');
    const subjectId = String(form.get('subjectId') || '');
    const sectionId = String(form.get('sectionId') || '') || null;
    const apply = String(form.get('apply') || '') === 'true';
    if (!assessmentId || !classId || !subjectId) {
      return NextResponse.json({ error: 'Missing assessment, class or subject' }, { status: 400 });
    }

    const text = await extractText(file);
    if (!text.trim()) {
      return NextResponse.json(
        { error: 'No readable text found. A scanned/handwritten PDF must first be converted to a typed PDF (see the instructions) before uploading.' },
        { status: 400 },
      );
    }

    const userId = (session.user as any)?.id || null;
    const result = await processMarksUpload({ selector: { assessmentId, classId, sectionId, subjectId }, text, apply, userId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('marks/upload', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 400 });
  }
}
