import { expect, test } from '@playwright/test';

/**
 * Never merged: the proof that a test passing only on its retry fails the Screen check (R2's
 * milestone 4). This test fails its first try on purpose and passes its retry, so Playwright marks
 * it flaky; with `failOnFlakyTests` on in GitHub (playwright.config.ts), the check must fail.
 */
test('passes only on its retry (a proof, never merged)', async ({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'One engine is enough for the proof');
  expect(testInfo.retry, 'the first try fails on purpose; the retry passes').toBe(1);
});
