import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { pickPrimaryContact } from '@/lib/services/parents';
import { getActiveYear } from '@/lib/services/fees';
import { upsertEnrollment } from '@/lib/services/enrollment';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const student = await prisma.student.findUnique({
      where: { id: params.id },
      include: { class: { select: { id: true, name: true } } },
    });
    if (!student) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(student);
  } catch (error) {
    console.error('Error fetching student:', error);
    return NextResponse.json({ error: 'Failed to fetch student' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STUDENTS_MANAGE')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json();
    const primary = pickPrimaryContact(body);
    const updated = await prisma.student.update({
      where: { id: params.id },
      data: {
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
        village: body.village || null,
        status: body.status,
      },
      include: { class: { select: { id: true, name: true } } },
    });

    // Keep the selected year's enrollment in sync with the edited class.
    if (updated.classId) {
      const year = await getActiveYear();
      await upsertEnrollment(updated.id, year.id, updated.classId, updated.sectionId, updated.roll);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating student:', error);
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 });
  }
}

// "Delete" is a soft archive: mark INACTIVE so the record is hidden everywhere
// (rosters, fees, marks, counts all filter status: ACTIVE) but never lost.
// Body { restore: true } reactivates instead.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'STUDENTS_MANAGE')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const status = body?.restore ? 'ACTIVE' : 'INACTIVE';
    await prisma.student.update({ where: { id: params.id }, data: { status } });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error('Error deleting student:', error);
    return NextResponse.json({ error: 'Failed to delete student' }, { status: 500 });
  }
}
