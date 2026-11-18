import { test as base, expect } from '@playwright/test';

/**
 * The guard for the journeys that only call the API and never open a page (CLAUDE.md, "Checks
 * sized to the change"; Round 6, R4, M7.4). Such a journey is tagged `@api-only` and runs once, in
 * Chromium: the WebKit project leaves out every test with the tag (playwright.config.ts), since a
 * second browser would only repeat the same calls. A test that opens a page must still run in
 * both browsers at every width, so this makes sure no tagged test ever does:
 *
 * - `page`, `context` and `browser` throw instead of opening anything, so a tagged test that asks
 *   for one fails with the message below, never quietly loses its second browser;
 * - a test written with this `test` but not tagged fails too, so a file can't hold a journey that
 *   asks for no page today and silently skips WebKit tomorrow with the tag missing, nor the other
 *   way round;
 * - `playwright` keeps its request client, but its browser types (`chromium`, `webkit`, `firefox`)
 *   refuse to launch, connect or start anything;
 * - `request`, `playwright.request`, `baseURL` and `browserName` stay: the calls themselves, and
 *   the account each engine's sessions belong to, are unchanged.
 *
 * A journey that does open a page takes its `test` from `@playwright/test`, as always, and runs in
 * both browsers. e2e/config.test.ts keeps every file that tags a test on this module, and every
 * file on this module tagged; e2e/journeys/api-only-guard.spec.ts proves, in every run, that a
 * tagged test that asks for a page fails.
 */

/** The tag, as the projects in playwright.config.ts leave it out of WebKit. */
export const API_ONLY_TAG = '@api-only';

/** What a tagged test that asks for a page, a context or a browser fails with. */
export const OPENED_A_BROWSER = `A journey tagged ${API_ONLY_TAG} may not open a browser`;

/** What a test written with this module's `test`, but not tagged, fails with. */
export const NOT_TAGGED = `A journey written with the ${API_ONLY_TAG} guard must be tagged ${API_ONLY_TAG}`;

// Playwright reads each fixture's needs from its function's first argument, which must be a
// destructuring pattern; these need nothing, so it is empty.
// biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern
const refuseABrowser = async ({}, _use: unknown): Promise<void> => {
  throw new Error(OPENED_A_BROWSER);
};

/** Playwright's own object keeps each browser type, which its own set-up reads and writes. */
const BROWSER_TYPES = new Set(['chromium', 'webkit', 'firefox', '_android', '_electron']);

/** What starts, or joins, a browser: a browser type's own methods. */
const STARTS = new Set([
  'launch',
  'launchPersistentContext',
  'launchServer',
  'connect',
  'connectOverCDP',
]);

/** A browser type, as the guard hands it out: everything it has, but nothing that starts a browser. */
function withoutStarting<T extends object>(browserType: T): T {
  return new Proxy(browserType, {
    get(target, key) {
      if (typeof key === 'string' && STARTS.has(key)) {
        return () => {
          throw new Error(OPENED_A_BROWSER);
        };
      }
      return Reflect.get(target, key);
    },
    set: (target, key, value) => Reflect.set(target, key, value),
  });
}

export const test = base.extend<{ apiOnlyTag: undefined }>({
  page: refuseABrowser,
  context: refuseABrowser,
  // The worker's browser: asked for by a test that opens its own (`browser.newContext()`).
  browser: [refuseABrowser, { scope: 'worker' }],
  // Playwright's own object stays, for `playwright.request.newContext()` (a client of our API,
  // with a session's cookies), and so do its browser types, which Playwright's own set-up reads;
  // but nothing on them starts a browser (`playwright.chromium.launch()`), so a test can't open
  // one through them either.
  playwright: [
    async ({ playwright }, use) => {
      await use(
        new Proxy(playwright, {
          get(target, key) {
            const value = Reflect.get(target, key);
            return typeof key === 'string' && BROWSER_TYPES.has(key) && value
              ? withoutStarting(value)
              : value;
          },
          set: (target, key, value) => Reflect.set(target, key, value),
        }),
      );
    },
    { scope: 'worker' },
  ],
  apiOnlyTag: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern
    async ({}, use, testInfo) => {
      if (!testInfo.tags.includes(API_ONLY_TAG)) throw new Error(NOT_TAGGED);
      await use(undefined);
    },
    { auto: true },
  ],
});

/**
 * A group of API-only journeys: Playwright's `test.describe(title, { tag }, callback)`, with the
 * tag every such group carries. A file's tests all go under one, so the WebKit project leaves them
 * out as one, and none can lose the tag by a typing slip. (Biome's own rule for describe knows
 * only the form with a title and a callback; Playwright's takes details between them.)
 *
 * The group also holds a hook that asks for the guard's own fixture. Playwright checks a group's
 * hooks against the fixtures of every test inside it, so a test inside the group that wasn't made
 * with this module's `test` (a page-capable one, imported under another name, which would take the
 * group's tag and still open a page) fails to load, whatever it is called.
 */
export function describeApiOnly(title: string, callback: () => void): void {
  // biome-ignore lint/correctness/usePlaywrightValidDescribeCallback: describe's details sit between the title and the callback
  test.describe(title, { tag: API_ONLY_TAG }, () => {
    test.beforeEach(async ({ apiOnlyTag }) => {
      void apiOnlyTag;
    });
    callback();
  });
}

export { expect };
