import { defineConfig } from 'vitest/config';

// Quick checks: everything that needs no database. The database's own tests (*.db.test.ts) run
// in the Database check, against a fresh database built from the migrations (vitest.db.config.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.db.test.ts', 'node_modules/**'],
  },
});
