/**
 * Provision a login for an existing login-less staff member.
 * Usage: node scripts/provisionStaffLogin.js "<staff name or phone>" "<role key>"
 * Password = staff phone number. Logs in by phone or email.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

function normalizePhone(p) {
  if (!p) return '';
  const t = p.trim();
  return (t.startsWith('+') ? '+' : '') + t.replace(/[^\d]/g, '');
}

async function main() {
  const query = process.argv[2];
  const roleKey = process.argv[3];
  if (!query || !roleKey) {
    console.error('Usage: node scripts/provisionStaffLogin.js "<name or phone>" "<role key>"');
    process.exit(1);
  }

  const staff = await prisma.staff.findFirst({
    where: { OR: [{ name: { contains: query, mode: 'insensitive' } }, { phone: { contains: query } }] },
  });
  if (!staff) { console.error('Staff not found:', query); process.exit(1); }
  if (staff.userId) { console.error('Staff already has a login (userId set).'); process.exit(1); }

  const role = await prisma.role.findUnique({ where: { key: roleKey } });
  if (!role) { console.error('Role not found:', roleKey); process.exit(1); }

  const phone = normalizePhone(staff.phone);
  if (!phone) { console.error('Staff has no phone — cannot set password.'); process.exit(1); }

  const email = (staff.email || `staff_${phone.replace('+', '')}@jnanadeepika.local`).toLowerCase();
  const clash = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (clash) { console.error('A user with this email/phone already exists.'); process.exit(1); }

  const passwordHash = await bcrypt.hash(phone, 12);
  const user = await prisma.user.create({
    data: { name: staff.name, email, phone, roleId: role.id, passwordHash, isActive: true },
  });
  await prisma.staff.update({ where: { id: staff.id }, data: { userId: user.id } });

  console.log('✓ Login created:');
  console.log(`  Staff:    ${staff.name}`);
  console.log(`  Role:     ${role.name} (surface ${role.baseSurface})`);
  console.log(`  Login id: ${phone}  (or ${email})`);
  console.log(`  Password: ${phone}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
