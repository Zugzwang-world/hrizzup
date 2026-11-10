import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { money } from '../../lib/console-format.ts';
import { adminState, signedInState } from '../support/states.ts';

/**
 * PLAN.md step 1.7d's done-test, on staging itself (the one run that puts its market on staging's
 * public list, since the list is part of what it proves; it runs only when asked): list, trade and positions through the typed API
 * on a test market, and the trade call refusing each of the inputs it must. Staging's firewall lets
 * only browsers write to the typed API, so every call here is made from inside a real browser page on
 * staging, signed in as the run's own Chromium account (the Ṁ1,000 its signup gave it;
 * global-setup.ts), the way the market pages (3.1) will call it. The market console's admin test account makes, opens, closes
 * and settles the test market in the console, and the payouts must add up.
 *
 * Not part of the checks: it runs only when asked, against staging, and leaves a settled test market
 * there.
 *
 *   infra/doppler/run stg -- sh -c 'cd product/web && TRADING_STAGING_PROOF=1 \
 *     BASE_URL=https://staging.hrizzup.com pnpm exec playwright test \
 *     e2e/proofs/trading-staging.spec.ts --project chromium'
 */
test.skip(!process.env.TRADING_STAGING_PROOF, 'Runs only when asked (TRADING_STAGING_PROOF=1)');

const micros = (text: string) => {
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return negative ? -value : value;
};
const decimal = (value: bigint) => {
  const negative = value < 0n;
  const size = negative ? -value : value;
  return `${negative ? '-' : ''}${size / 1_000_000n}.${(size % 1_000_000n).toString().padStart(6, '0')}`;
};

type Answer = { status: number; body: Record<string, unknown>; cache: string | null };

/** One call of the typed API, made by the page itself (same site, the browser's own cookies). */
async function call(page: Page, method: 'GET' | 'POST', path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : {},
        cache: response.headers.get('x-vercel-cache'),
      };
    },
    { method, path, body },
  ) as Promise<Answer>;
}

type Listed = { market: { id: string; state: string }; probability: string | null };

async function listed(page: Page, id: string): Promise<{ item?: Listed; cache: string | null }> {
  const answer = await call(page, 'GET', '/api/v1/markets');
  const item = (answer.body.markets as Listed[]).find((entry) => entry.market.id === id);
  return { ...(item ? { item } : {}), cache: answer.cache };
}

