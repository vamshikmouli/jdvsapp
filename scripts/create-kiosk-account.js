/**
 * Create a dedicated, limited "Kiosk" role + login for hosting the attendance
 * kiosk on a shared tablet. The role has ONLY staff-attendance view/manage —
 * no students, fees, settings, roles. Run with DATABASE_URL set.
 * Prints the generated password once.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();
const EMAIL = 'kiosk@jnanadeepika.edu';
const PERMS = ['STAFF_ATTENDANCE_VIEW', 'STAFF_ATTENDANCE_MANAGE'];

async function main() {
  // 1) Limited role
  const role = await prisma.role.upsert({
    where: { key: 'kiosk' },
    update: { name: 'Kiosk Device', description: 'Hosts the attendance kiosk only.', baseSurface: 'ADMIN', isActive: true },
    create: { key: 'kiosk', name: 'Kiosk Device', description: 'Hosts the attendance kiosk only.', baseSurface: 'ADMIN', isSystem: false, isActive: true },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: PERMS.map((permission) => ({ roleId: role.id, permission })),
    skipDuplicates: true,
  });

  // 2) Account with a generated password (passwordChangedAt set → skips forced PIN)
  const password = 'Kiosk-' + crypto.randomBytes(4).toString('hex'); // e.g. Kiosk-9f3a1c20
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  await prisma.user.upsert({
    where: { email: EMAIL },
    update: { roleId: role.id, isActive: true, passwordHash, passwordChangedAt: new Date(), lockedUntil: null, loginAttempts: 0 },
    create: { email: EMAIL, name: 'Attendance Kiosk', roleId: role.id, isActive: true, passwordHash, passwordChangedAt: new Date() },
  });

  console.log('\n  ✅ Kiosk account ready');
  console.log('  ───────────────────────────────');
  console.log('  Login : ' + EMAIL);
  console.log('  Password : ' + password + (existing ? '   (reset)' : '   (new)'));
  console.log('  Open on the tablet: /admin/staff-attendance/kiosk');
  console.log('  ───────────────────────────────\n');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
