import { defineConfig } from 'vitest/config';

// The Database check: the perp's calls against a real database, built fresh from the
// migrations (scripts/test-db.ts finds it and passes its address as PERPS_DATABASE_URL).
export default defineConfig({
  test: {
    include: ['src/**/*.db.test.ts'],
    // One file at a time: the files share one database, and each checks the whole books.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
