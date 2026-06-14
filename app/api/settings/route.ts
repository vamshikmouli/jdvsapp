import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { parseSessions, normalizeSessions } from '@/lib/attendance/sessions';

const SINGLETON = 'singleton';

// Fields admins may update (school-wide)
const EDITABLE = [
  'schoolName',
  'principalName',
  'address',
  'phone',
  'email',
  'academicYear',
  'currency',
  'timezone',
  'dateFormat',
  'morningOpen',
  'morningClose',
  'afternoonOpen',
  'afternoonClose',
  'autoLock',
  'notifyAbsence',
] as const;

async function getOrCreateSettings() {
  return prisma.settings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON },
  });
}

// GET /api/settings — any authenticated user can read settings
export async function GET() {
  try {
    await requireSession();
    const settings = await getOrCreateSettings();
    // Always hand back a concrete sessions list (defaults applied if unset)
    return NextResponse.json({ ...settings, sessions: parseSessions(settings.sessions) });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

// PATCH /api/settings — requires SETTINGS_MANAGE
export async function PATCH(req: NextRequest) {
  try {
    await requirePermission('SETTINGS_MANAGE');
    await getOrCreateSettings(); // ensure row exists
    const body = await req.json();

    const data: Record<string, any> = {};
    for (const key of EDITABLE) {
      if (body[key] !== undefined) {
        if (key === 'autoLock' || key === 'notifyAbsence') {
          data[key] = !!body[key];
        } else {
          const v = typeof body[key] === 'string' ? body[key].trim() : body[key];
          // schoolName/academicYear/currency are required (non-null) — skip blanks
          data[key] = v === '' && ['schoolName', 'academicYear', 'currency'].includes(key) ? undefined : v || null;
        }
      }
    }

    // Configurable sessions (validated + normalized)
    if (body.sessions !== undefined) {
      data.sessions = normalizeSessions(body.sessions);
    }

    const updated = await prisma.settings.update({ where: { id: SINGLETON }, data });
    return NextResponse.json({ ...updated, sessions: parseSessions(updated.sessions) });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
