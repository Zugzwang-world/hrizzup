import { defineConfig } from 'vitest/config';

// The tests that hold the database to the hand-over agreement (tests/agreement/) and the one that
// proves the scheduled jobs' reload after a push (tests/scheduled_jobs/, about 45 s: it parks Supabase
// Cron's scheduler on a lock and pauses the jobs for a while, then puts everything back), run by
// `infra/slots/slot db test` after the pgTAP tests, on the same fresh database.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // One database for every file: they run one after another, so no test's transaction ever
    // waits on another's.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
