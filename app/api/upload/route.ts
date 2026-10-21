import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

// Storage strategy:
//  - Set UPLOADS_TO_DISK=true to force local disk (/public/uploads/…) even when
//    Supabase env vars are present — used on the Oracle VM, which has a persistent
//    disk with plenty of free space (keeps photos local, no external dependency).
//  - Else if Supabase Storage is configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
//    upload there and return its public URL (needed on serverless hosts like Vercel
//    where the filesystem is ephemeral).
//  - Else fall back to writing under /public/uploads/students (local dev).
// Note: the Supabase keys stay set for DB backups + brand-assets — this flag only
// changes where student photos / logos are written.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';
const forceDisk = ['1', 'true', 'yes'].includes((process.env.UPLOADS_TO_DISK || '').toLowerCase());
const useSupabase = !forceDisk && Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

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

// Detect a raster image by its MAGIC BYTES (real file signature), not the
// client-declared Content-Type. Returns null for anything else — SVG, HTML,
// scripts, or a spoofed type — so those are rejected outright. This closes a
// stored-XSS vector: an SVG served from the public bucket would run its <script>.
function sniffImage(b: Buffer): { ext: string; mime: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { ext: 'gif', mime: 'image/gif' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', mime: 'image/webp' };
  return null;
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
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 });
    // Student photos: 50 KB – 1000 KB (the app's cropper saves within this range).
    if (folder === 'students' && (file.size < 50 * 1024 || file.size > 1000 * 1024)) {
      return NextResponse.json({ error: `Photo must be between 50 KB and 1000 KB (this one is ${Math.round(file.size / 1024)} KB).` }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Validate the ACTUAL content, not the client-declared type. Rejects SVG/HTML/
    // spoofed files (stored-XSS vector); ext + content-type come from the real bytes.
    const sniffed = sniffImage(bytes);
    if (!sniffed) return NextResponse.json({ error: 'Only JPEG, PNG, WebP or GIF images are allowed' }, { status: 400 });

    const filename = `${randomUUID()}.${sniffed.ext}`;

    const url = useSupabase
      ? await uploadToSupabase(filename, bytes, sniffed.mime, folder)
      : await uploadToDisk(filename, bytes, folder);

    return NextResponse.json({ url });
  } catch (err) {
    console.error('upload POST', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
