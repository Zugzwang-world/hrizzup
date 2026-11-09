import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { money } from '../../lib/console-format.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { adminState, signedInState, signedOutState } from '../support/states.ts';
import {
  createJourneyAccount,
  deleteJourneyAccount,
  type Engine,
  journeyAddress,
  stagingKeys,
} from '../support/test-accounts.ts';

/**
 * Journey: the markets for everyone in the typed API (PLAN.md step 1.7d), over HTTP as any client
 * calls them, on the pull request's preview (staging's database; the engines' test accounts hold
 * play money from global-setup.ts). It is step 1.7d's done-test:
 * - a signed-in test account lists a test market, buys, retries, sells, places a limit order and
 *   cancels it, and reads its positions and open orders;
 * - bad inputs are refused before the books are touched: a limit outside 1% to 99%, an expiry of
 *   zero, an amount that isn't above zero or is over the balance; so is a write from another site;
 * - the console settles the market, and the payouts add up: the trader gets Ṁ1 a Yes share, the
 *   house the rest, all the market held;
 * - the public list is kept at Vercel's edge, and refreshed when a trade moves the price, well
 *   before the copy it served would have aged out on its own;
 * - each person's trades a minute are limited (on an account made for it, so no other run waits).
 * Each run makes its own market on staging, with a question that says so; it stays, settled.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;
const onVercel = () => ['preview', 'staging', 'production'].includes(environment() ?? '');

/** How long the list's edge copies live (the contract's `markets.list`). */
const EDGE_SECONDS = 60;

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

type Answer = { status: number; body: Record<string, unknown>; headers: Record<string, string> };

