/**
 * Seed system roles + default users.
 * Run: node prisma/seed-roles.js  (DATABASE_URL must be set)
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const ALL_PERMISSIONS = [
  'STUDENTS_VIEW', 'STUDENTS_MANAGE',
  'CLASSES_VIEW', 'CLASSES_MANAGE',
  'STAFF_VIEW', 'STAFF_MANAGE',
  'ATTENDANCE_VIEW', 'ATTENDANCE_MARK', 'ATTENDANCE_LOCK',
  'FEES_VIEW', 'FEES_COLLECT', 'FEES_RECEIPT', 'FEES_VIEW_ALL',
  'ANALYTICS_VIEW', 'REPORTS_EXPORT',
  'SETTINGS_MANAGE', 'ROLES_MANAGE', 'USERS_MANAGE',
  'ALL_CLASSES_ACCESS',
];

const SYSTEM_ROLES = [
  { key: 'admin', name: 'Administrator', description: 'Full access to the entire system.', baseSurface: 'ADMIN', permissions: ALL_PERMISSIONS },
  { key: 'teacher', name: 'Teacher', description: 'Marks attendance for assigned classes.', baseSurface: 'TEACHER', permissions: ['STUDENTS_VIEW', 'CLASSES_VIEW', 'ATTENDANCE_VIEW', 'ATTENDANCE_MARK'] },
  { key: 'accountant', name: 'Accountant', description: 'Manages fee collection and financial reports.', baseSurface: 'ACCOUNTANT', permissions: ['STUDENTS_VIEW', 'ATTENDANCE_VIEW', 'FEES_VIEW', 'FEES_COLLECT', 'FEES_RECEIPT', 'FEES_VIEW_ALL', 'ANALYTICS_VIEW', 'REPORTS_EXPORT', 'ALL_CLASSES_ACCESS'] },
  { key: 'parent', name: 'Parent', description: "Views their own child's attendance and fees.", baseSurface: 'PARENT', permissions: ['ATTENDANCE_VIEW', 'FEES_VIEW'] },
];

const DEFAULT_USERS = [
  { email: 'admin@jnanadeepika.edu', name: 'Meera Iyer', roleKey: 'admin', password: 'Admin@123' },
  { email: 'teacher@jnanadeepika.edu', name: 'Priya Nair', roleKey: 'teacher', password: 'Teacher@123' },
  { email: 'accountant@jnanadeepika.edu', name: 'Vikram Rao', roleKey: 'accountant', password: 'Account@123' },
  { email: 'parent@jnanadeepika.edu', name: 'Lakshmi Devi', roleKey: 'parent', password: 'Parent@123' },
];

async function main() {
  console.log('Seeding system roles...');
  const roleByKey = {};

  for (const def of SYSTEM_ROLES) {
    // Upsert the role
    const role = await prisma.role.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, isSystem: true, baseSurface: def.baseSurface },
      create: { key: def.key, name: def.name, description: def.description, isSystem: true, baseSurface: def.baseSurface },
    });
    roleByKey[def.key] = role;

    // Reset permissions to the canonical set
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: def.permissions.map((p) => ({ roleId: role.id, permission: p })),
      skipDuplicates: true,
    });
    console.log(`  ✓ ${def.name} (${def.permissions.length} permissions)`);
  }

  console.log('\nSeeding default users...');
  for (const u of DEFAULT_USERS) {
    const role = roleByKey[u.roleKey];
    const passwordHash = await bcrypt.hash(u.password, 12);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, roleId: role.id, isActive: true },
      create: {
        email: u.email,
        name: u.name,
        roleId: role.id,
        passwordHash,
        passwordChangedAt: new Date(),
        isActive: true,
      },
    });
    console.log(`  ✓ ${u.email} / ${u.password} (${u.roleKey})`);
  }

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
