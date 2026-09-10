import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

// Section lock — a password gate for sensitive menus (configured in Settings).
//  GET  → { lockedMenus, hasPassword }         (any signed-in user; the nav needs it)
//  PUT  → set { lockedMenus?, password?, clearPassword? }   (SETTINGS_MANAGE)
//  POST → verify { password } → { ok }          (any signed-in user)
const SINGLETON = 'singleton';

async function getSettings() {
  return prisma.settings.upsert({ where: { id: SINGLETON }, update: {}, create: { id: SINGLETON } }) as any;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const s = await getSettings();
  return NextResponse.json({ lockedMenus: s.lockedMenus || [], hasPassword: !!s.sectionPasswordHash });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'SETTINGS_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (Array.isArray(body.lockedMenus)) data.lockedMenus = body.lockedMenus.map((x: any) => String(x)).slice(0, 50);
  if (body.clearPassword) {
    data.sectionPasswordHash = null;
  } else if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 4) return NextResponse.json({ error: 'Password must be at least 4 characters.' }, { status: 400 });
    data.sectionPasswordHash = await hashPassword(body.password);
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  await prisma.settings.upsert({ where: { id: SINGLETON }, update: data, create: { id: SINGLETON, ...data } });
  const s = await getSettings();
  return NextResponse.json({ ok: true, lockedMenus: s.lockedMenus || [], hasPassword: !!s.sectionPasswordHash });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { password } = await req.json().catch(() => ({}));
  const s = await getSettings();
  if (!s.sectionPasswordHash) return NextResponse.json({ ok: true }); // no gate set → allow
  const ok = await verifyPassword(String(password || ''), s.sectionPasswordHash);
  return NextResponse.json({ ok });
}
