import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { money } from '../../lib/console-format.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { call, decimal, holdings, micros, settleAndCheckBooks } from '../support/books.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';
import { environment, refusedFor, runMarket, STARTING, trade } from '../support/trading.ts';

/**
 * Journey: the markets for everyone in the typed API (PLAN.md step 1.7d), over HTTP as any client
 * calls them, on the pull request's preview (staging's database), the one whose last step opens the
 * console in a browser (so it runs in both browsers; the calls that never open one are in
 * trading-api-calls.spec.ts, and run once). Each check run on its own (CLAUDE.md, "How checks
 * behave"): this journey makes its own fresh account, starting with exactly the Ṁ1,000 its signup
 * gave it, and its own test market, unlisted, so it stays off staging's public list, and trades
 * only there; the console's admin test account is used only for that market. It ends by checking
 * the market's books add up, to the millionth (support/books.ts): one trader buys, retries
 * (getting the first answer), sells, places a limit order that rests, sees it among their open
 * orders and cancels it, reads their positions, and has every bad input refused, nothing written;
 * the public list never shows the run's market, is kept at Vercel's edge, and refreshes after the
 * trade; the console's own form settles it Yes.
 */

const onVercel = () => ['preview', 'staging', 'production'].includes(environment() ?? '');

/** How long the list's edge copies live (the contract's `markets.list`). */
const EDGE_SECONDS = 60;

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

type Listed = { market: { id: string } };

/** Whether any page of the public list shows the market. */
async function onTheList(as: APIRequestContext, id: string): Promise<boolean> {
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const answer = await call(as, 'GET', `/api/v1/markets${after ? `?cursor=${after}` : ''}`);
    expect(answer.status, 'the public list answers').toBe(200);
    if ((answer.body.markets as Listed[]).some((item) => item.market.id === id)) return true;
    after = (answer.body.next as string | null) ?? null;
    if (!after) return false;
  }
  return false;
}

