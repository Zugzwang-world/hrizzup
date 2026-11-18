import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { describeApiOnly, expect, test } from '../support/api-only.ts';
import {
  type Answer,
  call,
  decimal,
  holdings,
  micros,
  settleAndCheckBooks,
  type Trader,
} from '../support/books.ts';
import { newRunTrader } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';
import { environment, refusedFor, runMarket, STARTING, trade } from '../support/trading.ts';

/**
 * Journey: the markets for everyone in the typed API (PLAN.md step 1.7d), the calls that never
 * open a browser: over HTTP as any client calls them, on the pull request's preview (staging's
 * database). They run once, in Chromium (support/api-only.ts; the Screen check), where the journey
 * that opens the console's form in a browser (trading-api.spec.ts) runs in both browsers. Each
 * check run on its own (CLAUDE.md, "How checks behave"): every journey here makes its own fresh
 * accounts, each starting with exactly the Ṁ1,000 its signup gave it, and its own test markets,
 * unlisted, so they stay off staging's public list, and trades only there; the console's admin
 * test account is used only for those markets. Each ends by checking its markets' books add up, to
 * the millionth (support/books.ts):
 * - two traders, one's limit order filled by the other's trade, settled No; then at a set
 *   probability; then cancelled, taking back a sale's profit; then refused at a market's edges: at
 *   its price limit, past its closing time, once closed, on a draft, and a request ID sent again
 *   for another request;
 * - each person's trades a minute are limited.
 */

