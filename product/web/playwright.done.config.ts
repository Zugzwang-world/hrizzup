import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

/**
 * The steps' done-tests (PLAN.md section 3: each step's done test), run by hand against staging,
 * never by the checks: each is in e2e/done/ and says how to run it (3.4a's takes a few minutes).
 * The Screen check's own setup, in Chromium only, with no retries: a done-test runs once, and
 * passes or fails.
 */
export default defineConfig({
  ...base,
  testDir: './e2e/done',
  testIgnore: [],
  retries: 0,
  failOnFlakyTests: true,
  timeout: 20 * 60_000,
  reporter: [['list']],
  projects: (base.projects ?? []).filter((project) => project.name === 'chromium'),
});