test.describe('the markets for everyone', () => {
  test.skip(() => environment() === 'production', 'No test accounts on production until launch');
  // Staging's firewall challenges a write to the typed API from anything but a browser (Vercel's
  // Security Checkpoint); previews, where the checks run, have no such rule.
  test.skip(
    () => environment() === 'staging',
    "Staging's firewall lets only browsers write to the typed API",
  );

  test('a trader of its own lists, buys, retries, sells, places and cancels a limit order, reads their positions, is refused every bad input; the console settles it Yes in its form; the books add up', async ({
    playwright,
    request,
    browser,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(300_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;
    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    const { as: trader } = await newRunTrader(keys, playwright, baseURL, engine, 'trade-one');
    const id = await runMarket(admin, browserName, 'will the test desk record event T');

    // The run's market stays off the public list, which is kept at Vercel's edge.
    expect(await onTheList(request, id), "the run's market is never on the public list").toBe(
      false,
    );
    let ageAtHit = 0;
    if (onVercel()) {
      // Opening the market marked the list's edge copies stale, so a young copy is served from
      // the edge within seconds (other runs' trades refresh it too: the list is everyone's).
      const again = await eventually(20, async () => {
        const answer = await call(request, 'GET', '/api/v1/markets');
        return answer.headers['x-vercel-cache'] === 'HIT' && Number(answer.headers.age ?? '0') < 10
          ? answer
          : undefined;
      });
      expect(again, 'a young copy is served from the edge').toBeTruthy();
      expect(again?.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
      ageAtHit = Number(again?.headers.age ?? '0');
    }

    // A fresh account: exactly the starting balance its signup gave it, and no positions.
    const start = await call(trader, 'GET', '/api/v1/me/positions');
    expect(start.status).toBe(200);
    expect(start.headers['cache-control']).toBe('private, no-store');
    expect(start.body).toEqual({ balance: '1000.000000', positions: [], next: null });

    // Buys Ṁ10 of Yes, with a request ID of its own.
    const purchase = { requestId: randomUUID(), action: 'buy', outcome: 'yes', amount: '10' };
    const tradedAt = Date.now();
    const bought = await trade(trader, id, purchase);
    expect(bought.status).toBe(200);
    expect(bought.headers['cache-control']).toBe('private, no-store');
    expect(bought.body).toMatchObject({
      status: 'filled',
      requestId: purchase.requestId,
      marketId: id,
      outcome: 'yes',
      amount: '10.000000',
      probBefore: '0.50000000',
      balance: '990.000000',
    });
    expect(Number(bought.body.probAfter)).toBeGreaterThan(0.5);

    // The trade marked the list's edge copies stale, so a fresh copy is served within seconds,
    // well before the copy it served would have aged out on its own.
    let refreshedAfter = 0;
    if (onVercel()) {
      const fresh = await eventually(EDGE_SECONDS, async () => {
        const answer = await call(request, 'GET', '/api/v1/markets');
        const age = Number(answer.headers.age ?? '0');
        const since = (Date.now() - tradedAt) / 1000;
        return /^(HIT|MISS)$/.test(answer.headers['x-vercel-cache'] ?? '') && age < since
          ? answer
          : undefined;
      });
      expect(fresh, 'the list was refreshed after the trade').toBeTruthy();
      refreshedAfter = (Date.now() - tradedAt) / 1000;
      expect(
        refreshedAfter + ageAtHit,
        'refreshed before the old copy would have expired',
      ).toBeLessThan(EDGE_SECONDS);
    }

    // The same request again answers the same, and trades nothing more.
    const retried = await call(trader, 'POST', '/api/v1/trades', { marketId: id, ...purchase });
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual(bought.body);
    expect((await holdings(trader, id)).balance).toBe(micros('990'));

    // Bad inputs are refused before the books are touched.
    for (const [what, sent] of [
      ['a limit of 0.5%', { limitProb: '0.005' }],
      ['a limit of 99.5%', { limitProb: '0.995' }],
      ['an expiry of zero', { limitProb: '0.4', expiresAt: '1970-01-01T00:00:00Z' }],
      ['an expiry of the number zero', { limitProb: '0.4', expiresAt: 0 }],
      ['an amount of zero', { amount: '0' }],
      ['an amount below zero', { amount: '-5' }],
    ] as const) {
      const refused = await trade(trader, id, {
        action: 'buy',
        outcome: 'yes',
        amount: '1',
        ...sent,
      });
      expect(refused.status, what).toBe(400);
      expect(refused.body.code, what).toBe('BAD_REQUEST');
    }
    const tooMuch = {
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'yes',
      amount: '990.000001',
    };
    expect(
      await call(trader, 'POST', '/api/v1/trades', { marketId: id, ...tooMuch }),
    ).toMatchObject(refusedFor('insufficient_balance'));
    // Nothing was written under that request ID: the same ID still trades, once affordable.
    const affordable = await call(trader, 'POST', '/api/v1/trades', {
      marketId: id,
      ...tooMuch,
      amount: '1',
    });
    expect(affordable.status, 'the refused request left nothing in the books').toBe(200);
    expect(affordable.body).toMatchObject({
      status: 'filled',
      requestId: tooMuch.requestId,
      balance: '989.000000',
    });
    const signedOut = await trade(request, id, { action: 'buy', outcome: 'yes', amount: '1' });
    expect(signedOut.status, 'signed out').toBe(401);
    // A write from another site's page, riding on the session cookie, is refused before it runs.
    const forged = await trader.fetch('/api/v1/trades', {
      method: 'POST',
      data: { marketId: id, requestId: randomUUID(), action: 'buy', outcome: 'yes', amount: '1' },
      headers: { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(forged.status(), 'a cross-site write is refused').toBe(403);
    const nowhere = await trade(trader, newRecordId(), {
      action: 'buy',
      outcome: 'yes',
      amount: '1',
    });
    expect(nowhere.status, 'no such market').toBe(404);
    expect((await holdings(trader, id)).balance, 'none of them moved any money').toBe(
      micros('989'),
    );

    // Sells half of its Yes shares; more than it holds is refused.
    const held = micros(String((affordable.body.position as { yes: string }).yes));
    const selling = decimal(held / 2n);
    const sold = await trade(trader, id, { action: 'sell', outcome: 'yes', shares: selling });
    expect(sold.status).toBe(200);
    expect(sold.body).toMatchObject({ status: 'filled', shares: `-${selling}` });
    expect(micros(String(sold.body.amount))).toBeLessThan(0n);
    expect(
      await trade(trader, id, { action: 'sell', outcome: 'yes', shares: decimal(held) }),
    ).toMatchObject(refusedFor('not_enough_shares'));

    // A limit order: Ṁ5 more of Yes only at 20% or lower, which rests; then it's cancelled.
    const limit = await trade(trader, id, {
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
    expect(open.body.orders).toEqual([
      expect.objectContaining({ id: orderId, marketId: id, orderAmount: '5.000000' }),
    ]);
    const cancel = { marketId: id, orderId, requestId: randomUUID() };
    expect(await call(trader, 'POST', '/api/v1/orders/cancel', cancel)).toMatchObject({
      status: 200,
      body: { status: 'cancelled', orderId },
    });
    expect((await call(trader, 'GET', '/api/v1/me/orders')).body.orders).toEqual([]);
    expect(
      await call(trader, 'POST', '/api/v1/orders/cancel', { ...cancel, requestId: randomUUID() }),
    ).toMatchObject(refusedFor('no_open_order'));

    // Its positions: the Yes shares it kept, at the market's price now.
    const kept = micros(String((sold.body.position as { yes: string }).yes));
    const portfolio = await call(trader, 'GET', '/api/v1/me/positions');
    expect(portfolio.body.positions).toEqual([
      expect.objectContaining({ marketId: id, yes: decimal(kept), no: '0.000000', state: 'open' }),
    ]);

    // The console settles it Yes in its own form, in a browser, as the admin; the books add up.
    const { paid, heldAtClose } = await settleAndCheckBooks({
      admin,
      marketId: id,
      traders: [{ name: 'the trader', as: trader, start: STARTING }],
      settlement: { outcome: 'yes' },
      evidence: 'The test desk recorded event T (the trading journey).',
      settleWith: async (heldAtClose) => {
        const context = await browser.newContext({ storageState: adminState(browserName) });
        const page = await context.newPage();
        await page.goto(`/console/markets/${id}`);
        await expect(page.getByTestId('market-state')).toHaveText('Closed');
        await expect(page.getByTestId('market-listed')).toContainText('Unlisted');
        await page.getByRole('radio', { name: /^Yes/ }).check();
        await page
          .getByLabel('Evidence')
          .fill('The test desk recorded event T (the trading journey).');
        await page.getByRole('button', { name: 'Settle the market' }).click();
        await expect(page.getByTestId('market-state')).toHaveText('Settled');
        // Ṁ1 a Yes share to the one trader, the rest to the house: all the market held.
        await expect(page.getByTestId('settlement-paid')).toHaveText(
          `${money(decimal(kept))} to 1 person, and ${money(decimal(heldAtClose - kept))} to the house: all the market held`,
        );
        await context.close();
      },
    });
    expect(paid.get('the trader')).toBe(kept);
    expect(await onTheList(request, id), 'still off the public list once settled').toBe(false);
    console.log(
      `DONE-TEST (${browserName}, ${environment()}, run ${runKey()}): market ${id}, unlisted: bought Ṁ10 of Yes, retried, sold half, a limit order rested and was cancelled; every bad input refused; ${onVercel() ? `the list came from the edge and refreshed ${refreshedAfter.toFixed(1)} s after the trade` : 'the list read (no edge here)'}; settled Yes in the console's form: ${decimal(kept)} to the trader, ${decimal(heldAtClose - kept)} to the house, all ${decimal(heldAtClose)} it held, to the millionth`,
    );
    await admin.dispose();
    await trader.dispose();
  });
});
