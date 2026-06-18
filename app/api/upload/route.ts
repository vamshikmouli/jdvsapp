import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

// Storage strategy:
//  - If Supabase Storage is configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
//    upload there and return its public URL. Works on serverless hosts (Vercel) where
//    the filesystem is ephemeral.
//  - Otherwise fall back to writing under /public/uploads/students (local dev / a VPS
//    like Oracle Cloud with a persistent disk).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

async function uploadToSupabase(filename: string, bytes: Buffer, contentType: string, folder: string) {
  const objectPath = `${folder}/${filename}`;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${objectPath}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      // Buffer isn't accepted as BodyInit by the fetch lib types; Uint8Array is.
      body: new Uint8Array(bytes),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase upload failed (${res.status}): ${detail}`);
  }
  // Public URL (the bucket must be marked public in Supabase Storage settings).
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${objectPath}`;
}

async function uploadToDisk(filename: string, bytes: Buffer, folder: string) {
  const dir = path.join(process.cwd(), 'public', 'uploads', folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return `/uploads/${folder}/${filename}`;
}

// POST a multipart 'file' → stored image, returns { url }.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const form = await req.formData();
    // 'logos' is for the school logo (settings); default 'students' for photos.
    const folder = form.get('folder') === 'logos' ? 'logos' : 'students';
    const requiredPerm = folder === 'logos' ? 'SETTINGS_MANAGE' : 'STUDENTS_MANAGE';
    if (!session || !can(session, requiredPerm)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 });

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const filename = `${randomUUID()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const url = useSupabase
      ? await uploadToSupabase(filename, bytes, file.type, folder)
      : await uploadToDisk(filename, bytes, folder);

    return NextResponse.json({ url });
  } catch (err) {
    console.error('upload POST', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
