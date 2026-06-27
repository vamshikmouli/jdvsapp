// One-time: recompute every already-recorded Saturday from June 1, 2026 onward
// so existing HALF_DAY rows flip to PRESENT under the new short-day rule.
// Only touches days that already have a stored row (never creates new rows) and
// recomputes status faithfully from the actual punches. Idempotent.
//
// Run:  npx tsx scripts/recompute-saturdays.ts <env-file>
//   e.g. npx tsx scripts/recompute-saturdays.ts .env.production.local

// Load env BEFORE Prisma is imported (dynamic import below) so DATABASE_URL is set.
const envFile = process.argv[2] || '.env.local';
process.loadEnvFile(envFile);

const START = new Date('2026-06-01T00:00:00Z');

async function main() {
  const { prisma } = await import('@/lib/db');
  const { recomputeDay } = await import('@/lib/staffAttendance/service');

  const host = (process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@');
  console.log(`env: ${envFile}`);
  console.log('DB:', host.slice(0, 90));

  const today = new Date();
  const rows = await prisma.staffAttendanceDay.findMany({
    where: { date: { gte: START, lte: today } },
    select: { staffId: true, date: true, status: true },
  });
  // Saturday = UTC weekday 6 (rows are stored at YYYY-MM-DDT00:00:00Z).
  const saturdays = rows.filter((r) => r.date.getUTCDay() === 6);
  console.log(`Found ${saturdays.length} stored Saturday rows since 2026-06-01.`);

  let flipped = 0;
  for (const r of saturdays) {
    const dateKey = r.date.toISOString().slice(0, 10);
    const updated = await recomputeDay(r.staffId, dateKey);
    if (r.status !== updated?.status) {
      flipped++;
      console.log(`  ${dateKey} ${r.staffId}: ${r.status} -> ${updated?.status}`);
    }
  }
  console.log(`✅ Done. ${flipped} day(s) changed status.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Recompute failed:', err);
  process.exit(1);
});
