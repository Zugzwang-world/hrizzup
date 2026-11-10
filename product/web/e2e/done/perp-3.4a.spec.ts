import { randomUUID } from 'node:crypto';
import { priceFor } from '@hrizzup/perps';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { BITCOIN_PERP } from '../pages.ts';
import { decimal, micros } from '../support/books.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { runAddress, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { ADMIN_TEST_ACCOUNT, sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * PLAN.md step 3.4a's done-test, on staging itself: "through the typed API, a test account opens
 * and closes the perp against the stand-in price; orders fill within seconds; liquidations and
 * funding run with no one touching them; tests prove no play money is created or lost; every rule
 * change is in the log". Run by hand, once, from this Mac (a few minutes: staging's schedule funds
 * and liquidates the run's test perps within a minute or two), never by the checks:
 *
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts'
 *
 * Every call goes from a page on the site, as a browser sends it (staging's firewall lets only
 * browsers write to the typed API). The console's admin test account switches the Bitcoin perp on
 * with the console's own form, the log keeping why; a fresh account of the run's opens a small long
 * on it and closes it, each at the next price within seconds; on test perps of the run's, staging's
 * schedule pays funding (a long and a short, the first funding period two hours past) and
 * liquidates a 10-times long (its seed picked so its price falls past the long's liquidation price),
 * with no one touching them, each perp then retired. Every balance and pool adds up to the
 * millionth. The Bitcoin perp is left switched on, as the done-test leaves it: on staging only,
 * where nobody holds a position afterwards, so the schedule calls nothing.
 */

const STARTING = micros('1000');
const SETTINGS = {
  maxLeverage: '10',
  takerFeeBps: '10',
  takerFeeImpact: '0',
  fundingPeriodMs: '3600000',
  fundingSensitivity: '1',
  maxFundingRate: '0.0001',
  maxPriceAgeMs: '120000',
  subsidyLong: '1000',
  subsidyShort: '1000',
};
const STEP = 5_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));

/** A request the way a page on the site sends one: from inside it, with its own cookies. */
async function fromPage(page: Page, method: string, path: string, data?: unknown) {
  return page.evaluate(
    async ({ method, path, data }) => {
      const response = await fetch(path, {
        method,
        headers: data === undefined ? {} : { 'content-type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
      };
    },
    { method, path, data },
  );
}

/** A page on staging signed in as a fresh account of this run's: exactly its starting balance. */
async function freshPerson(browser: Browser, baseURL: string, purpose: string): Promise<Page> {
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing: run this with Doppler stg");
  const email = runAddress(`${purpose}-${randomUUID().slice(0, 4)}`, 'chromium');
  const session = await sessionFor(keys, email, { create: true });
  const context = await browser.newContext({
    storageState: {
      cookies: session.cookies.map(({ name, value }) => asBrowserCookie(baseURL, name, value)),
      origins: [],
    },
  });
  const page = await context.newPage();
  await page.goto('/privacy');
  return page;
}

type Trade = {
  margin: string;
  fee: string;
  payout: string;
  balance: string;
  placedAt: string;
  priceAt: string;
};

async function trade(page: Page, perpId: string, path: 'open' | 'close', order: object) {
  const started = Date.now();
  const answer = await fromPage(page, 'POST', `/api/v1/perps/${path}`, {
    perpId,
    requestId: randomUUID(),
    ...order,
  });
  expect(answer.status, `${path}: ${JSON.stringify(answer.body)}`).toBe(200);
  const body = answer.body as unknown as Trade & Record<string, unknown>;
  // Orders fill within seconds, at a price published after they were placed.
  expect(Date.now() - started, 'filled within seconds').toBeLessThan(12_000);
  expect(Date.parse(body.priceAt)).toBeGreaterThan(Date.parse(body.placedAt));
  return body;
}

async function eventually<T>(seconds: number, found: () => Promise<T | undefined>): Promise<T> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const value = await found();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`Nothing after ${seconds} seconds`);
    await sleep(3_000);
  }
}

type ConsolePerp = {
  tradingMode: string;
  pools: { long: string; short: string };
  lastFundingAt: string | null;
  price: string | null;
  log: { rule: string; newValue: string; reason: string; by: { email: string | null } | null }[];
};

async function consolePerp(admin: Page, id: string): Promise<ConsolePerp> {
  const answer = await fromPage(admin, 'GET', `/api/v1/admin/perps/${id}`);
  expect(answer.status).toBe(200);
  return answer.body as unknown as ConsolePerp;
}

