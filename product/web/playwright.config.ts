import { defineConfig } from '@playwright/test';
import { runKey } from './e2e/support/run.ts';
import { signedOutState } from './e2e/support/states.ts';

// This check run's own key, made once here and passed to every test process (e2e/support/run.ts).
runKey();

/**
 * The Screen check: the screen sizes (e2e/screens.spec.ts) and the journeys (e2e/journeys/),
 * in Chromium and WebKit. It runs against BASE_URL: a pull request's preview (in CI),
 * staging, or this Mac (default, http://localhost:3000). On a protected Vercel deployment,
 * global-setup.ts trades the protection bypass for automation (VERCEL_AUTOMATION_BYPASS_SECRET)
 * for Vercel's bypass cookie, which each browser starts with, so the secret itself never
 * travels with the browsers' requests (e2e/support/bypass.ts). Traces, screenshots on failure
 * and video are off, because they would record the cookies.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // The steps' done-tests run by hand against staging, never in a check (playwright.done.config.ts).
  testIgnore: '**/done/**',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // One retry in GitHub, so a test that fails for a reason outside our code (a network blip)
  // shows it; but a test that passes only on its retry fails the check (CLAUDE.md, "How checks
  // behave"), so flakiness is never hidden: it's found, and fixed (e2e/config.test.ts keeps both).
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  timeout: 120_000,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', storageState: signedOutState('chromium') },
    },
    { name: 'webkit', use: { browserName: 'webkit', storageState: signedOutState('webkit') } },
  ],
});
