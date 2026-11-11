import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { runBot } from '../../../../examples/bot/bot.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { call, decimal, micros, settleAndCheckBooks } from '../support/books.ts';
import { runPerp, SUBSIDY } from '../support/perps.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: the example bot (PLAN.md step 3.5d's done-test in miniature; examples/bot), run on every
 * pull request's preview so it can't silently break. A fresh account of the run's makes a trading key
 * while signed in; the bot, with only that key, walks through the API on the run's own unlisted market
 * and test perp: reads them, gets a quote, places and cancels a limit order, buys exactly as quoted,
 * sells half, opens a perp position and closes it in two halves, and reads its portfolio; run again
 * once the account holds a position of its own on the perp, it leaves that position exactly as it is. Then every Ṁ:
 * the bot's trades are marked as a key's, the market's books add up once it settles, the perp's pools
 * hold the house's subsidy plus exactly what the bot put in less what it took out, and the account's
 * balance is what all the answers say. Each run on its own (CLAUDE.md, "How checks behave").
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** The standard `fetch`, carried by a Playwright request context (Vercel's bypass on a preview). */
function fetchThrough(context: APIRequestContext): typeof fetch {
  return async (input, init) => {
    const response = await context.fetch(String(input), {
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body === undefined ? {} : { data: String(init.body) }),
    });
    return new Response(await response.text(), {
      status: response.status(),
      headers: response.headers(),
    });
  };
}

