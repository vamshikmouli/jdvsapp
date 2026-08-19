// READ-ONLY inspection of LKG data. No writes/deletes.
// Run with DATABASE_URL pointed at the target DB.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Identify the LKG class (by id 'lkg' or name containing LKG, excluding PKG/UKG)
  const classes = await prisma.schoolClass.findMany({ select: { id: true, name: true } });
  console.log('All classes:', classes.map((c) => `${c.id}=${c.name}`).join(', '));

  const lkg = classes.find((c) => c.id === 'lkg') ||
    classes.find((c) => /(^|[^u])lkg/i.test(c.name) && !/ukg|pkg/i.test(c.name));
  if (!lkg) {
    console.log('\n No LKG class found. Aborting inspection.');
    return;
  }
  console.log(`\nLKG class -> id="${lkg.id}", name="${lkg.name}"`);

  const students = await prisma.student.findMany({
    where: { classId: lkg.id },
    select: { id: true, name: true, guardianUserId: true, guardianPhone: true, status: true },
    orderBy: { name: 'asc' },
  });
  console.log(`\nLKG students: ${students.length}`);
  students.forEach((s) =>
    console.log(`  - ${s.id} | ${s.name} | guardianUserId=${s.guardianUserId || '(none)'} | ${s.guardianPhone || ''} | ${s.status}`)
  );

  // Distinct guardian user ids on LKG students
  const guardianIds = [...new Set(students.map((s) => s.guardianUserId).filter(Boolean))];
  console.log(`\nDistinct guardian User accounts linked to LKG students: ${guardianIds.length}`);

  // For each guardian, do they also guardian a NON-LKG student? (must NOT delete those users)
  let safeToDelete = 0, sharedKeep = 0;
  for (const gid of guardianIds) {
    const all = await prisma.student.findMany({
      where: { guardianUserId: gid },
      select: { id: true, name: true, classId: true },
    });
    const nonLkg = all.filter((s) => s.classId !== lkg.id);
    const u = await prisma.user.findUnique({ where: { id: gid }, select: { id: true, name: true, email: true, phone: true } });
    if (nonLkg.length > 0) {
      sharedKeep++;
      console.log(`  KEEP user ${u?.email || gid} (${u?.name}) — also guardian of non-LKG: ${nonLkg.map((s) => s.id + '/' + s.classId).join(', ')}`);
    } else {
      safeToDelete++;
      console.log(`  DELETE-OK user ${u?.email || gid} (${u?.name}) — only guardians LKG students`);
    }
  }

  console.log(`\nSUMMARY:`);
  console.log(`  LKG students to delete: ${students.length}`);
  console.log(`  Guardian Users only-LKG (safe to delete): ${safeToDelete}`);
  console.log(`  Guardian Users shared with other classes (KEEP, just unlink): ${sharedKeep}`);
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
