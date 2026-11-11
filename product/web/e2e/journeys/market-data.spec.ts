import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { call, micros, settleAndCheckBooks } from '../support/books.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: the public API's market data (PLAN.md steps 3.5c and 3.4b's reads; 3.5c's done-test in
 * miniature), over HTTP as a bot calls it, with no key and nobody signed in, on the pull request's
 * preview (staging's database). In the run's own unlisted test market: a quote for Ṁ25 of Yes, then
 * the trade with the same figures, which fills exactly as quoted, to the millionth; a quote for a
 * sale of those shares, then the sale; one market, its history, its resting orders and its latest
 * trades, each answering, naming nobody; our own Bitcoin price and its history; the perp's quote; and
 * the market's books adding up. Each run on its own (CLAUDE.md, "How checks behave").
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

test.describe('the market data', () => {
  test.skip(() => environment() === 'production', "Production's API opens at launch");

  test('a quote matches its trade to the millionth; every read answers anyone, naming nobody; the books add up', async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(180_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;
    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    // Anyone: no session, no key (and Vercel's bypass on a preview).
    const anyone = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    const { email, as: person } = await newRunTrader(keys, playwright, baseURL, engine, 'data');

    // The run's own market, unlisted.
    const marketId = newRecordId();
    const made = await call(admin, 'POST', '/api/v1/admin/markets', {
      id: marketId,
      question:
        `Data journey (${engine}, run ${runKey()}): will the test desk record event Q?`.slice(
          0,
          120,
        ),
      categories: ['general'],
      rules: `A test market of check run ${runKey()}, the market data journey's.\nIt settles as the journey decides.`,
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      listed: false,
    });
    expect(made.status, 'the console makes the test market').toBe(201);
    expect((await call(admin, 'POST', `/api/v1/admin/markets/${marketId}/open`)).status).toBe(200);
    const start = micros(
      String((await call(person, 'GET', '/api/v1/me/positions')).body.balance ?? '0'),
    );

    // A quote, then the trade with the same figures: exactly as quoted.
    const quote = await call(
      anyone,
      'GET',
      `/api/v1/markets/${marketId}/quote?outcome=yes&amount=25`,
    );
    expect(quote.status, 'a quote, with no key').toBe(200);
    expect(quote.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(quote.body).toMatchObject({
      marketId,
      action: 'buy',
      outcome: 'yes',
      status: 'filled',
      amount: '25.000000',
      probBefore: '0.50000000',
    });
    const traded = await call(person, 'POST', '/api/v1/trades', {
      marketId,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'yes',
      amount: '25',
    });
    expect(traded.status, 'the trade').toBe(200);
    for (const field of ['status', 'amount', 'shares', 'orderAmount', 'probBefore', 'probAfter']) {
      expect(traded.body[field], `the trade's ${field}, as quoted`).toBe(quote.body[field]);
    }
    expect(quote.body.payout).toBe(traded.body.shares);

    // A quote for selling half those shares, then the sale. The trade cleared the quote's edge copy.
    const half = micros(String(traded.body.shares)) / 2n;
    const halfText = `${half / 1_000_000n}.${(half % 1_000_000n).toString().padStart(6, '0')}`;
    const saleQuote = await call(
      anyone,
      'GET',
      `/api/v1/markets/${marketId}/quote?action=sell&outcome=yes&shares=${halfText}`,
    );
    expect(saleQuote.status, 'a sale quote').toBe(200);
    expect(saleQuote.body.probBefore, 'quoted on the market as the trade left it').toBe(
      traded.body.probAfter,
    );
    const sold = await call(person, 'POST', '/api/v1/trades', {
      marketId,
      requestId: randomUUID(),
      action: 'sell',
      outcome: 'yes',
      shares: halfText,
    });
    expect(sold.status, 'the sale').toBe(200);
    for (const field of ['amount', 'shares', 'probBefore', 'probAfter']) {
      expect(sold.body[field], `the sale's ${field}, as quoted`).toBe(saleQuote.body[field]);
    }

    // A limit order that rests, for the book.
    const resting = await call(person, 'POST', '/api/v1/trades', {
      marketId,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'no',
      amount: '5',
      limitProb: '0.9',
    });
    expect(resting.body.status, 'a limit order rests').toBe('resting');

    // Each read answers anyone, naming nobody.
    const one = await call(anyone, 'GET', `/api/v1/markets/${marketId}`);
    expect(one.status, 'one market').toBe(200);
    expect(one.body.probability).toBe(sold.body.probAfter);
    const history = await call(anyone, 'GET', `/api/v1/markets/${marketId}/history?range=1h`);
    expect(history.status, 'its history').toBe(200);
    expect(
      (history.body.points as { probability: string }[]).map((point) => point.probability),
    ).toEqual(['0.50000000', traded.body.probAfter, sold.body.probAfter, sold.body.probAfter]);
    const book = await call(anyone, 'GET', `/api/v1/markets/${marketId}/book`);
    expect(book.status, 'its book').toBe(200);
    expect(book.body).toMatchObject({
      yes: [],
      no: [{ limitProb: '0.90000000', amount: '5.000000', orders: 1 }],
    });
    const trades = await call(anyone, 'GET', `/api/v1/markets/${marketId}/trades`);
    expect(trades.status, 'its latest trades').toBe(200);
    expect((trades.body.trades as { id: string }[]).map((trade) => trade.id)).toEqual([
      sold.body.tradeId,
      traded.body.tradeId,
    ]);
    const shown = JSON.stringify([quote.body, one.body, history.body, book.body, trades.body]);
    const me = await call(person, 'GET', '/api/v1/me');
    for (const personal of [email, String(me.body.id), String(traded.body.requestId)]) {
      expect(shown, 'no public read names anyone').not.toContain(personal);
    }

    // Our own Bitcoin price, its history, and the perp's quote.
    const price = await call(anyone, 'GET', '/api/v1/prices/btc-usd');
    expect(price.status, "our own price (staging's)").toBe(200);
    expect(price.body).toMatchObject({ feed: 'btc-usd' });
    expect(String(price.body.price)).toMatch(/^\d+\.\d{2}$/);
    const priceHistory = await call(anyone, 'GET', '/api/v1/prices/btc-usd/history?range=1h');
    expect(priceHistory.status, 'its history').toBe(200);
    expect((priceHistory.body.points as unknown[]).length).toBeGreaterThan(0);
    const perps = await call(anyone, 'GET', '/api/v1/perps');
    const bitcoin = (perps.body.perps as { id: string }[])[0];
    expect(bitcoin, 'the Bitcoin perp is listed').toBeDefined();
    const perpQuote = await call(
      anyone,
      'GET',
      `/api/v1/perps/${bitcoin?.id}/quote?direction=long&margin=100&leverage=5`,
    );
    expect([200, 422], "the perp's quote, or its refusal").toContain(perpQuote.status);
    if (perpQuote.status === 200) {
      expect(perpQuote.body).toMatchObject({ size: '500', fee: '0.500000', cost: '100.500000' });
    }

    // The books add up.
    await call(person, 'POST', '/api/v1/orders/cancel', {
      marketId,
      orderId: resting.body.tradeId,
      requestId: randomUUID(),
    });
    await settleAndCheckBooks({
      admin,
      marketId,
      traders: [{ name: 'the trader', as: person, start }],
      settlement: { outcome: 'yes' },
      evidence: `Check run ${runKey()}: the market data journey's market.`,
    });
  });
});
