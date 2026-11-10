import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { CONSOLE_FIXTURE_MARKET } from '../pages.ts';
import { adminState, signedInState } from '../support/states.ts';
import { ADMIN_TEST_ACCOUNT } from '../support/test-accounts.ts';
import { phone } from './phone.ts';

/**
 * Journey: the market console (PLAN.md step 1.7c), at a phone size, in Chromium and WebKit.
 * - Anyone but an admin, signed in or not, gets "not found" for every page of it: the site's own
 *   "not found" page, exactly as for an address the site doesn't have, its forms included.
 * - An admin creates a test market, opens, closes and settles it by hand, and the log shows each
 *   step, the settlement's evidence, and payouts that come to all the market held; then cancels
 *   another, with the reason.
 * Each run makes its own markets on staging (previews share its database), with a question that
 * says so; they stay as settled test markets.
 */
test.use(phone);

const onProduction = () => process.env.SCREEN_CHECK_ENVIRONMENT === 'production';

async function asAdmin(browser: Browser, browserName: string): Promise<Page> {
  const context = await browser.newContext({ ...phone, storageState: adminState(browserName) });
  return context.newPage();
}

/** Makes a market through the console's form, and lands on its page. */
async function createMarket(page: Page, question: string) {
  await page.goto('/console');
  await expect(page.getByRole('heading', { level: 1, name: 'Market console' })).toBeVisible();
  await page.getByRole('link', { name: 'Create a market' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create a market' })).toBeVisible();
  await page.getByLabel('Question').fill(question);
  await page.getByLabel('Main category').selectOption('general');
  await page
    .getByLabel('Rules')
    .fill('A test market for the console journey.\nYes wins if the test desk records it.');
  await page.getByLabel('Settlement source').fill("Hrizzup's test desk (a placeholder source)");
  await page.getByRole('button', { name: 'Create the draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: question })).toBeVisible();
  await expect(page.getByTestId('market-state')).toHaveText('Draft');
}

test('anyone but an admin, signed in or not, finds no console', async ({
  page,
  browser,
  browserName,
}) => {
  for (const path of ['/console', '/console/markets/new']) {
    const visitor = await page.goto(path);
    expect(visitor?.status(), `${path}, signed out`).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  }
  test.skip(onProduction(), 'No test accounts on production');
  const context = await browser.newContext({ ...phone, storageState: signedInState(browserName) });
  const member = await context.newPage();
  for (const path of ['/console', '/console/markets/new']) {
    const answer = await member.goto(path);
    expect(answer?.status(), `${path}, signed in but not an admin`).toBe(404);
    await expect(member.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  }
  await context.close();
});

/** Headers that differ from one answer to the next by their nature (the time, the request's ID). */
const PER_ANSWER = new Set([
  'date',
  'age',
  'x-vercel-id',
  'x-vercel-cache',
  'connection',
  'keep-alive',
]);

/** An answer as a stranger can compare it: its status, its body, and its headers. */
async function answer(
  as: APIRequestContext,
  method: 'GET' | 'POST',
  path: string,
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  // A form's post, as the console's forms send one (a server action), naming an action that
  // doesn't exist: what a stranger trying the forms could send.
  const form = {
    headers: {
      'next-action': '7f00000000000000000000000000000000000000aa',
      'content-type': 'text/plain;charset=UTF-8',
      accept: 'text/x-component',
    },
    data: '[]',
  };
  const response = await as.fetch(path, {
    method,
    maxRedirects: 0,
    ...(method === 'POST' ? form : {}),
  });
  return {
    status: response.status(),
    text: await response.text(),
    headers: Object.fromEntries(
      Object.entries(response.headers()).filter(([name]) => !PER_ANSWER.has(name)),
    ),
  };
}

test("the console's pages answer anyone but an admin exactly as an address the site doesn't have", async ({
  request,
  playwright,
  baseURL,
  browserName,
}) => {
  const strangers: { who: string; as: APIRequestContext }[] = [{ who: 'signed out', as: request }];
  if (!onProduction()) {
    strangers.push({
      who: 'signed in, not an admin',
      as: await playwright.request.newContext({
        ...(baseURL ? { baseURL } : {}),
        storageState: signedInState(browserName),
      }),
    });
  }
  const pages = ['/console', '/console/markets/new', `/console/markets/${CONSOLE_FIXTURE_MARKET}`];
  for (const method of ['GET', 'POST'] as const) {
    // Not a page of the site at all: what every stranger must get, to the byte.
    const unknown = await answer(request, method, '/this-page-does-not-exist');
    if (method === 'GET') {
      expect(unknown.status).toBe(404);
      // The site's "not found" page, rendered on the server: the page itself is in the answer,
      // not an empty one the phone must build with JavaScript.
      expect(unknown.text).toContain('Page not found');
      expect(unknown.text).not.toContain('__next_error__');
    }
    for (const { who, as } of strangers) {
      for (const path of pages) {
        const what = `${who}: ${method} ${path}`;
        const got = await answer(as, method, path);
        expect(got.status, what).toBe(unknown.status);
        expect(got.text, what).toBe(unknown.text);
        if (process.env.SCREEN_CHECK_ENVIRONMENT === 'development') {
          // Next.js's own server on this Mac says the proxy handed the request on (Vercel, where
          // the checks run, doesn't): only that, naming nothing but the address with no page.
          expect(got.headers['x-middleware-rewrite'], what).toBe('/_no-such-page');
          delete got.headers['x-middleware-rewrite'];
        }
        expect(got.headers, what).toEqual(unknown.headers);
      }
    }
  }
});

test('an admin creates, opens, closes and settles a market; the log shows it, and the payouts add up', async ({
  browser,
  browserName,
}) => {
  test.skip(onProduction(), "The console doesn't exist on production until launch");
  const page = await asAdmin(browser, browserName);
  const question = `Journey test (${browserName}, ${Date.now().toString(36)}): will the test desk record event A?`;
  await createMarket(page, question);
  await expect(page.getByTestId('market-held')).toHaveText('Ṁ0');

  await page.getByRole('button', { name: 'Open the market' }).click();
  await expect(page.getByTestId('market-state')).toHaveText('Open');
  await expect(page.getByTestId('market-held')).toHaveText('Ṁ1,000');

  await page.getByRole('button', { name: 'Close the market' }).click();
  await expect(page.getByTestId('market-state')).toHaveText('Closed');

  await page.getByRole('radio', { name: /^Yes/ }).check();
  await page.getByLabel('Evidence').fill('The test desk recorded event A (the console journey).');
  await page.getByRole('button', { name: 'Settle the market' }).click();
  await expect(page.getByTestId('market-state')).toHaveText('Settled');
  await expect(page.getByTestId('market-result')).toContainText('Yes');
  await expect(page.getByTestId('market-held')).toHaveText('Ṁ0');

  const log = page.getByTestId('market-log');
  await expect(log.getByRole('listitem')).toHaveCount(4);
  for (const step of ['Created', 'Opened', 'Closed', 'Settled: Yes']) {
    await expect(log).toContainText(`${step} by ${ADMIN_TEST_ACCOUNT}`);
  }
  await expect(log).toContainText('The test desk recorded event A (the console journey).');
  // No bets, so the house gets its seed back: everything the market held.
  await expect(page.getByTestId('settlement-paid')).toHaveText(
    'Ṁ0 to 0 people, and Ṁ1,000 to the house: all the market held',
  );
  await page.context().close();
});

test('an admin cancels a market that cannot be settled fairly, with the reason', async ({
  browser,
  browserName,
}) => {
  test.skip(onProduction(), "The console doesn't exist on production until launch");
  const page = await asAdmin(browser, browserName);
  const question = `Journey test (${browserName}, ${Date.now().toString(36)}): will the test desk record event B?`;
  await createMarket(page, question);
  await page.getByRole('button', { name: 'Open the market' }).click();
  await expect(page.getByTestId('market-state')).toHaveText('Open');
  await page.getByRole('button', { name: 'Close the market' }).click();
  await expect(page.getByTestId('market-state')).toHaveText('Closed');

  // A cancel without its reason is refused, and nothing changes.
  await page.getByRole('radio', { name: /^Cancel/ }).check();
  await page.getByLabel('Evidence').fill('The test desk recorded nothing about event B.');
  await page.getByRole('button', { name: 'Settle the market' }).click();
  await expect(page.getByTestId('console-refusal')).toContainText(
    'A cancel, and only a cancel, gives its reason',
  );
  await expect(page.getByTestId('market-state')).toHaveText('Closed');

  await page.getByLabel("Why it's cancelled").fill('The test desk recorded nothing within a day.');
  await page.getByRole('button', { name: 'Settle the market' }).click();
  await expect(page.getByTestId('market-state')).toHaveText('Cancelled');
  await expect(page.getByTestId('market-result')).toContainText(
    'Cancelled: The test desk recorded nothing within a day.',
  );
  await expect(page.getByTestId('market-log')).toContainText('Settled: Cancelled');
  await page.context().close();
});
