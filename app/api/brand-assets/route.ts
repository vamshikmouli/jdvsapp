import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/brand-assets
// Lists the school's downloadable logo/brand files (the public `brand/` folder
// in Supabase Storage) so parents, staff and admins can all download them.
// No auth: the files are already public assets. Anything dropped into the
// bucket's `brand/` folder shows up here automatically — no code change needed.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';
const FOLDER = 'brand';

// Friendlier display labels for the known files (falls back to the filename).
const LABELS: Record<string, string> = {
  'Jnana_Deepika_Logo.png': 'Logo — colour (PNG)',
  'Jnana_Deepika_Logo.jpg': 'Logo — colour (JPG)',
  'ScoolLogoJPEG.jpeg': 'Logo — colour (JPEG)',
  'Jnana_Deepika_Logo_HD.pdf': 'Logo — HD print (PDF)',
  'Jnana_Deepika_White_Logo_FullHD.pdf': 'Logo — white, HD (PDF)',
};

function publicUrl(name: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${FOLDER}/${encodeURIComponent(name)}`;
}

export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ assets: [], configured: false });
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${FOLDER}/`, limit: 100, sortBy: { column: 'name', order: 'asc' } }),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ assets: [], configured: true, error: `list failed (${res.status})` }, { status: 502 });
    const rows: any[] = await res.json();
    const assets = rows
      .filter((r) => r?.name && r.id !== null) // skip folder placeholders
      .map((r) => {
        const name: string = r.name;
        const url = publicUrl(name);
        return {
          name,
          label: LABELS[name] || name,
          mime: r.metadata?.mimetype || 'application/octet-stream',
          size: r.metadata?.size ?? null,
          url,
          downloadUrl: `${url}?download=${encodeURIComponent(name)}`,
        };
      });
    return NextResponse.json({ assets, configured: true });
  } catch {
    return NextResponse.json({ assets: [], configured: true, error: 'list error' }, { status: 502 });
  }
}
