// Point Prisma at the LOCAL dev DB for integration tests (reads .env.local).
// Runs before the integration test modules import '@/lib/db'.
import fs from 'node:fs';
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '').trim();
  }
  if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;
} catch {
  // no .env.local → the integration tests will fail fast with a clear DB error
}
