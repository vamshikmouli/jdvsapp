import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Integration tests — hit the LOCAL Postgres via .env.local. Run separately
// from the always-green unit suite: `npm run test:integration`.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(process.cwd()) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.itest.ts'],
    setupFiles: ['tests/setup-db.ts'],
    hookTimeout: 30000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
