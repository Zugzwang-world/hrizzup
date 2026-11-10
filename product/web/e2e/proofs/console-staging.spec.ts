import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { trade } from '@hrizzup/ledger';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { money } from '../../lib/console-format.ts';
import { engineAccount } from '../support/run.ts';
import { adminState } from '../support/states.ts';

/**
 * PLAN.md step 1.7c's done-test, on staging itself, with a real bet in it: as the market
 * console's admin test account, in the console in a real browser, an admin creates a test market,
 * opens it (unlisted, as every run's market is), closes it and settles it Yes; in between, the run's
 * own Chromium account bets on Yes through the ledger's own trade(), from the Ṁ1,000 its signup gave
 * it (it was written before the typed API could bet, step 1.7d).
 * The console's log shows each step, and what it paid comes to all the market held.
 *
 * Not part of the checks: it runs only when asked, against staging, and leaves a settled test
 * market there.
 *
 *   infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- sh -c \
 *     'cd product/web && CONSOLE_STAGING_PROOF=1 BASE_URL=https://staging.hrizzup.com \
 *      pnpm exec playwright test e2e/proofs/console-staging.spec.ts --project chromium'
 */
test.skip(!process.env.CONSOLE_STAGING_PROOF, 'Runs only when asked (CONSOLE_STAGING_PROOF=1)');

const STAGING_POOLER_USER = 'postgres.mlccgqxtqmllwbyjfzzm';

function stagingDatabase(): pg.Pool {
  const address = process.env.DATABASE_ADDRESS;
  if (!address) throw new Error('DATABASE_ADDRESS is not set: run through database_url.py');
  const url = new URL(address);
  if (decodeURIComponent(url.username) !== STAGING_POOLER_USER) {
    throw new Error("DATABASE_ADDRESS isn't staging's database; this refuses any other");
  }
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith('ssl')) url.searchParams.delete(key);
  const ca = readFileSync(
    new URL('../../../../infra/supabase/supabase-root-2021-ca.crt', import.meta.url),
    'utf8',
  );
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true },
    max: 2,
  });
  pool.on('error', () => {});
  return pool;
}

const micros = (text: string) => {
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return text.startsWith('-') ? -value : value;
};
const decimal = (value: bigint) => {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
};

test('on staging, an admin creates, opens, closes and settles a market in the console, with a bet in it', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  expect(baseURL, 'against staging itself').toBe('https://staging.hrizzup.com');
  const db = stagingDatabase();
  try {
    // The trader: this run's own Chromium account (global-setup.ts), with its starting balance.
    const { rows: users } = await db.query<{ id: string }>(
      'select id from auth.users where email = $1',
      [engineAccount('chromium')],
    );
    const trader = users[0]?.id as string;
    expect(trader, "the run's own account").toBeTruthy();
    const balanceOf = async () => {
      const { rows } = await db.query<{ balance: string }>(
        `select balance::text from ledger.accounts where kind = 'person' and user_id = $1`,
        [trader],
      );
      return micros((rows[0] as { balance: string }).balance);
    };
    const before = await balanceOf();

    const context = await browser.newContext({ storageState: adminState('chromium') });
    const page = await context.newPage();
    const question = `Staging proof (${new Date().toISOString().slice(0, 16)} UTC): will the test desk record event A?`;
    await page.goto('/console');
    await expect(page.getByRole('heading', { level: 1, name: 'Market console' })).toBeVisible();
    await page.getByRole('link', { name: 'Create a market' }).click();
    await page.getByLabel('Question').fill(question);
    await page.getByLabel('Main category').selectOption('general');
    await page
      .getByLabel('Rules')
      .fill(
        "A test market for step 1.7c's done-test on staging, with one bet in it.\nYes wins if the test desk records event A.",
      );
    await page.getByLabel('Settlement source').fill("Hrizzup's test desk (a placeholder source)");
    await page.getByLabel('Keep it off the public list').check();
    await page.getByRole('button', { name: 'Create the draft' }).click();
    await expect(page.getByRole('heading', { level: 1, name: question })).toBeVisible();
    const id = page.url().split('/').pop() as string;

    await page.getByRole('button', { name: 'Open the market' }).click();
    await expect(page.getByTestId('market-state')).toHaveText('Open');

    // The bet, through the ledger's own trade(), as the app's own role.
    const bought = await trade(db, trader, {
      action: 'buy',
      requestId: randomUUID(),
      marketId: id,
      outcome: 'YES',
      amount: '100',
    });
    expect(bought.status).toBe('filled');
    const shares = bought.status === 'filled' ? bought.shares : '0';
    await page.reload();
    await expect(page.getByTestId('market-held')).toHaveText('Ṁ1,100');

    await page.getByRole('button', { name: 'Close the market' }).click();
    await expect(page.getByTestId('market-state')).toHaveText('Closed');
    await page.getByRole('radio', { name: /^Yes/ }).check();
    await page
      .getByLabel('Evidence')
      .fill("The test desk recorded event A (step 1.7c's done-test on staging).");
    await page.getByRole('button', { name: 'Settle the market' }).click();
    await expect(page.getByTestId('market-state')).toHaveText('Settled');
    await expect(page.getByTestId('market-held')).toHaveText('Ṁ0');

    // The log: four steps, by the admin; the settlement's evidence; and what it paid: the Yes
    // shares to the trader, the rest to the house, all the market held (Ṁ1,100).
    const log = page.getByTestId('market-log');
    await expect(log.getByRole('listitem')).toHaveCount(4);
    for (const step of ['Created', 'Opened', 'Closed', 'Settled: Yes']) {
      await expect(log).toContainText(`${step} by delivered+market-admin@resend.dev`);
    }
    const house = micros('1100') - micros(shares);
    await expect(page.getByTestId('settlement-paid')).toHaveText(
      `${money(decimal(micros(shares)))} to 1 person, and ${money(decimal(house))} to the house: all the market held`,
    );
    expect(await balanceOf(), 'the trader got Ṁ1 a Yes share').toBe(
      before - micros('100') + micros(shares),
    );
    const { rows: problems } = await db.query('select problem from ledger.problems()');
    expect(problems, 'the books on staging have no problem').toEqual([]);

    await page.screenshot({
      path: process.env.PROOF_SCREENSHOT ?? 'console-staging-proof.png',
      fullPage: true,
    });
    console.log(
      `PROOF: market ${id} on staging, settled Yes in the console: ${shares} shares paid, ${decimal(house)} to the house`,
    );
    await context.close();
  } finally {
    await db.end();
  }
});
