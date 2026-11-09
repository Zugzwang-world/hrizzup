import { type Browser, expect, type Page, test } from '@playwright/test';
import { adminState, signedInState } from '../support/states.ts';
import { ADMIN_TEST_ACCOUNT } from '../support/test-accounts.ts';
import { phone } from './phone.ts';

/**
 * Journey: the market console (PLAN.md step 1.7c), at a phone size, in Chromium and WebKit.
 * - Anyone but an admin, signed in or not, gets "not found" for every page of it.
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
