import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';

async function getSettings() {
  return prisma.settings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
}

// GET — collection preferences + the fee heads available for the priority list.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const s = await getSettings();
    const heads = await prisma.feeType.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { key: true, name: true } });
    return NextResponse.json({
      collectDateMode: s.collectDateMode || 'today',
      collectDateFixed: s.collectDateFixed || null,
      feeAllocPriority: s.feeAllocPriority || [],
      heads,
    });
  } catch (err) {
    console.error('settings/collection GET', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

// PUT — save collection preferences (SETTINGS_MANAGE).
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'SETTINGS_MANAGE')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json();
    const data: any = {};
    if (b.collectDateMode !== undefined) {
      const m = String(b.collectDateMode);
      if (!['today', 'empty', 'fixed'].includes(m)) return NextResponse.json({ error: 'Invalid date mode' }, { status: 400 });
      data.collectDateMode = m;
    }
    if (b.collectDateFixed !== undefined) {
      const d = b.collectDateFixed ? String(b.collectDateFixed) : null;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
      data.collectDateFixed = d;
    }
    if (b.feeAllocPriority !== undefined) {
      if (!Array.isArray(b.feeAllocPriority)) return NextResponse.json({ error: 'feeAllocPriority must be an array' }, { status: 400 });
      data.feeAllocPriority = b.feeAllocPriority.map((k: any) => String(k));
    }
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('settings/collection PUT', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
