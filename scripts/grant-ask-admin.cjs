/* One-off (idempotent): grant the new ASK_ACCESS permission to the Administrator
   system role only. Every other role starts without it; admins can grant it from
   Roles & access. Run after `prisma db push` adds the enum value:
     node scripts/grant-ask-admin.cjs
   Admins see Ask after their next sign-in (permissions are read at login). */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  const role = await prisma.role.findUnique({ where: { key: 'admin' }, select: { id: true, name: true } });
  if (!role) throw new Error('Administrator role (key "admin") not found');
  await prisma.rolePermission.upsert({
    where: { roleId_permission: { roleId: role.id, permission: 'ASK_ACCESS' } },
    update: {},
    create: { roleId: role.id, permission: 'ASK_ACCESS' },
  });
  const holders = await prisma.rolePermission.findMany({
    where: { permission: 'ASK_ACCESS' },
    select: { role: { select: { name: true } } },
  });
  console.log('ASK_ACCESS held by:', holders.map((h) => h.role.name).join(', '));
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
