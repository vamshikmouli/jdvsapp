import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { hashPassword } from '@/lib/auth/password';
import { normalizePhone, syntheticEmail } from '@/lib/auth/provision';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Archived staff are hidden unless explicitly requested (?archived=1).
    const showArchived = new URL(req.url).searchParams.get('archived') === '1';
    const staff = await prisma.staff.findMany({
      where: showArchived ? { archived: true } : { archived: false },
      orderBy: { name: 'asc' },
      include: {
        classes: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, roleId: true, role: { select: { name: true } } } },
      },
    });

    return NextResponse.json(
      staff.map((s) => ({
        ...s,
        hasLogin: !!s.userId,
        roleName: s.user?.role?.name || null,
        roleId: s.user?.roleId || null,
      }))
    );
  } catch (error) {
    console.error('Error fetching staff:', error);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STAFF_MANAGE')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const name = (body.name || '').trim();
    const phone = normalizePhone(body.phone);
    const roleId = body.roleId as string;
    const rawEmail = (body.email || '').trim().toLowerCase();

    // Every staff member gets a login. Phone is required (it's their password
    // and a login identifier); a role is required (it grants access).
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!phone) return NextResponse.json({ error: 'Phone number is required (used as the initial password)' }, { status: 400 });
    if (!roleId) return NextResponse.json({ error: 'A login role is required' }, { status: 400 });

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

    const email = rawEmail || syntheticEmail('staff', phone);

    // Reject duplicates so login stays unambiguous
    const clash = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (clash) {
      return NextResponse.json(
        { error: 'A user with this email or phone already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(phone); // initial password = phone number

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          phone,
          roleId,
          passwordHash,
          isActive: true,
          // passwordChangedAt left null → "must change" indicator for later
        },
      });
      return tx.staff.create({
        data: {
          name,
          email: rawEmail || null,
          phone,
          designation: body.designation || null,
          userId: user.id,
          classes: body.classIds?.length
            ? { connect: body.classIds.map((id: string) => ({ id })) }
            : undefined,
        },
        include: { classes: { select: { id: true, name: true } } },
      });
    });

    return NextResponse.json(
      { ...created, login: { email, password: phone } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating staff:', error);
    return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
  }
}
