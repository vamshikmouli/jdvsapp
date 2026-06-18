/**
 * One-off: grant the new staff-attendance + leave permissions to the built-in
 * roles. Additive only (createMany skipDuplicates) — never strips existing perms.
 * Run with DATABASE_URL/DIRECT_URL set in the environment.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const GRANTS = {
  admin: ['STAFF_ATTENDANCE_MARK', 'STAFF_ATTENDANCE_VIEW', 'STAFF_ATTENDANCE_MANAGE', 'STAFF_ATTENDANCE_CONFIG', 'LEAVE_APPROVE'],
  teacher: ['STAFF_ATTENDANCE_MARK'],
  accountant: ['STAFF_ATTENDANCE_MARK'],
};

async function main() {
  for (const [key, perms] of Object.entries(GRANTS)) {
    const role = await prisma.role.findUnique({ where: { key } });
    if (!role) { console.log(`  - role "${key}" not found, skipping`); continue; }
    const res = await prisma.rolePermission.createMany({
      data: perms.map((permission) => ({ roleId: role.id, permission })),
      skipDuplicates: true,
    });
    console.log(`  ✓ ${key}: +${res.count} new (of ${perms.length} requested)`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