test.describe('the example bot', () => {
  test.skip(() => environment() === 'production', 'Keys work only on staging until launch');
  test.skip(
    () => environment() === 'staging',
    "Staging's done-test runs the bot from the Mac (e2e/done); the checks run it on previews",
  );

  test('with a fresh trading key, it reads, quotes, orders, cancels, trades, opens and closes the perp, and reads its portfolio; every Ṁ adds up', async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(240_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;
    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    const anyone = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    const { as: person } = await newRunTrader(keys, playwright, baseURL, engine, 'bot');
    let perpId: string | undefined;
    let keyId: string | undefined;
    try {
      perpId = await runPerp(admin, engine, 'Example bot journey');
      // The run's own market, unlisted.
      const marketId = newRecordId();
      const made = await call(admin, 'POST', '/api/v1/admin/markets', {
        id: marketId,
        question:
          `Bot journey (${engine}, run ${runKey()}): will the test desk record event B?`.slice(
            0,
            120,
          ),
        categories: ['general'],
        rules: `A test market of check run ${runKey()}, the example bot journey's.\nIt settles as the journey decides.`,
        source: { name: "Hrizzup's test desk (a placeholder source)" },
        opensAt: new Date(Date.now() - 60_000).toISOString(),
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        listed: false,
      });
      expect(made.status, 'the console makes the test market').toBe(201);
      expect((await call(admin, 'POST', `/api/v1/admin/markets/${marketId}/open`)).status).toBe(
        200,
      );

      // The account's trading key, made while signed in, shown once.
      const start = micros(
        String((await call(person, 'GET', '/api/v1/me/positions')).body.balance),
      );
      const madeKey = await call(person, 'POST', '/api/v1/me/keys', {
        name: `Example bot (run ${runKey()})`.slice(0, 60),
        scope: 'trade',
      });
      expect(madeKey.status, 'a trading key is made').toBe(201);
      const key = String(madeKey.body.secret);
      keyId = (madeKey.body.key as { id: string }).id;

      // The bot, with only its key.
      const lines: string[] = [];
      const ran = await runBot({
        key,
        api: `${baseURL ?? ''}/api/v1`,
        market: marketId,
        perp: perpId,
        fetch: fetchThrough(anyone),
        log: (line) => lines.push(line),
      });
      expect(lines.join('\n'), 'the bot never prints its key').not.toContain(key);
      expect(lines.at(0)).toMatch(/^Signed in with an API key as account /);
      expect(ran.order.status, 'its limit order rests').toBe('resting');
      expect(ran.cancelled.status, 'and is cancelled').toBe('cancelled');
      expect(
        { shares: ran.bought.shares, probAfter: ran.bought.probAfter },
        'it buys exactly as quoted',
      ).toEqual({ shares: ran.quote.shares, probAfter: ran.quote.probAfter });
      expect(lines.some((line) => line.includes('exactly as quoted'))).toBe(true);
      expect(ran.sold.status).toBe('filled');
      const { opened, closedHalf, closed } = ran;
      if (!opened || !closedHalf || !closed) throw new Error('The bot left the perp alone');
      expect(opened.status).toBe('opened');
      expect(closedHalf.position, 'half its position stays open').not.toBeNull();
      expect(closed.position, 'then none').toBeNull();
      expect(ran.orders.orders, 'no resting orders left').toEqual([]);
      expect(ran.perps.positions, 'no perp positions left').toEqual([]);
      const trades = ran.trades.trades as { id: string; isApi: boolean }[];
      for (const id of [ran.bought.tradeId, ran.sold.tradeId, ran.order.tradeId]) {
        expect(
          trades.find((trade) => trade.id === id)?.isApi,
          `its trade ${id} is marked as a key's`,
        ).toBe(true);
      }

      // The account's own position, opened while signed in: an account holds one position per side,
      // so the bot, run again, must leave it exactly as it is (the founder's run, 11 November 2026,
      // closed his along with the bot's).
      const own = await call(person, 'POST', '/api/v1/perps/open', {
        perpId,
        requestId: randomUUID(),
        direction: 'long',
        margin: '20',
        leverage: '3',
      });
      expect(own.status, 'the account opens a position of its own').toBe(200);
      const ownSize = (own.body.position as { size: string }).size;
      const again: string[] = [];
      const rerun = await runBot({
        key,
        api: `${baseURL ?? ''}/api/v1`,
        market: marketId,
        perp: perpId,
        fetch: fetchThrough(anyone),
        log: (line) => again.push(line),
      });
      expect(rerun.opened, 'the bot opens nothing on top of it').toBeNull();
      expect(again.join('\n')).toContain(`You hold a long of ${ownSize} on this perp already`);
      const held = await call(person, 'GET', '/api/v1/me/perps');
      expect(
        (held.body.positions as { perpId: string; size: string }[]).map((p) => [p.perpId, p.size]),
        "the account's own position is untouched",
      ).toEqual([[perpId, ownSize]]);
      const ownClosed = await call(person, 'POST', '/api/v1/perps/close', {
        perpId,
        requestId: randomUUID(),
        fraction: '1',
      });
      expect(ownClosed.body.position, 'the account closes its own').toBeNull();

      // The perp, to the millionth: the account's money in (margin and fee) and out (payouts), and
      // the pools holding the house's subsidy plus the same.
      const perpIn =
        micros(String(opened.margin)) +
        micros(String(opened.fee)) +
        micros(String(own.body.margin)) +
        micros(String(own.body.fee));
      const perpOut =
        micros(String(closedHalf.payout)) +
        micros(String(closed.payout)) +
        micros(String(ownClosed.body.payout));
      const books = await call(admin, 'GET', `/api/v1/admin/perps/${perpId}`);
      const pools = books.body.pools as { long: string; short: string };
      expect(decimal(micros(pools.long) + micros(pools.short)), "the perp's pools").toBe(
        decimal(SUBSIDY * 2n + perpIn - perpOut),
      );
      // The market's books: what the account put in is its balance's change, the perp's aside.
      await settleAndCheckBooks({
        admin,
        marketId,
        traders: [{ name: 'the bot', as: person, start: start - perpIn + perpOut }],
        settlement: { outcome: 'yes' },
        evidence: `Check run ${runKey()}: the example bot journey's market.`,
      });

      // The key, revoked: the bot is done.
      const revoked = await call(person, 'POST', `/api/v1/me/keys/${keyId}/revoke`);
      expect(revoked.status).toBe(200);
      await call(admin, 'POST', `/api/v1/admin/perps/${perpId}/mode`, {
        mode: 'halted',
        reason: `The example bot journey is done (run ${runKey()})`,
      });
      const retired = await call(admin, 'POST', `/api/v1/admin/perps/${perpId}/retire`, {
        reason: `The example bot journey is done (run ${runKey()})`,
      });
      expect(retired.body).toMatchObject({ state: 'retired' });
    } finally {
      // Whatever happened, the run's key is revoked and its perp halted, then retired (a retire
      // refused because a position is still open leaves it halted, which staging's schedule ignores).
      if (keyId) {
        await call(person, 'POST', `/api/v1/me/keys/${keyId}/revoke`).catch(() => undefined);
      }
      if (perpId) {
        await call(admin, 'POST', `/api/v1/admin/perps/${perpId}/mode`, {
          mode: 'halted',
          reason: `The example bot journey cleans up (run ${runKey()})`,
        }).catch(() => undefined);
        await call(admin, 'POST', `/api/v1/admin/perps/${perpId}/retire`, {
          reason: `The example bot journey cleans up (run ${runKey()})`,
        }).catch(() => undefined);
      }
      await Promise.all([admin.dispose(), anyone.dispose(), person.dispose()]);
    }
  });
});
