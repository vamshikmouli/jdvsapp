import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

const GRAPH = 'https://graph.facebook.com/v21.0';

// GET /api/whatsapp/media/:id
// Streams a WhatsApp inbound media file (an image a parent sent) to the office
// inbox. Meta media URLs require the access token and expire quickly, so we fetch
// them server-side on demand rather than storing the file or exposing the token.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'NOTICES_MANAGE')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = String(params.id || '');
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Bad media id' }, { status: 400 });

  const token = process.env.WHATSAPP_TOKEN;
  if (!token) return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 503 });

  try {
    // 1) Resolve the media id to a short-lived, token-gated download URL.
    const metaRes = await fetch(`${GRAPH}/${id}?access_token=${token}`);
    if (!metaRes.ok) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    const meta = await metaRes.json();
    if (!meta.url) return NextResponse.json({ error: 'Media not found' }, { status: 404 });

    // 2) Download the bytes (this URL needs the Bearer token too).
    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileRes.ok) return NextResponse.json({ error: 'Media fetch failed' }, { status: 502 });

    const buf = await fileRes.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': meta.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream',
        // The media itself never changes for a given id; cache in the browser.
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    console.error('whatsapp/media GET', err);
    return NextResponse.json({ error: 'Media fetch failed' }, { status: 500 });
  }
}
