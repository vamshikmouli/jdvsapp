import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { parseCustomFieldDefs } from '@/lib/customFields';

// Custom student-field DEFINITIONS (not per-student values). Any signed-in staff
// can read them (the form needs them); only SETTINGS_MANAGE can change them.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { studentCustomFields: true } });
  return NextResponse.json({ fields: parseCustomFieldDefs(s?.studentCustomFields) });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !can(session, 'SETTINGS_MANAGE')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const fields = parseCustomFieldDefs(body?.fields);
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    update: { studentCustomFields: fields as any },
    create: { id: 'singleton', studentCustomFields: fields as any },
  });
  return NextResponse.json({ fields });
}
