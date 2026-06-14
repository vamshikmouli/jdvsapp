import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { hashPassword } from '@/lib/auth/password';
import { normalizePhone, syntheticEmail } from '@/lib/auth/provision';

function parseDate(v: string): Date | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Map a designation to a login role key, or null for data-only (no login).
function roleKeyFor(designation: string): string | null {
  const d = String(designation || '').toLowerCase();
  if (d.includes('teacher')) return 'teacher';
  if (d.includes('account')) return 'accountant';
  if (d.includes('admin') || d.includes('principal')) return 'admin';
  return null; // Office Staff, Driver, etc.
}

interface StaffRow {
  name?: string; designation?: string; phone?: string; email?: string;
  dob?: string; joiningDate?: string; serviceJoiningDate?: string;
  durationEmployment?: string; subjectSpecialization?: string; experience?: string;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STAFF_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const rows: StaffRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    if (rows.length > 2000) return NextResponse.json({ error: 'Too many rows (max 2000)' }, { status: 400 });

    const roles = await prisma.role.findMany({ select: { id: true, key: true } });
    const roleId: Record<string, string> = Object.fromEntries(roles.map((r) => [r.key, r.id]));

    // Existing user phones (so we don't double-create a login).
    const phones = rows.map((r) => normalizePhone(r.phone)).filter(Boolean);
    const existing = phones.length ? await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true, phone: true } }) : [];
    const userByPhone: Record<string, string> = {};
    for (const u of existing) if (u.phone) userByPhone[u.phone] = u.id;
    const existingPhones = new Set(Object.keys(userByPhone));

    // ---- Phase 1: validate all ----
    const errors: { row: number; name: string; reason: string }[] = [];
    const prepared: any[] = [];
    const seenLoginPhones = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2;
      const name = String(r.name || '').trim();
      if (!name) { errors.push({ row: rowNo, name: '(no name)', reason: 'Missing name' }); continue; }

      const designation = String(r.designation || '').trim();
      const phone = normalizePhone(r.phone);
      const rk = roleKeyFor(designation);
      const phoneTaken = !!(phone && existingPhones.has(phone));   // already a user (e.g. parent)
      const createLogin = !!(rk && phone && !phoneTaken);

      if (createLogin) {
        if (!roleId[rk!]) { errors.push({ row: rowNo, name, reason: `No "${rk}" role configured` }); continue; }
        if (seenLoginPhones.has(phone)) { errors.push({ row: rowNo, name, reason: `Duplicate phone ${phone} within this file` }); continue; }
        seenLoginPhones.add(phone);
      }

      prepared.push({
        name, designation: designation || null, phone: phone || null,
        email: String(r.email || '').trim().toLowerCase() || null,
        dob: parseDate(r.dob || ''),
        joiningDate: parseDate(r.joiningDate || ''),
        serviceJoiningDate: parseDate(r.serviceJoiningDate || ''),
        durationEmployment: String(r.durationEmployment || '').trim() || null,
        subjectSpecialization: String(r.subjectSpecialization || '').trim() || null,
        experience: String(r.experience || '').trim() || null,
        loginRoleKey: createLogin ? rk : null,
        existingUserId: phoneTaken ? userByPhone[phone] : null,
        staffRoleKey: rk, // role the designation maps to (null for Office Staff/Driver)
      });
    }

    if (errors.length > 0) {
      return NextResponse.json({ ok: false, total: rows.length, created: 0, logins: 0, failed: errors.length, errors: errors.slice(0, 300) });
    }

    // ---- Phase 2: create all ----
    let created = 0;
    let logins = 0;   // new login accounts
    let merged = 0;   // existing parent upgraded to staff role → dual (staff + parent)
    let usedExisting = 0; // existing account kept as-is (no staff role to grant)
    for (const p of prepared) {
      let linkUserId: string | undefined;

      if (p.loginRoleKey && p.phone) {
        // Fresh phone → brand-new staff login.
        const passwordHash = await hashPassword(p.phone); // initial password = phone
        const user = await prisma.user.create({
          data: { name: p.name, email: p.email || syntheticEmail('staff', p.phone), phone: p.phone, roleId: roleId[p.loginRoleKey], passwordHash, isActive: true },
        });
        linkUserId = user.id;
        logins++;
      } else if (p.existingUserId) {
        // Phone already has an account (e.g. a parent of a student).
        if (p.staffRoleKey && roleId[p.staffRoleKey]) {
          // Upgrade them to the staff role — keeps their children → DUAL staff + parent.
          await prisma.user.update({ where: { id: p.existingUserId }, data: { roleId: roleId[p.staffRoleKey] } });
          await prisma.userSession.deleteMany({ where: { userId: p.existingUserId } }); // force re-login with new role
          merged++;
        } else {
          usedExisting++; // Office Staff / Driver — no staff role to grant; keep their parent login
        }
        // Link the staff record to that account if it has none yet.
        const hasStaff = await prisma.staff.findFirst({ where: { userId: p.existingUserId }, select: { id: true } });
        if (!hasStaff) linkUserId = p.existingUserId;
      }

      await prisma.staff.create({
        data: {
          name: p.name, email: p.email, phone: p.phone, designation: p.designation,
          dob: p.dob, joiningDate: p.joiningDate, serviceJoiningDate: p.serviceJoiningDate,
          durationEmployment: p.durationEmployment, subjectSpecialization: p.subjectSpecialization, experience: p.experience,
          userId: linkUserId || undefined,
        },
      });
      created++;
    }

    return NextResponse.json({ ok: true, total: rows.length, created, logins, merged, usedExisting, failed: 0, errors: [] });
  } catch (err) {
    console.error('staff/import POST', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
