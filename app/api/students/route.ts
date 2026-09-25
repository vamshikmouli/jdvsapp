import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can, getClassScope } from '@/lib/rbac/roles';
import { normalizePhone } from '@/lib/auth/provision';
import { ensureParentUser, pickPrimaryContact } from '@/lib/services/parents';
import { normalizeContactTargets } from '@/lib/contactTargets';
import { getActiveYear, autoAssignClassFees } from '@/lib/services/fees';
import { upsertEnrollment } from '@/lib/services/enrollment';
import { generateAdmissionNo } from '@/lib/services/admissionNo';
import { logActivity } from '@/lib/activity';

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
        { admissionNo: { contains: query, mode: 'insensitive' } },
        { guardianName: { contains: query, mode: 'insensitive' } },
        { fatherName: { contains: query, mode: 'insensitive' } },
        { motherName: { contains: query, mode: 'insensitive' } },
        { guardianPhone: { contains: query, mode: 'insensitive' } },
        { fatherPhone: { contains: query, mode: 'insensitive' } },
        { motherPhone: { contains: query, mode: 'insensitive' } },
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
    if (!session || !can(session, 'STUDENTS_CREATE')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const year = await getActiveYear();

    // ---- Mandatory fields (also checked client-side; this is the trust boundary) ----
    if (!body.classId) return NextResponse.json({ error: 'Class is required', field: 'classId' }, { status: 400 });
    if (!String(body.name || '').trim()) return NextResponse.json({ error: 'Full name is required', field: 'name' }, { status: 400 });
    if (body.gender !== 'M' && body.gender !== 'F') return NextResponse.json({ error: 'Gender is required', field: 'gender' }, { status: 400 });
    const hasContact =
      (String(body.fatherName || '').trim() && String(body.fatherPhone || '').trim()) ||
      (String(body.motherName || '').trim() && String(body.motherPhone || '').trim()) ||
      (String(body.altGuardianName || '').trim() && String(body.altGuardianPhone || '').trim());
    if (!hasContact) return NextResponse.json({ error: 'Enter at least one contact (father, mother or guardian) with both a name and a phone number', field: 'contact' }, { status: 400 });

    // Roll auto-assigns from the class when not given — staff needn't remember it.
    let roll = String(body.roll ?? '').replace(/\D/g, '');
    if (!roll) {
      const rows = await prisma.student.findMany({ where: { classId: body.classId, status: 'ACTIVE' }, select: { roll: true } });
      let max = 0;
      for (const r of rows) { const n = parseInt(String(r.roll || '').replace(/\D/g, ''), 10); if (Number.isFinite(n) && n > max) max = n; }
      roll = String(max + 1).padStart(2, '0');
    }

    // System student ID: JDVS+YY+CC+RR — always structured, never a timestamp.
    // NOT the same as "Admission No." (the handwritten register number, stored below).
    let studentId = String(body.id || '').trim();
    if (!studentId) {
      const generated = await generateAdmissionNo({ classId: body.classId, roll, yearId: year.id });
      if (!generated) return NextResponse.json({ error: 'Could not generate a student ID — please check the class and roll number.' }, { status: 400 });
      studentId = generated;
    }

    // Names are stored in uppercase (student + parents).
    body.name = String(body.name || '').trim().toUpperCase();
    if (body.fatherName) body.fatherName = String(body.fatherName).trim().toUpperCase();
    if (body.motherName) body.motherName = String(body.motherName).trim().toUpperCase();
    if (body.altGuardianName) body.altGuardianName = String(body.altGuardianName).trim().toUpperCase();
    if (body.guardianName) body.guardianName = String(body.guardianName).trim().toUpperCase();
    body.smsFor = normalizeContactTargets(body.smsFor);

    // Primary contact (from SMS-for) drives the Parent login (keyed by phone → siblings share it)
    const primary = pickPrimaryContact(body);
    const guardianUserId = primary.phone ? await ensureParentUser(primary.name, primary.phone) : null;

    // Provision a login for EACH contact that has a name + phone (deduped by phone).
    // The child is linked to the primary via guardianUserId; the other logins exist
    // for later linking.
    for (const c of [
      { name: body.fatherName, phone: body.fatherPhone },
      { name: body.motherName, phone: body.motherPhone },
      { name: body.altGuardianName, phone: body.altGuardianPhone },
    ]) {
      const nm = String(c.name || '').trim();
      const ph = String(c.phone || '').trim();
      if (nm && ph) { try { await ensureParentUser(nm, ph); } catch (e) { console.error('ensureParentUser (contact)', e); } }
    }

    const student = await prisma.student.create({
      data: {
        id: studentId,
        admissionNo: body.admissionNo || null,
        name: body.name,
        classId: body.classId || null,
        roll: roll || null,
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
        smsFor: body.smsFor,
        altGuardianName: body.altGuardianName || null,
        altGuardianPhone: body.altGuardianPhone || null,
        photoUrl: body.photoUrl || null,
        guardianName: primary.name || '—',
        guardianPhone: primary.phone || '',
        guardianUserId: guardianUserId || undefined,
        village: body.village || null,
        taluk: body.taluk || null,
        district: body.district || null,
        placeOfBirth: body.placeOfBirth || null,
        motherTongue: body.motherTongue || null,
        aadharNumber: body.aadharNumber || null,
        previousSchool: body.previousSchool || null,
        annualIncome: body.annualIncome != null && body.annualIncome !== '' ? Number(body.annualIncome) : null,
        noOfDependents: body.noOfDependents != null && body.noOfDependents !== '' ? Number(body.noOfDependents) : null,
        joinedDate: body.joinedDate ? new Date(body.joinedDate) : null,
        status: 'ACTIVE',
        tcNo: body.tcNo || null,
        tcDate: body.tcDate ? new Date(body.tcDate) : null,
        schoolLeavingDate: body.schoolLeavingDate ? new Date(body.schoolLeavingDate) : null,
        studyFromYear: body.studyFromYear || null,
        studyToYear: body.studyToYear || null,
        studyFromStandard: body.studyFromStandard || null,
        studyToStandard: body.studyToStandard || null,
        customFields: (body.customFields && typeof body.customFields === 'object') ? body.customFields : undefined,
      },
    });

    // Record the year's enrollment so the student appears in the selected year,
    // and auto-assign the class fees (Tuition, etc.) — same as the Excel import.
    if (student.classId) {
      await upsertEnrollment(student.id, year.id, student.classId, student.sectionId, student.roll);
      try { await autoAssignClassFees(student.id, student.classId, year.id); } catch (e) { console.error('auto-assign failed for', student.id, e); }
    }

    void logActivity(session, { category: 'STUDENTS', action: 'STUDENT_CREATED', entityType: 'Student', entityId: student.id, summary: `Added student ${student.name} (${student.id})`, req });

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
