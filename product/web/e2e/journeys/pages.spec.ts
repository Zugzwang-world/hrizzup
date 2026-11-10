import { expect, type Page, type Request, test } from '@playwright/test';
import { pages, pagesIn, type Page as SitePage } from '../pages.ts';
import { phone } from './phone.ts';

/**
 * Journey: every page opens. Each page in pages.ts, opened as a visitor would on a phone, in
 * Chromium and WebKit: it answers as it should, shows its heading, and nothing on it breaks
 * (no script error, no request of ours that fails). Then a visitor moves between the pages
 * through their own links.
 */
test.use(phone);

/**
 * Collects what goes wrong while a page is open: script errors, console errors, and requests to
 * our own site that fail or answer with an error. `expected` is the one address allowed to
 * answer with an error: the 404 page's own document.
 */
function watch(page: Page, site: string, expected?: string) {
  const problems: string[] = [];
  const ours = (url: string) => new URL(url).origin === site;
  page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error' || message.location().url === expected) return;
    problems.push(`console error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    // A request the page itself called off (Next.js drops link prefetches it no longer needs).
    const calledOff = /ERR_ABORTED|cancelled/i.test(request.failure()?.errorText ?? '');
    if (ours(request.url()) && !calledOff) {
      problems.push(`request failed: ${new URL(request.url()).pathname}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && ours(response.url()) && response.url() !== expected) {
      problems.push(`${new URL(response.url()).pathname} answered ${response.status()}`);
    }
  });
  return problems;
}

/**
 * Waits, as Playwright's "network idle" does, until nothing has been loading for half a second,
 * counting every request that goes over the network, ours and other sites'. Only addresses that
 * are already in the page's memory (`blob:`, `data:`) don't count: they aren't traffic, and
 * Playwright never sees some of them finish (Cloudflare's bot check starts its worker from one,
 * so "network idle" never came on the app's bot check page, which had settled). Watch from before
 * the page is opened, so nothing it loads is missed.
 */
function watchLoading(page: Page) {
  const loading = new Set<Request>();
  const inMemory = (request: Request) => /^(blob|data):/.test(request.url());
  page.on('request', (request) => {
    if (!inMemory(request)) loading.add(request);
  });
  page.on('requestfinished', (request) => loading.delete(request));
  page.on('requestfailed', (request) => loading.delete(request));
  return async function settled(timeout = 60_000) {
    const start = Date.now();
    let quietSince = Date.now();
    while (Date.now() - quietSince < 500) {
      if (Date.now() - start > timeout) {
        const still = [...loading].map((request) => request.url());
        throw new Error(`Still loading after ${timeout / 1000} s: ${still.join(', ')}`);
      }
      if (loading.size > 0) quietSince = Date.now();
      await page.waitForTimeout(100);
    }
  };
}

/** Whether the page exists where the checks run (global-setup.ts reads the environment). */
function existsHere(sitePage: SitePage): boolean {
  return pagesIn(process.env.SCREEN_CHECK_ENVIRONMENT).includes(sitePage);
}

for (const sitePage of pages) {
  test(`${sitePage.name} opens`, async ({ page, baseURL }) => {
    const address = new URL(sitePage.path, baseURL ?? 'http://localhost:3000');
    // A page that doesn't exist here (the sign-in test page, on production) must answer 404.
    const status = existsHere(sitePage) ? (sitePage.status ?? 200) : 404;
    const problems = watch(page, address.origin, status >= 400 ? address.href : undefined);
    const settled = watchLoading(page);
    const response = await page.goto(sitePage.path);
    expect(response?.status(), `${sitePage.path} answers`).toBe(status);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Hrizzup/);
    await page.waitForLoadState('load');
    await settled();
    expect(problems).toEqual([]);
  });
}

test('a visitor moves between the pages through their links', async ({ page }) => {
  const settled = watchLoading(page);
  await page.goto('/');
  await expect(page.locator('[data-page="holding"]')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Legal' })
    .getByRole('link', { name: 'Privacy' })
    .click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Legal' })
    .getByRole('link', { name: 'Terms' })
    .click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Terms');

  await page.getByRole('link', { name: 'Hrizzup', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-page="holding"]')).toBeVisible();

  // As a visitor would, let the page finish loading before going to another address: Next.js
  // turns a page fetch cut off by leaving (one still in flight from an earlier click) into a full
  // load of that page, which would take over this one (seen in WebKit on GitHub's slower runners).
  await settled();
  const missing = await page.goto('/this-page-does-not-exist');
  expect(missing?.status()).toBe(404);
  await page.getByRole('link', { name: 'Back to the home page' }).click();
  await expect(page.locator('[data-page="holding"]')).toBeVisible();
});