describeApiOnly('the markets for everyone, by calls alone', () => {
  test.skip(() => environment() === 'production', 'No test accounts on production until launch');
  // Staging's firewall challenges a write to the typed API from anything but a browser (Vercel's
  // Security Checkpoint); previews, where the checks run, have no such rule.
  test.skip(
    () => environment() === 'staging',
    "Staging's firewall lets only browsers write to the typed API",
  );

  test('two traders of its own: a limit order filled by the other, settled No; at a set probability; cancelled, taking back a sale profit; refused at a market edges; the books add up each time', async ({
    playwright,
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
    const ann = (await newRunTrader(keys, playwright, baseURL, engine, 'trade-ann')).as;
    const raj = (await newRunTrader(keys, playwright, baseURL, engine, 'trade-raj')).as;
    const balanceOf = async (who: APIRequestContext) => (await holdings(who, '')).balance;
    expect(await balanceOf(ann), "Ann's starting balance").toBe(STARTING);
    expect(await balanceOf(raj), "Raj's starting balance").toBe(STARTING);

    // 1. Settled No. Ann's limit order rests below the price; Raj's trade fills it.
    const no = await runMarket(admin, browserName, 'will event N happen');
    const traders = async (): Promise<Trader[]> => [
      { name: 'Ann', as: ann, start: await balanceOf(ann) },
      { name: 'Raj', as: raj, start: await balanceOf(raj) },
    ];
    const atNo = await traders();
    const resting = await trade(ann, no, {
      action: 'buy',
      outcome: 'yes',
      amount: '20',
      limitProb: '0.4',
    });
    expect(resting.body).toMatchObject({ status: 'resting', limitProb: '0.40000000' });
    // Ṁ300 of No takes the market from 50% to about 37%, past Ann's 40%.
    const pushed = await trade(raj, no, { action: 'buy', outcome: 'no', amount: '300' });
    expect(pushed.body).toMatchObject({ status: 'filled', amount: '300.000000' });
    expect(Number(pushed.body.probAfter)).toBeLessThan(0.4);
    const annNow = await holdings(ann, no);
    const annStart = atNo[0]?.start ?? 0n;
    expect(annNow.yes > 0n, "Raj's trade filled Ann's resting order: she holds Yes").toBe(true);
    expect(annNow.balance < annStart, '... and paid for it, out of her balance').toBe(true);
    expect(await trade(ann, no, { action: 'buy', outcome: 'no', amount: '10' })).toMatchObject({
      status: 200,
      body: { status: 'filled' },
    });
    await settleAndCheckBooks({
      admin,
      marketId: no,
      traders: atNo,
      settlement: { outcome: 'no' },
      evidence: 'The test desk recorded that event N did not happen (the trading journey).',
    });

    // 2. At a set probability: each Yes share 30%, each No share 70%, rounded down once.
    const partly = await runMarket(admin, browserName, 'how much of event P happens');
    const atPartly = await traders();
    const annYes = await trade(ann, partly, { action: 'buy', outcome: 'yes', amount: '30' });
    expect(annYes.body).toMatchObject({ status: 'filled' });
    expect(await trade(raj, partly, { action: 'buy', outcome: 'no', amount: '40' })).toMatchObject({
      body: { status: 'filled' },
    });
    const third = micros(String((annYes.body.position as { yes: string }).yes)) / 3n;
    expect(
      await trade(ann, partly, { action: 'sell', outcome: 'yes', shares: decimal(third) }),
    ).toMatchObject({ body: { status: 'filled' } });
    await settleAndCheckBooks({
      admin,
      marketId: partly,
      traders: atPartly,
      settlement: { outcome: 'probability', probability: '0.3' },
      evidence: 'The test desk recorded 30% of event P (the trading journey).',
    });

    // 3. Cancelled: Ann buys, Raj's buy lifts the price, Ann sells at a profit; the cancel gives
    // each back what they put in less what they took out, so Ann's profit is taken back.
    const called = await runMarket(admin, browserName, 'will event C be recorded at all');
    const atCalled = await traders();
    const annIn = await trade(ann, called, { action: 'buy', outcome: 'yes', amount: '50' });
    expect(annIn.body).toMatchObject({ status: 'filled', amount: '50.000000' });
    expect(
      await trade(raj, called, { action: 'buy', outcome: 'yes', amount: '100' }),
    ).toMatchObject({
      body: { status: 'filled' },
    });
    const annOut = await trade(ann, called, {
      action: 'sell',
      outcome: 'yes',
      shares: String((annIn.body.position as { yes: string }).yes),
    });
    expect(annOut.body).toMatchObject({ status: 'filled' });
    expect(-micros(String(annOut.body.amount)), 'Ann sold at a profit').toBeGreaterThan(
      micros('50'),
    );
    const { paid } = await settleAndCheckBooks({
      admin,
      marketId: called,
      traders: atCalled,
      settlement: { outcome: 'cancel', reason: 'The test desk recorded nothing (the journey).' },
      evidence: 'The test desk recorded nothing about event C (the trading journey).',
    });
    expect((paid.get('Ann') ?? 0n) < 0n, "the cancel takes Ann's sale profit back").toBe(true);

    // 4. Refused at a market's edges, on a market that opens at the 99% limit and closes in 45
    // seconds: Yes can't be bought at all there, since a buy stops at 99%.
    const edge = await runMarket(admin, browserName, 'will event E happen soon', {
      probability: '0.99',
      closesInSeconds: 45,
    });
    const closesAt = Date.parse(
      String((await call(admin, 'GET', `/api/v1/admin/markets/${edge}`)).body.closesAt),
    );
    const atEdge = await traders();
    expect(await trade(ann, edge, { action: 'buy', outcome: 'yes', amount: '1' })).toMatchObject(
      refusedFor('price_limit'),
    );
    const sent = { requestId: randomUUID(), action: 'buy', outcome: 'no', amount: '1' };
    expect((await call(raj, 'POST', '/api/v1/trades', { marketId: edge, ...sent })).status).toBe(
      200,
    );
    const reused = await call(raj, 'POST', '/api/v1/trades', {
      marketId: edge,
      ...sent,
      amount: '2',
    });
    expect(reused.status, 'a request ID sent again for another request').toBe(409);
    const draft = await runMarket(admin, browserName, 'a draft nobody can bet on', { open: false });
    expect(
      (await trade(raj, draft, { action: 'buy', outcome: 'yes', amount: '1' })).status,
      'a draft answers as no market at all',
    ).toBe(404);
    // Past its own closing time, with three seconds to spare for the clocks.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, closesAt + 3000 - Date.now())));
    expect(await trade(raj, edge, { action: 'buy', outcome: 'no', amount: '1' })).toMatchObject(
      refusedFor('market_closed'),
    );
    await settleAndCheckBooks({
      admin,
      marketId: edge,
      traders: atEdge,
      settlement: { outcome: 'yes' },
      evidence: 'The test desk recorded event E (the trading journey).',
    });
    expect(await trade(raj, edge, { action: 'buy', outcome: 'no', amount: '1' })).toMatchObject(
      refusedFor('market_not_open'),
    );
    await admin.dispose();
    await ann.dispose();
    await raj.dispose();
  });

  test("each person's trades a minute are limited, and the call says when to try again", async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(180_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    // An account of its own, so using up a minute of trading holds up no other test or run.
    const { as: person } = await newRunTrader(
      keys,
      playwright,
      baseURL,
      browserName as Engine,
      'trade-limit',
    );
    // Trades in a market that doesn't exist: each is counted, then answered "no such market",
    // with nothing written anywhere. The window slides, so if the calls cross a minute's
    // boundary the limit can let a few more through: it must stop one by the 40th.
    const nowhere = newRecordId();
    const answers: Answer[] = [];
    for (let n = 0; n < 40; n++) {
      const answer = await trade(person, nowhere, { action: 'buy', outcome: 'yes', amount: '1' });
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
    expect((await holdings(person, nowhere)).balance, 'and none of it moved any money').toBe(
      STARTING,
    );
    await person.dispose();
  });
});
