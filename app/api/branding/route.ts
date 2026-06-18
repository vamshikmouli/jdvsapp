import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/branding — public school name + logo for the login screen (no auth).
export async function GET() {
  try {
    const s = await prisma.settings.findUnique({
      where: { id: 'singleton' },
      select: { schoolName: true, logoUrl: true },
    });
    return NextResponse.json({ schoolName: s?.schoolName || 'Jnana Deepika', logoUrl: s?.logoUrl || null });
  } catch {
    return NextResponse.json({ schoolName: 'Jnana Deepika', logoUrl: null });
  }
}
