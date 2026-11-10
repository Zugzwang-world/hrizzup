import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { call, micros, settleAndCheckBooks } from '../support/books.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: bots' API keys (PLAN.md step 3.5a, its done-test), over HTTP as a bot calls the API, on
 * the pull request's preview (staging's database). A fresh account of the run's own makes a
 * read-only key and a trading key while signed in; a bot with the read-only key reads who it is and
 * its positions and is refused a trade; with the trading key it trades in the run's own unlisted
 * test market; no key can make a key; a revoked key is refused within seconds; and the market's
 * books add up, to the millionth. Each run on its own (CLAUDE.md, "How checks behave").
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** A bot: no session, only its key, sent as `Authorization: Bearer` (and Vercel's bypass on a preview). */
async function bot(
  playwright: { request: { newContext: (options: object) => Promise<APIRequestContext> } },
  baseURL: string | undefined,
  engine: Engine,
  key: string,
): Promise<APIRequestContext> {
  const signedOut = JSON.parse(await readFile(signedOutState(engine), 'utf8')) as object;
  return playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: signedOut,
    extraHTTPHeaders: { authorization: `Bearer ${key}` },
  });
}

test.describe("bots' API keys", () => {
  test.skip(() => environment() === 'production', 'Keys work only on staging until launch');

  test('a read-only key reads and is refused a trade, a trading key trades, no key makes a key, a revoked key is refused within seconds; the books add up', async ({
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
    const { as: person } = await newRunTrader(keys, playwright, baseURL, engine, 'keys');

    // Signed in, the person makes a read-only key and a trading key, each shown once.
    const madeRead = await call(person, 'POST', '/api/v1/me/keys', {
      name: `Reader (run ${runKey()})`.slice(0, 60),
      scope: 'read',
    });
    expect(madeRead.status, 'a read-only key is made').toBe(201);
    expect(madeRead.headers['cache-control']).toBe('private, no-store');
    const readKey = String(madeRead.body.secret);
    expect(readKey).toMatch(/^hz_demo_[A-Za-z0-9]{43}$/);
    const madeTrade = await call(person, 'POST', '/api/v1/me/keys', {
      name: `Trader (run ${runKey()})`.slice(0, 60),
      scope: 'trade',
    });
    expect(madeTrade.status, 'a trading key is made').toBe(201);
    const tradeKey = String(madeTrade.body.secret);
    const tradeKeyId = (madeTrade.body.key as { id: string }).id;
    const listed = await call(person, 'GET', '/api/v1/me/keys');
    expect(listed.status).toBe(200);
    const shown = (listed.body.keys as { shown: string; scope: string }[]).map((k) => k.shown);
    expect(shown.sort()).toEqual([readKey.slice(0, 12), tradeKey.slice(0, 12)].sort());
    expect(JSON.stringify(listed.body), 'the list never shows a key itself').not.toContain(readKey);

    // A bot with the read-only key reads who it is and its positions.
    const reader = await bot(playwright, baseURL, engine, readKey);
    const me = await call(reader, 'GET', '/api/v1/me');
    expect(me.status, 'a read-only key reads who it is').toBe(200);
    expect(me.body).toMatchObject({ signedInWith: 'api_key', email: null });
    const held = await call(reader, 'GET', '/api/v1/me/positions');
    expect(held.status, 'a read-only key reads its positions').toBe(200);
    expect(held.body).toEqual({ balance: '1000.000000', positions: [], next: null });

    // The run's own market, unlisted.
    const marketId = newRecordId();
    const made = await call(admin, 'POST', '/api/v1/admin/markets', {
      id: marketId,
      question:
        `Keys journey (${engine}, run ${runKey()}): will the test desk record event K?`.slice(
          0,
          120,
        ),
      categories: ['general'],
      rules: `A test market of check run ${runKey()}, the keys journey's.\nIt settles as the journey decides.`,
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      listed: false,
    });
    expect(made.status, 'the console makes the test market').toBe(201);
    const opened = await call(admin, 'POST', `/api/v1/admin/markets/${marketId}/open`);
    expect(opened.body).toMatchObject({ state: 'open' });

    const buy = () => ({
      marketId,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'yes',
      amount: '10',
    });
    const refusedTrade = await call(reader, 'POST', '/api/v1/trades', buy());
    expect(refusedTrade.status, 'a read-only key is refused a trade').toBe(403);
    expect(refusedTrade.body).toMatchObject({ code: 'FORBIDDEN' });

    // A bot with the trading key trades.
    const trader = await bot(playwright, baseURL, engine, tradeKey);
    const traded = await call(trader, 'POST', '/api/v1/trades', buy());
    expect(traded.status, 'a trading key trades').toBe(200);
    expect(traded.body).toMatchObject({
      status: 'filled',
      amount: '10.000000',
      balance: '990.000000',
    });

    // No key makes or revokes a key, not even a trading one.
    const keyMakesKey = await call(trader, 'POST', '/api/v1/me/keys', {
      name: 'Sneaky',
      scope: 'trade',
    });
    expect(keyMakesKey.status, 'a key cannot make a key').toBe(403);
    const keyRevokes = await call(trader, 'POST', `/api/v1/me/keys/${tradeKeyId}/revoke`);
    expect(keyRevokes.status, 'a key cannot revoke a key').toBe(403);

    // Revoked, the trading key is refused within seconds.
    const revoked = await call(person, 'POST', `/api/v1/me/keys/${tradeKeyId}/revoke`);
    expect(revoked.status, 'the person revokes the trading key').toBe(200);
    const revokedAt = Date.now();
    const afterRevoke = await call(trader, 'GET', '/api/v1/me/positions');
    const tradeAfterRevoke = await call(trader, 'POST', '/api/v1/trades', buy());
    const seconds = (Date.now() - revokedAt) / 1000;
    expect(afterRevoke.status, 'a revoked key reads nothing').toBe(401);
    expect(tradeAfterRevoke.status, 'a revoked key trades nothing').toBe(401);
    expect(seconds, 'refused within seconds').toBeLessThan(10);

    // The read-only key still works, then goes too: the person's keys end revoked.
    const still = await call(reader, 'GET', '/api/v1/me/positions');
    expect(still.status).toBe(200);
    const readKeyId = (madeRead.body.key as { id: string }).id;
    expect((await call(person, 'POST', `/api/v1/me/keys/${readKeyId}/revoke`)).status).toBe(200);
    expect((await call(person, 'GET', '/api/v1/me/keys')).body).toEqual({ keys: [] });

    // The market's books add up, to the millionth.
    await settleAndCheckBooks({
      admin,
      marketId,
      traders: [{ name: 'the bot', as: person, start: micros('1000') }],
      settlement: { outcome: 'yes' },
      evidence: `The keys journey of check run ${runKey()} settled it Yes.`,
    });
    await Promise.all([admin.dispose(), person.dispose(), reader.dispose(), trader.dispose()]);
  });
});
