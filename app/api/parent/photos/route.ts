import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';

// GET /api/parent/photos — school photo gallery, grouped by album.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const photos = await prisma.photo.findMany({
      orderBy: [{ takenAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    // group into albums preserving order
    const order: string[] = [];
    const groups: Record<string, { id: string; url: string; caption: string | null }[]> = {};
    for (const p of photos) {
      const album = p.album || 'Photos';
      if (!groups[album]) { groups[album] = []; order.push(album); }
      groups[album].push({ id: p.id, url: p.url, caption: p.caption });
    }
    return NextResponse.json({ albums: order.map((name) => ({ name, photos: groups[name] })) });
  } catch (err) {
    console.error('parent photos error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
