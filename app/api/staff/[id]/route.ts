import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { hashPassword } from '@/lib/auth/password';
import { normalizePhone, syntheticEmail } from '@/lib/auth/provision';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STAFF_MANAGE')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const existing = await prisma.staff.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });

    const body = await req.json();
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email || null;
    if (body.phone !== undefined) data.phone = normalizePhone(body.phone) || null;
    if (body.designation !== undefined) data.designation = body.designation || null;
    if (Array.isArray(body.classIds)) {
      data.classes = { set: body.classIds.map((id: string) => ({ id })) };
    }

    const updated = await prisma.staff.update({
      where: { id: params.id },
      data,
      include: { classes: { select: { id: true, name: true } } },
    });

    // Keep the linked login account in sync
    if (existing.userId) {
      const userData: any = {};
      if (body.name !== undefined) userData.name = body.name;
      if (body.phone !== undefined) userData.phone = normalizePhone(body.phone) || null;
      if (body.email !== undefined && body.email) userData.email = body.email.trim().toLowerCase();
      if (Object.keys(userData).length) {
        await prisma.user.update({ where: { id: existing.userId }, data: userData }).catch(() => {});
      }

      // Role change → update + force re-login of this staff member
      if (body.roleId) {
        const role = await prisma.role.findUnique({ where: { id: body.roleId } });
        if (role) {
          await prisma.$transaction([
            prisma.user.update({ where: { id: existing.userId }, data: { roleId: body.roleId } }),
            prisma.userSession.deleteMany({ where: { userId: existing.userId } }),
            prisma.loginAudit.create({
              data: { userId: existing.userId, type: 'ROLE_REASSIGNED', detail: `Reassigned to "${role.name}"` },
            }),
          ]);
        }
      }
    } else if (body.roleId) {
      // Staff member had NO login yet (e.g. imported before logins existed).
      // Assigning a role provisions a login now: password = phone number.
      const phone = normalizePhone(body.phone ?? existing.phone);
      const role = await prisma.role.findUnique({ where: { id: body.roleId } });
      if (!phone) {
        return NextResponse.json(
          { error: 'A phone number is required to create the login (it becomes the password).' },
          { status: 400 }
        );
      }
      if (role) {
        const email =
          (body.email?.trim().toLowerCase()) || existing.email?.toLowerCase() || syntheticEmail('staff', phone);
        const clash = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
        if (clash) {
          return NextResponse.json(
            { error: 'A user with this email or phone already exists.' },
            { status: 409 }
          );
        }
        const passwordHash = await hashPassword(phone);
        const user = await prisma.user.create({
          data: {
            name: body.name ?? existing.name,
            email,
            phone,
            roleId: body.roleId,
            passwordHash,
            isActive: true,
          },
        });
        await prisma.staff.update({ where: { id: params.id }, data: { userId: user.id } });
        return NextResponse.json({ ...updated, login: { email, password: phone } });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating staff:', error);
    return NextResponse.json({ error: 'Failed to update staff' }, { status: 500 });
  }
}

// "Delete" is a soft archive: mark archived + disable the login so the person
// can't sign in, without losing the record. Body { restore: true } reactivates.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STAFF_MANAGE')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const staff = await prisma.staff.findUnique({ where: { id: params.id } });
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });

    const restore = !!((await req.json().catch(() => ({})))?.restore);
    await prisma.$transaction([
      prisma.staff.update({ where: { id: params.id }, data: { archived: !restore } }),
      ...(staff.userId ? [prisma.user.update({ where: { id: staff.userId }, data: { isActive: restore } })] : []),
    ]);
    return NextResponse.json({ ok: true, archived: !restore });
  } catch (error) {
    console.error('Error archiving staff:', error);
    return NextResponse.json({ error: 'Failed to archive staff' }, { status: 500 });
  }
}
