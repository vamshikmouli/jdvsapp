import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit tests for the pure fee/money engine and helpers. No DB, no network.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(process.cwd()) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
