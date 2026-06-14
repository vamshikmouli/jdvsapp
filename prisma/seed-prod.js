/**
 * Production seed — minimal, NO demo students/staff.
 * Creates: 13 classes, active AcademicYear, Settings singleton,
 * the 4 system roles (full current permission set), and one admin login.
 * Run: DATABASE_URL=<session pooler> node prisma/seed-prod.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const ACTIVE_YEAR = '2026-27';

const CLASS_SEED = [
  { id: 'prekg', name: 'Pre-KG', order: 0, room: 'G-00', group: 'PRE' },
  { id: 'lkg', name: 'LKG', order: 1, room: 'G-01', group: 'PRE' },
  { id: 'ukg', name: 'UKG', order: 2, room: 'G-02', group: 'PRE' },
  { id: '1', name: '1st STD', order: 3, room: '101', group: 'PRIMARY' },
  { id: '2', name: '2nd STD', order: 4, room: '102', group: 'PRIMARY' },
  { id: '3', name: '3rd STD', order: 5, room: '103', group: 'PRIMARY' },
  { id: '4', name: '4th STD', order: 6, room: '104', group: 'PRIMARY' },
  { id: '5', name: '5th STD', order: 7, room: '105', group: 'PRIMARY' },
  { id: '6', name: '6th STD', order: 8, room: '201', group: 'SECONDARY' },
  { id: '7', name: '7th STD', order: 9, room: '202', group: 'SECONDARY' },
  { id: '8', name: '8th STD', order: 10, room: '203', group: 'SECONDARY' },
  { id: '9', name: '9th STD', order: 11, room: '204', group: 'SECONDARY' },
  { id: '10', name: '10th STD', order: 12, room: '205', group: 'SECONDARY' },
];

const ALL_PERMISSIONS = [
  'STUDENTS_VIEW', 'STUDENTS_MANAGE',
  'CLASSES_VIEW', 'CLASSES_MANAGE',
  'STAFF_VIEW', 'STAFF_MANAGE',
  'ATTENDANCE_VIEW', 'ATTENDANCE_MARK', 'ATTENDANCE_LOCK',
  'FEES_VIEW', 'FEES_COLLECT', 'FEES_RECEIPT', 'FEES_VIEW_ALL',
  'FEES_CONCESSION_APPROVE', 'FEES_VOID',
  'NOTICES_MANAGE',
  'MARKS_VIEW', 'MARKS_ENTER', 'MARKS_APPROVE', 'MARKS_SETUP',
  'ANALYTICS_VIEW', 'REPORTS_EXPORT',
  'SETTINGS_MANAGE', 'ROLES_MANAGE', 'USERS_MANAGE',
  'ALL_CLASSES_ACCESS',
];

const SYSTEM_ROLES = [
  { key: 'admin', name: 'Administrator', description: 'Full access to the entire system.', baseSurface: 'ADMIN', permissions: ALL_PERMISSIONS },
  { key: 'teacher', name: 'Teacher', description: 'Marks attendance and enters marks for assigned classes.', baseSurface: 'TEACHER', permissions: ['STUDENTS_VIEW', 'CLASSES_VIEW', 'ATTENDANCE_VIEW', 'ATTENDANCE_MARK', 'MARKS_VIEW', 'MARKS_ENTER'] },
  { key: 'accountant', name: 'Accountant', description: 'Manages fee collection and financial reports.', baseSurface: 'ACCOUNTANT', permissions: ['STUDENTS_VIEW', 'ATTENDANCE_VIEW', 'FEES_VIEW', 'FEES_COLLECT', 'FEES_RECEIPT', 'FEES_VIEW_ALL', 'ANALYTICS_VIEW', 'REPORTS_EXPORT', 'ALL_CLASSES_ACCESS'] },
  { key: 'parent', name: 'Parent', description: "Views their own child's attendance, fees and marks.", baseSurface: 'PARENT', permissions: ['ATTENDANCE_VIEW', 'FEES_VIEW', 'MARKS_VIEW'] },
];

async function main() {
  console.log('Seeding classes...');
  for (const c of CLASS_SEED) {
    await prisma.schoolClass.upsert({
      where: { id: c.id },
      update: { name: c.name, order: c.order, room: c.room, group: c.group },
      create: c,
    });
  }
  console.log(`  ✓ ${CLASS_SEED.length} classes`);

  console.log('Seeding active academic year...');
  await prisma.academicYear.upsert({
    where: { id: ACTIVE_YEAR },
    update: { label: ACTIVE_YEAR, isActive: true },
    create: { id: ACTIVE_YEAR, label: ACTIVE_YEAR, isActive: true },
  });
  // Ensure no other year is marked active.
  await prisma.academicYear.updateMany({ where: { id: { not: ACTIVE_YEAR } }, data: { isActive: false } });
  console.log(`  ✓ ${ACTIVE_YEAR} (active)`);

  console.log('Seeding settings...');
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    update: { academicYear: ACTIVE_YEAR },
    create: { id: 'singleton', schoolName: 'Jnana Deepika', academicYear: ACTIVE_YEAR },
  });
  console.log('  ✓ settings');

  console.log('Seeding roles...');
  const roleByKey = {};
  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, isSystem: true, baseSurface: def.baseSurface },
      create: { key: def.key, name: def.name, description: def.description, isSystem: true, baseSurface: def.baseSurface },
    });
    roleByKey[def.key] = role;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: def.permissions.map((p) => ({ roleId: role.id, permission: p })),
      skipDuplicates: true,
    });
    console.log(`  ✓ ${def.name} (${def.permissions.length} perms)`);
  }

  console.log('Seeding admin login...');
  const adminEmail = 'admin@jnanadeepika.edu';
  const adminPassword = 'Admin@123';
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: 'Administrator', roleId: roleByKey.admin.id, isActive: true },
    create: {
      email: adminEmail,
      name: 'Administrator',
      roleId: roleByKey.admin.id,
      passwordHash,
      passwordChangedAt: null,
      isActive: true,
    },
  });
  console.log(`  ✓ ${adminEmail} / ${adminPassword}  (CHANGE THIS after first login)`);

  console.log('\nProduction seed done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
