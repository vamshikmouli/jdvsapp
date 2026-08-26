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

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    // Shared staff fields — set whether or not the person gets an app login.
    const staffData: any = {
      name,
      email: rawEmail || null,
      phone: phone || null,
      designation: body.designation || null,
      bankAccountNo: body.bankAccountNo?.trim() || null,
      bankIfsc: body.bankIfsc?.trim().toUpperCase() || null,
      bankName: body.bankName?.trim() || null,
      accountHolderName: body.accountHolderName?.trim() || null,
      grossSalary: body.grossSalary === '' || body.grossSalary == null ? null : Math.max(0, Math.round(Number(body.grossSalary) || 0)),
      monthlyDeduction: Math.max(0, Math.round(Number(body.monthlyDeduction) || 0)),
      monthlyBonus: Math.max(0, Math.round(Number(body.monthlyBonus) || 0)),
      pfApplicable: !!body.pfApplicable,
      pfWage: body.pfWage === '' || body.pfWage == null ? null : Math.max(0, Math.round(Number(body.pfWage) || 0)),
      esiApplicable: !!body.esiApplicable,
      attendanceTracked: body.attendanceTracked === undefined ? true : !!body.attendanceTracked,
      classes: body.classIds?.length ? { connect: body.classIds.map((id: string) => ({ id })) } : undefined,
    };

    // No role selected → login-less staff (e.g. a driver who never uses the app).
    if (!roleId) {
      const staff = await prisma.staff.create({ data: staffData, include: { classes: { select: { id: true, name: true } } } });
      return NextResponse.json({ ...staff, login: null }, { status: 201 });
    }

    // With a role → provision a login. Phone is the initial password + identifier.
    if (!phone) return NextResponse.json({ error: 'Phone is required to create a login (or leave the role blank for a no-login staff member)' }, { status: 400 });
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    const email = rawEmail || syntheticEmail('staff', phone);
    const clash = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (clash) return NextResponse.json({ error: 'A user with this email or phone already exists' }, { status: 409 });
    const passwordHash = await hashPassword(phone); // initial password = phone number

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, phone, roleId, passwordHash, isActive: true } });
      return tx.staff.create({ data: { ...staffData, userId: user.id }, include: { classes: { select: { id: true, name: true } } } });
    });

    return NextResponse.json({ ...created, login: { email, password: phone } }, { status: 201 });
  } catch (error) {
    console.error('Error creating staff:', error);
    return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
  }
}
