import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';
import { normalizePhone } from '@/lib/auth/provision';
import { ensureParentUser, pickPrimaryContact } from '@/lib/services/parents';
import { getActiveYear } from '@/lib/services/fees';
import { upsertEnrollment } from '@/lib/services/enrollment';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get('classId');
    const status = searchParams.get('status');
    const query = searchParams.get('q');

    const where: any = {};
    if (classId && classId !== 'all') where.classId = classId;
    if (status && status !== 'all') where.status = status;
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { id: { contains: query, mode: 'insensitive' } },
        { guardianName: { contains: query, mode: 'insensitive' } },
      ];
    }

    // Roster is driven by the selected year's ENROLLMENT, so a student's class
    // reflects the chosen academic year. Class filter + scope apply to the
    // enrollment; status/search apply to the student.
    const year = await getActiveYear();
    const enrWhere: any = { yearId: year.id };
    if (where.classId) enrWhere.classId = where.classId;

    const scope = await getClassScope(session);
    if (!scope.all) {
      if (enrWhere.classId) {
        if (!scope.classIds.includes(enrWhere.classId)) return NextResponse.json([]);
      } else {
        enrWhere.classId = { in: scope.classIds };
      }
    }

    const studentWhere: any = {};
    if (where.status) studentWhere.status = where.status;
    if (where.OR) studentWhere.OR = where.OR;
    if (Object.keys(studentWhere).length) enrWhere.student = studentWhere;

    const enrollments = await prisma.enrollment.findMany({
      where: enrWhere,
      orderBy: { student: { name: 'asc' } },
      include: { class: { select: { id: true, name: true } }, student: true },
    });

    const students = enrollments.map((e) => ({ ...e.student, classId: e.classId, class: e.class, roll: e.roll ?? e.student.roll }));
    return NextResponse.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json(
      { error: 'Failed to fetch students' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STUDENTS_MANAGE')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();

    // Primary contact (from SMS-for) drives the Parent login (keyed by phone → siblings share it)
    const primary = pickPrimaryContact(body);
    const guardianUserId = primary.phone ? await ensureParentUser(primary.name, primary.phone) : null;

    const student = await prisma.student.create({
      data: {
        id: body.id || `JD${Date.now()}`,
        name: body.name,
        classId: body.classId || null,
        roll: body.roll || null,
        gender: body.gender,
        dob: body.dob ? new Date(body.dob) : null,
        religion: body.religion || null,
        category: body.category || null,
        caste: body.caste || null,
        address: body.address || null,
        fatherName: body.fatherName || null,
        fatherPhone: body.fatherPhone || null,
        motherName: body.motherName || null,
        motherPhone: body.motherPhone || null,
        smsFor: body.smsFor || 'FATHER',
        photoUrl: body.photoUrl || null,
        guardianName: primary.name || '—',
        guardianPhone: primary.phone || '',
        guardianUserId: guardianUserId || undefined,
        village: body.village || null,
        status: 'ACTIVE',
      },
    });

    // Record the year's enrollment so the student appears in the selected year.
    if (student.classId) {
      const year = await getActiveYear();
      await upsertEnrollment(student.id, year.id, student.classId, student.sectionId, student.roll);
    }

    return NextResponse.json(
      {
        ...student,
        parentLogin: guardianUserId
          ? { phone: normalizePhone(primary.phone), password: normalizePhone(primary.phone) }
          : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating student:', error);
    return NextResponse.json(
      { error: 'Failed to create student' },
      { status: 500 }
    );
  }
}