async function call(
  as: APIRequestContext,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
): Promise<Answer> {
  const response = await as.fetch(path, { method, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  return {
    status: response.status(),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers(),
  };
}

/** Asks again every half a second until `found` gives something, or `seconds` pass. */
async function eventually<T>(
  seconds: number,
  found: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const value = await found();
    if (value !== undefined || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

type Listed = { market: { id: string; state: string; kind: string }; probability: string | null };

const listedIn = (answer: Answer, id: string) =>
  (answer.body.markets as Listed[] | undefined)?.find((item) => item.market.id === id);

test.describe('the markets for everyone', () => {
  test.skip(() => environment() === 'production', 'No test accounts on production until launch');
  // Staging's firewall challenges a write to the typed API from anything but a browser (Vercel's
  // Security Checkpoint); previews, where the checks run, have no such rule.
  test.skip(
    () => environment() === 'staging',
    "Staging's firewall lets only browsers write to the typed API",
  );

  test('a signed-in person lists a test market, trades it, reads their positions, and the console settles it, the payouts adding up', async ({
    playwright,
    request,
    browser,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(300_000);
    const at = (state: string) =>
      playwright.request.newContext({ ...(baseURL ? { baseURL } : {}), storageState: state });
    const admin = await at(adminState(browserName));
    const trader = await at(signedInState(browserName));

    // The admin makes a test market and opens it, through the console's calls.
    const id = newRecordId();
    const made = await call(admin, 'POST', '/api/v1/admin/markets', {
      id,
      question: `Trading journey (${browserName}, ${id.slice(-6)}): will the test desk record event T?`,
      categories: ['general'],
      rules: 'A test market for the trading journey.\nYes wins if the test desk records event T.',
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(made.status).toBe(201);
    expect((await call(admin, 'POST', `/api/v1/admin/markets/${id}/open`)).body).toMatchObject({
      state: 'open',
    });

    // Anyone sees it in the list: opening it cleared the list's edge copies, so it shows within
    // seconds.
    const listed = await eventually(20, async () =>
      listedIn(await call(request, 'GET', '/api/v1/markets'), id),
    );
    expect(listed, 'the new market is in the public list').toMatchObject({
      market: { id, state: 'open', kind: 'yes_no' },
      probability: '0.50000000',
    });

    // The list is kept at the edge: a second read comes from it.
    let ageAtHit = 0;
    if (onVercel()) {
      const again = await call(request, 'GET', '/api/v1/markets');
      expect(again.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
      expect(again.headers['x-vercel-cache'], 'the second read comes from the edge').toMatch(
        /^(HIT|STALE)$/,
      );
      ageAtHit = Number(again.headers.age ?? '0');
      expect(ageAtHit, "the edge's copy is young enough to show a refresh").toBeLessThan(30);
    }

    // The trader's balance before: play money from global-setup.ts.
    const start = await call(trader, 'GET', '/api/v1/me/positions');
    expect(start.status).toBe(200);
    expect(start.headers['cache-control']).toBe('private, no-store');
    const balance0 = micros(String(start.body.balance));
    expect(balance0, 'the test account has play money').toBeGreaterThanOrEqual(micros('1000'));

    // Buys Ṁ10 of Yes, with a request ID of its own.
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
    expect(bought.headers['cache-control']).toBe('private, no-store');
    expect(bought.body).toMatchObject({
      status: 'filled',
      requestId: purchase.requestId,
      marketId: id,
      outcome: 'yes',
      amount: '10.000000',
      probBefore: '0.50000000',
      balance: decimal(balance0 - micros('10')),
    });
    const probAfter = String(bought.body.probAfter);
    expect(Number(probAfter)).toBeGreaterThan(0.5);

    // The list shows the new price within seconds: the trade cleared its edge copies, well before
    // the copy it served would have aged out on its own.
    const refreshed = await eventually(EDGE_SECONDS, async () => {
      const item = listedIn(await call(request, 'GET', '/api/v1/markets'), id);
      return item?.probability === probAfter ? item : undefined;
    });
    expect(refreshed, "the list shows the trade's price").toBeTruthy();
    const refreshedAfter = (Date.now() - tradedAt) / 1000;
    if (onVercel()) {
      expect(
        refreshedAfter + ageAtHit,
        'refreshed before the old copy would have expired',
      ).toBeLessThan(EDGE_SECONDS);
    }

    // The same request again answers the same, and trades nothing more.
    const retried = await call(trader, 'POST', '/api/v1/trades', purchase);
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual(bought.body);
    const afterRetry = await call(trader, 'GET', '/api/v1/me/positions');
    expect(afterRetry.body.balance).toBe(decimal(balance0 - micros('10')));

    // Bad inputs are refused before the books are touched.
    const fresh = (changes: Record<string, unknown>) => ({
      ...purchase,
      requestId: randomUUID(),
      ...changes,
    });
    for (const [what, sent] of [
      ['a limit of 0.5%', fresh({ limitProb: '0.005' })],
      ['a limit of 99.5%', fresh({ limitProb: '0.995' })],
      ['an expiry of zero', fresh({ limitProb: '0.4', expiresAt: '1970-01-01T00:00:00Z' })],
      ['an expiry of the number zero', fresh({ limitProb: '0.4', expiresAt: 0 })],
      ['an amount of zero', fresh({ amount: '0' })],
      ['an amount below zero', fresh({ amount: '-5' })],
    ] as const) {
      const refused = await call(trader, 'POST', '/api/v1/trades', sent);
      expect(refused.status, what).toBe(400);
      expect(refused.body.code, what).toBe('BAD_REQUEST');
    }
    const tooMuch = fresh({ amount: decimal(balance0) });
    const overBalance = await call(trader, 'POST', '/api/v1/trades', tooMuch);
    expect(overBalance.status).toBe(422);
    expect(overBalance.body).toMatchObject({
      code: 'REFUSED',
      defined: true,
      data: { reason: 'insufficient_balance' },
    });
    // Nothing was written under that request ID: the same ID still trades, once affordable.
    const affordable = await call(trader, 'POST', '/api/v1/trades', { ...tooMuch, amount: '1' });
    expect(affordable.status, 'the refused request left nothing in the books').toBe(200);
    expect(affordable.body).toMatchObject({ status: 'filled', requestId: tooMuch.requestId });
    expect((await call(request, 'POST', '/api/v1/trades', fresh({}))).status).toBe(401);
    // A write from another site's page, riding on the session cookie, is refused before it runs.
    const forged = await trader.fetch('/api/v1/trades', {
      method: 'POST',
      data: fresh({}),
      headers: { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(forged.status(), 'a cross-site write is refused').toBe(403);
    expect(
      (await call(trader, 'POST', '/api/v1/trades', fresh({ marketId: newRecordId() }))).status,
    ).toBe(404);

    // Sells half of its Yes shares.
    const held = micros(String((affordable.body.position as { yes: string }).yes));
    const selling = decimal(held / 2n);
    const sold = await call(trader, 'POST', '/api/v1/trades', {
      marketId: id,
      requestId: randomUUID(),
      action: 'sell',
      outcome: 'yes',
      shares: selling,
    });
    expect(sold.status).toBe(200);
    expect(sold.body).toMatchObject({ status: 'filled', shares: `-${selling}` });
    expect(micros(String(sold.body.amount))).toBeLessThan(0n);
    const overShares = await call(trader, 'POST', '/api/v1/trades', {
      marketId: id,
      requestId: randomUUID(),
      action: 'sell',
      outcome: 'yes',
      shares: decimal(held),
    });
    expect(overShares).toMatchObject({
      status: 422,
      body: { data: { reason: 'not_enough_shares' } },
    });

    // A limit order: Ṁ5 more of Yes only at 20% or lower, which rests; then it's cancelled.
    const limit = await call(trader, 'POST', '/api/v1/trades', {
      marketId: id,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'yes',
      amount: '5',
      limitProb: '0.2',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(limit.status).toBe(200);
    expect(limit.body).toMatchObject({
      status: 'resting',
      amount: '0.000000',
      limitProb: '0.20000000',
    });
    const orderId = String(limit.body.tradeId);
    const open = await call(trader, 'GET', '/api/v1/me/orders');
    expect(open.headers['cache-control']).toBe('private, no-store');
    expect(open.body.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: orderId, marketId: id, orderAmount: '5.000000' }),
      ]),
    );
    const cancel = { marketId: id, orderId, requestId: randomUUID() };
    const cancelled = await call(trader, 'POST', '/api/v1/orders/cancel', cancel);
    expect(cancelled).toMatchObject({ status: 200, body: { status: 'cancelled', orderId } });
    const afterCancel = await call(trader, 'GET', '/api/v1/me/orders');
    expect((afterCancel.body.orders as { id: string }[]).map((o) => o.id)).not.toContain(orderId);
    const twice = await call(trader, 'POST', '/api/v1/orders/cancel', {
      ...cancel,
      requestId: randomUUID(),
    });
    expect(twice).toMatchObject({ status: 422, body: { data: { reason: 'no_open_order' } } });

    // Its positions: the Yes shares it kept, at the market's price now.
    const portfolio = await call(trader, 'GET', '/api/v1/me/positions');
    const mine = (portfolio.body.positions as { marketId: string; yes: string; no: string }[]).find(
      (p) => p.marketId === id,
    );
    const kept = micros(String((sold.body.position as { yes: string }).yes));
    expect(mine).toMatchObject({ yes: decimal(kept), no: '0.000000', state: 'open' });
    const balanceBeforeSettling = micros(String(portfolio.body.balance));

    // The console settles it Yes, in a browser, as the admin.
    const context = await browser.newContext({ storageState: adminState(browserName) });
    const page = await context.newPage();
    await page.goto(`/console/markets/${id}`);
    await page.getByRole('button', { name: 'Close the market' }).click();
    await expect(page.getByTestId('market-state')).toHaveText('Closed');
    const closed = await call(admin, 'GET', `/api/v1/admin/markets/${id}`);
    const heldAtClose = micros(String(closed.body.held));
    await page.getByRole('radio', { name: /^Yes/ }).check();
    await page.getByLabel('Evidence').fill('The test desk recorded event T (the trading journey).');
    await page.getByRole('button', { name: 'Settle the market' }).click();
    await expect(page.getByTestId('market-state')).toHaveText('Settled');
    // The payouts add up: Ṁ1 a Yes share to the one trader, the rest to the house, all it held.
    await expect(page.getByTestId('settlement-paid')).toHaveText(
      `${money(decimal(kept))} to 1 person, and ${money(decimal(heldAtClose - kept))} to the house: all the market held`,
    );
    await context.close();
    const settled = await call(admin, 'GET', `/api/v1/admin/markets/${id}`);
    const sums = (settled.body.log as { settlement: Record<string, string> | null }[]).at(
      -1,
    )?.settlement;
    expect(sums).toMatchObject({ outcome: 'yes', people: 1, paidToPeople: decimal(kept) });
    expect(micros(String(sums?.paidToPeople)) + micros(String(sums?.toHouse))).toBe(heldAtClose);

    // The trader has been paid Ṁ1 a Yes share, and the market has left its positions.
    const paid = await call(trader, 'GET', '/api/v1/me/positions');
    expect(paid.body.balance).toBe(decimal(balanceBeforeSettling + kept));
    expect((paid.body.positions as { marketId: string }[]).map((p) => p.marketId)).not.toContain(
      id,
    );

    // The list shows it settled, with what won.
    const done = await eventually(EDGE_SECONDS, async () => {
      const item = listedIn(await call(request, 'GET', '/api/v1/markets'), id);
      return item?.market.state === 'settled' ? item : undefined;
    });
    expect(done).toMatchObject({ market: { result: 'yes' }, probability: null });
    console.log(
      `DONE-TEST (${browserName}, ${environment()}): market ${id}: listed; bought Ṁ10 of Yes (50% to ${(Number(probAfter) * 100).toFixed(2)}%), retried, sold half, a limit order rested and was cancelled; bad inputs refused; the list ${onVercel() ? `was served from the edge (copy ${ageAtHit} s old) and refreshed ${refreshedAfter.toFixed(1)} s after the trade` : 'read (no edge here)'}; settled Yes: ${decimal(kept)} to the trader, ${decimal(heldAtClose - kept)} to the house, all ${decimal(heldAtClose)} it held`,
    );
    await admin.dispose();
    await trader.dispose();
  });

  test("each person's trades a minute are limited, and the call says when to try again", async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(180_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    // An account of its own, so using up a minute of trading holds up no other run.
    const email = journeyAddress('trade', browserName as Engine);
    await createJourneyAccount(keys, email);
    try {
      const admin = createClient(keys.url, keys.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const app = createClient(keys.url, keys.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      const { data: session } = await app.auth.verifyOtp({
        token_hash: data.properties?.hashed_token ?? '',
        type: 'magiclink',
      });
      const token = session.session?.access_token;
      expect(token, 'a session for the journey account').toBeTruthy();
      const person = await playwright.request.newContext({
        ...(baseURL ? { baseURL } : {}),
        storageState: signedOutState(browserName),
        extraHTTPHeaders: { authorization: `Bearer ${token}` },
      });
      // Trades in a market that doesn't exist: each is counted, then answered "no such market",
      // with nothing written anywhere. The window slides, so if the calls cross a minute's
      // boundary the limit can let a few more through: it must stop one by the 40th.
      const nowhere = newRecordId();
      const answers: Answer[] = [];
      for (let n = 0; n < 40; n++) {
        const answer = await call(person, 'POST', '/api/v1/trades', {
          marketId: nowhere,
          requestId: randomUUID(),
          action: 'buy',
          outcome: 'yes',
          amount: '1',
        });
        answers.push(answer);
        if (answer.status === 429) break;
      }
      const statuses = answers.map((answer) => answer.status);
      expect(statuses.slice(0, 30), 'the first 30 in a minute go through').toEqual(
        Array(30).fill(404),
      );
      const limited = answers.at(-1) as Answer;
      expect(limited.status, 'a call over 30 a minute waits').toBe(429);
      expect(limited.body).toMatchObject({ code: 'TOO_MANY_REQUESTS', defined: true });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
      expect(limited.headers['cache-control']).toBe('private, no-store');
      await person.dispose();
    } finally {
      await deleteJourneyAccount(keys, email);
    }
  });
});