async function until<T>(seconds: number, found: () => Promise<T | undefined>) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await found();
    if (value !== undefined || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test('on staging, a signed-in person lists a test market, trades it and reads their positions; bad inputs are refused; the console settles it, the payouts adding up', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  expect(baseURL, 'against staging itself').toBe('https://staging.hrizzup.com');

  // The admin makes and opens a test market in the console.
  const admin = await (
    await browser.newContext({ storageState: adminState('chromium') })
  ).newPage();
  const question = `Staging proof (${new Date().toISOString().slice(0, 16)} UTC): will the test desk record event T?`;
  await admin.goto('/console');
  await admin.getByRole('link', { name: 'Create a market' }).click();
  await admin.getByLabel('Question').fill(question);
  await admin.getByLabel('Main category').selectOption('general');
  await admin
    .getByLabel('Rules')
    .fill(
      "A test market for step 1.7d's done-test on staging.\nYes wins if the test desk records event T.",
    );
  await admin.getByLabel('Settlement source').fill("Hrizzup's test desk (a placeholder source)");
  await admin.getByRole('button', { name: 'Create the draft' }).click();
  await expect(admin.getByRole('heading', { level: 1, name: question })).toBeVisible();
  const id = admin.url().split('/').pop() as string;
  await admin.getByRole('button', { name: 'Open the market' }).click();
  await expect(admin.getByTestId('market-state')).toHaveText('Open');

  // The trader, in a page on staging.
  const trader = await (
    await browser.newContext({ storageState: signedInState('chromium') })
  ).newPage();
  await trader.goto('/');

  // The list shows the market, and is served from the edge.
  const first = await until(30, async () => (await listed(trader, id)).item);
  expect(first).toMatchObject({ market: { id, state: 'open' }, probability: '0.50000000' });
  const again = await listed(trader, id);
  expect(again.cache, "the list comes from Vercel's edge").toMatch(/^(HIT|STALE)$/);

  const start = await call(trader, 'GET', '/api/v1/me/positions');
  expect(start.status).toBe(200);
  const balance0 = micros(String(start.body.balance));

  // A buy, retried, and the list refreshed with its price.
  const purchase = {
    marketId: id,
    requestId: randomUUID(),
    action: 'buy',
    outcome: 'yes',
    amount: '10',
  };
  const tradedAt = Date.now();
  const bought = await call(trader, 'POST', '/api/v1/trades', purchase);
  expect(bought.status).toBe(200);
  expect(bought.body).toMatchObject({
    status: 'filled',
    balance: decimal(balance0 - micros('10')),
  });
  expect(await call(trader, 'POST', '/api/v1/trades', purchase)).toMatchObject({
    status: 200,
    body: bought.body,
  });
  const refreshed = await until(60, async () => {
    const { item } = await listed(trader, id);
    return item?.probability === bought.body.probAfter ? item : undefined;
  });
  expect(refreshed, "the list shows the trade's price").toBeTruthy();
  const refreshSeconds = (Date.now() - tradedAt) / 1000;

  // Each input the trade call must refuse.
  const fresh = (changes: Record<string, unknown>) => ({
    ...purchase,
    requestId: randomUUID(),
    ...changes,
  });
  for (const [what, sent, status] of [
    ['a limit of 99.5%', fresh({ limitProb: '0.995' }), 400],
    ['a limit of 0.5%', fresh({ limitProb: '0.005' }), 400],
    ['an expiry of zero', fresh({ limitProb: '0.4', expiresAt: '1970-01-01T00:00:00Z' }), 400],
    ['an amount of zero', fresh({ amount: '0' }), 400],
    ['an amount below zero', fresh({ amount: '-5' }), 400],
    ['an amount over the balance', fresh({ amount: decimal(balance0) }), 422],
  ] as const) {
    expect((await call(trader, 'POST', '/api/v1/trades', sent)).status, what).toBe(status);
  }

  // A sale, a limit order that rests, its cancel, and the positions.
  const shares = micros(String((bought.body.position as { yes: string }).yes));
  const sold = await call(trader, 'POST', '/api/v1/trades', {
    marketId: id,
    requestId: randomUUID(),
    action: 'sell',
    outcome: 'yes',
    shares: decimal(shares / 2n),
  });
  expect(sold.body).toMatchObject({ status: 'filled' });
  const limit = await call(trader, 'POST', '/api/v1/trades', {
    ...fresh({ amount: '5' }),
    limitProb: '0.2',
  });
  expect(limit.body).toMatchObject({ status: 'resting' });
  const orders = await call(trader, 'GET', '/api/v1/me/orders');
  expect((orders.body.orders as { id: string }[]).map((o) => o.id)).toContain(limit.body.tradeId);
  const cancelled = await call(trader, 'POST', '/api/v1/orders/cancel', {
    marketId: id,
    orderId: limit.body.tradeId,
    requestId: randomUUID(),
  });
  expect(cancelled.body).toMatchObject({ status: 'cancelled' });
  const positions = await call(trader, 'GET', '/api/v1/me/positions');
  const kept = micros(String((sold.body.position as { yes: string }).yes));
  expect(
    (positions.body.positions as { marketId: string; yes: string }[]).find(
      (p) => p.marketId === id,
    ),
  ).toMatchObject({ yes: decimal(kept) });
  const beforeSettling = micros(String(positions.body.balance));

  // The console settles it Yes; the payouts add up.
  await admin.reload();
  const heldText = await admin.getByTestId('market-held').textContent();
  await admin.getByRole('button', { name: 'Close the market' }).click();
  await expect(admin.getByTestId('market-state')).toHaveText('Closed');
  await admin.getByRole('radio', { name: /^Yes/ }).check();
  await admin
    .getByLabel('Evidence')
    .fill("The test desk recorded event T (step 1.7d's done-test on staging).");
  await admin.getByRole('button', { name: 'Settle the market' }).click();
  await expect(admin.getByTestId('market-state')).toHaveText('Settled');
  const paid = await admin.getByTestId('settlement-paid').textContent();
  expect(paid).toContain(`${money(decimal(kept))} to 1 person, and `);
  expect(paid).toContain('to the house: all the market held');
  const after = await call(trader, 'GET', '/api/v1/me/positions');
  expect(after.body.balance, 'Ṁ1 a Yes share').toBe(decimal(beforeSettling + kept));

  await admin.screenshot({
    path: process.env.PROOF_SCREENSHOT ?? 'trading-staging-proof.png',
    fullPage: true,
  });
  console.log(
    `PROOF: market ${id} on staging: bought ${decimal(shares)} Yes shares for Ṁ10, the list refreshed in ${refreshSeconds.toFixed(1)} s, every bad input refused; settled Yes in the console: ${paid} (held before closing: ${heldText})`,
  );
});
