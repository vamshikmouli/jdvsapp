import { prisma } from '@/lib/db';

async function backfillStreaks() {
  console.log('Backfilling attendance streaks from June 1, 2026...');

  const startDate = new Date('2026-06-01T00:00:00Z');

  // Get all staff
  const staff = await prisma.staff.findMany({
    select: { id: true, name: true },
  });

  console.log(`Processing ${staff.length} staff members...`);

  for (const s of staff) {
    // Get all attendance days for this staff from June 1st onwards, in order
    const days = await prisma.staffAttendanceDay.findMany({
      where: {
        staffId: s.id,
        date: { gte: startDate },
      },
      orderBy: { date: 'asc' },
    });

    let currentStreak = 0;
    let updated = 0;

    for (const day of days) {
      // Only PRESENT days count toward streak
      if (day.status === 'PRESENT') {
        currentStreak++;
      } else {
        currentStreak = 0;
      }

      // Update the day with current streak
      await prisma.staffAttendanceDay.update({
        where: { id: day.id },
        data: { currentStreak },
      });
      updated++;
    }

    console.log(`  ${s.name}: ${updated} days processed, final streak: ${currentStreak}`);
  }

  console.log('✅ Backfill complete!');
}

backfillStreaks()
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