test("3.4a's done-test on staging: the Bitcoin perp switched on in the console, a test account opens and closes it at the next price, the schedule pays funding and liquidates with no one touching them, the books exact, every change in the log", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(15 * 60_000);
  expect(process.env.SCREEN_CHECK_ENVIRONMENT, 'staging itself').toBe('staging');
  if (!baseURL) throw new Error('BASE_URL is staging');

  // 1. The console's admin test account switches the Bitcoin perp on, with the console's form.
  const admin = await (
    await browser.newContext({ storageState: adminState('chromium') })
  ).newPage();
  await admin.goto(`/console/perps/${BITCOIN_PERP}`);
  const reason = `3.4a's done-test on staging (run ${runKey()})`;
  if ((await admin.getByTestId('perp-mode').textContent()) !== 'On') {
    const form = admin.getByTestId('perp-mode-form');
    await form.getByRole('radio', { name: /^On/ }).check();
    await form.getByLabel('Why').fill(reason);
    await form.getByRole('button', { name: 'Switch' }).click();
    await expect(admin.getByTestId('perp-mode')).toHaveText('On');
  }
  const switched = (await consolePerp(admin, BITCOIN_PERP)).log.filter(
    (line) => line.rule === 'trading_mode' && line.newValue === 'enabled',
  );
  expect(switched.at(-1), 'the switch on is in the log, with who and why').toMatchObject({
    by: { email: ADMIN_TEST_ACCOUNT },
  });

  // 2. A fresh test account opens a small long on the Bitcoin perp and closes it, each at the
  // next price within seconds; its balance exact.
  const person = await freshPerson(browser, baseURL, 'done-btc');
  const shown = await fromPage(person, 'GET', `/api/v1/perps/${BITCOIN_PERP}`);
  expect(shown.body).toMatchObject({ id: BITCOIN_PERP, listed: true, tradingMode: 'enabled' });
  const opened = await trade(person, BITCOIN_PERP, 'open', {
    direction: 'long',
    margin: '10',
    leverage: '2',
  });
  try {
    const held = await fromPage(person, 'GET', '/api/v1/me/perps');
    expect((held.body.positions as { perpId: string }[]).map((p) => p.perpId)).toEqual([
      BITCOIN_PERP,
    ]);
  } finally {
    const closed = await trade(person, BITCOIN_PERP, 'close', { fraction: '1' });
    expect(closed.balance, "the account's balance, to the millionth").toBe(
      decimal(STARTING - micros(opened.margin) - micros(opened.fee) + micros(closed.payout)),
    );
  }

  // 3. Funding with no one touching it, on a test perp of the run's whose first funding period
  // started two hours ago (funding needs both sides: with nobody short, Manifold's rate is zero):
  // a long crowds it, a short takes the other side, and within a minute staging's schedule moves
  // funding from the long's pool to the short's, once.
  const fundingPerp = newRecordId();
  const fundingMade = await fromPage(admin, 'POST', '/api/v1/admin/perps', {
    id: fundingPerp,
    name: `3.4a's done-test: a test perp for funding (run ${runKey()})`,
    seed: [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    standIn: { origin: iso(Date.now() - 60_000), startPrice: '100', volatility: '0.55' },
    settings: SETTINGS,
    fundingFrom: iso(Date.now() - 7_200_000),
    reason,
  });
  expect(fundingMade.status).toBe(201);
  try {
    await fromPage(admin, 'POST', `/api/v1/admin/perps/${fundingPerp}/mode`, {
      mode: 'enabled',
      reason,
    });
    const longer = await freshPerson(browser, baseURL, 'done-fund-l');
    const shorter = await freshPerson(browser, baseURL, 'done-fund-s');
    const long = await trade(longer, fundingPerp, 'open', {
      direction: 'long',
      margin: '100',
      leverage: '5',
    });
    const short = await trade(shorter, fundingPerp, 'open', {
      direction: 'short',
      margin: '20',
      leverage: '5',
    });
    const before = await consolePerp(admin, fundingPerp);
    expect(before.lastFundingAt, 'not funded by the trades themselves').toBeNull();
    const funded = await eventually(150, async () => {
      const now = await consolePerp(admin, fundingPerp);
      return now.lastFundingAt ? now : undefined;
    });
    const paid = micros(before.pools.long) - micros(funded.pools.long);
    expect(paid, "the crowded long's pool paid").toBeGreaterThan(0n);
    expect(micros(funded.pools.short) - micros(before.pools.short), 'into the short pool').toBe(
      paid,
    );
    const longMargin = (await fromPage(longer, 'GET', '/api/v1/me/perps')).body.positions as {
      margin: string;
    }[];
    expect(Number(longMargin[0]?.margin)).toBeLessThan(100);
    const longClosed = await trade(longer, fundingPerp, 'close', { fraction: '1' });
    const shortClosed = await trade(shorter, fundingPerp, 'close', { fraction: '1' });
    expect((await consolePerp(admin, fundingPerp)).lastFundingAt, 'once').toBe(
      funded.lastFundingAt,
    );
    expect(longClosed.balance).toBe(
      decimal(STARTING - micros(long.margin) - micros(long.fee) + micros(longClosed.payout)),
    );
    expect(shortClosed.balance).toBe(
      decimal(STARTING - micros(short.margin) - micros(short.fee) + micros(shortClosed.payout)),
    );
    const after = await consolePerp(admin, fundingPerp);
    expect(decimal(micros(after.pools.long) + micros(after.pools.short)), "the perp's pools").toBe(
      decimal(
        micros('2000') +
          micros(long.margin) +
          micros(long.fee) +
          micros(short.margin) +
          micros(short.fee) -
          micros(longClosed.payout) -
          micros(shortClosed.payout),
      ),
    );
  } finally {
    await fromPage(admin, 'POST', `/api/v1/admin/perps/${fundingPerp}/mode`, {
      mode: 'halted',
      reason,
    });
    await fromPage(admin, 'POST', `/api/v1/admin/perps/${fundingPerp}/retire`, { reason });
  }

  // 4. A test perp of the run's, its seed picked so that a few steps after a 10-times long opens
  // its price is well past the long's liquidation price, and stays there: liquidated by the
  // schedule, with no one touching it.
  const origin = Date.now() - 60_000;
  const first = Math.floor((Date.now() + 3_000 - origin) / STEP);
  let seed = '';
  for (let tries = 0; tries < 200_000 && !seed; tries++) {
    const candidate = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const at = (k: number) =>
      priceFor(
        { seed: candidate, standIn: { origin: iso(origin), startPrice: '100', volatility: '100' } },
        { seed: undefined },
      )(origin + k * STEP).price;
    const fills = [first, first + 1, first + 2, first + 3].map(at);
    const high = Math.max(...fills);
    if (high / Math.min(...fills) > 1.04) continue;
    for (let j = first + 5; j <= first + 9 && !seed; j++) {
      if ([0, 1, 2, 3, 4, 5].every((d) => at(j + d) <= high * 0.85)) seed = candidate;
    }
  }
  expect(seed, 'a seed for the fall').not.toBe('');
  const testPerp = newRecordId();
  const made = await fromPage(admin, 'POST', '/api/v1/admin/perps', {
    id: testPerp,
    name: `3.4a's done-test: a test perp for a liquidation (run ${runKey()})`,
    seed,
    standIn: { origin: iso(origin), startPrice: '100', volatility: '100' },
    settings: SETTINGS,
    reason,
  });
  expect(made.status).toBe(201);
  try {
    await fromPage(admin, 'POST', `/api/v1/admin/perps/${testPerp}/mode`, {
      mode: 'enabled',
      reason,
    });
    const trader = await freshPerson(browser, baseURL, 'done-liq');
    const long = await trade(trader, testPerp, 'open', {
      direction: 'long',
      margin: '10',
      leverage: '10',
    });
    await eventually(120, async () => {
      const now = await fromPage(trader, 'GET', '/api/v1/me/perps');
      return (now.body.positions as unknown[]).length === 0 ? now : undefined;
    });
    const after = await consolePerp(admin, testPerp);
    const liquidation = Number((long.position as { liquidationPrice: string }).liquidationPrice);
    expect(Number(after.price), 'the price the schedule applied crossed it').toBeLessThanOrEqual(
      liquidation,
    );
    expect(
      decimal(micros(after.pools.long) + micros(after.pools.short)),
      "the margin and the fee stay in the perp's pools",
    ).toBe(decimal(micros('2000') + micros(long.margin) + micros(long.fee)));
    expect((await fromPage(trader, 'GET', '/api/v1/me/perps')).body.balance).toBe(
      decimal(STARTING - micros(long.margin) - micros(long.fee)),
    );
  } finally {
    await fromPage(admin, 'POST', `/api/v1/admin/perps/${testPerp}/mode`, {
      mode: 'halted',
      reason,
    });
    await fromPage(admin, 'POST', `/api/v1/admin/perps/${testPerp}/retire`, { reason });
  }
});
