import { test } from '../support/api-only.ts';

/**
 * The proof that the guard for the `@api-only` journeys works (e2e/support/api-only.ts), run in
 * every Screen check. It is tagged `@api-only` and asks for a page, which the guard refuses, so
 * it is expected to fail, and Playwright reports a test that is expected to fail and does as
 * passed. If the guard ever stops refusing, the test opens a page and passes, which Playwright
 * reports as a failure: the check fails, rather than a tagged journey quietly opening a page
 * that WebKit never sees. (It stays permanently; it is not a test to fix.)
 */

test.fail(
  'a journey tagged as API-only that asks for a page is refused',
  { tag: '@api-only' },
  async ({ page }) => {
    await page.goto('about:blank');
  },
);
