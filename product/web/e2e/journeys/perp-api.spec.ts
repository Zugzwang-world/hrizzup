import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { BITCOIN_PERP } from '../pages.ts';
import { call, decimal, micros } from '../support/books.ts';
import { runPerp, SUBSIDY } from '../support/perps.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: the perp for everyone in the typed API (PLAN.md step 3.4a), over HTTP as any client calls
 * it, on the pull request's preview (staging's database). Each check run on its own (CLAUDE.md, "How
 * checks behave"): it makes its own test perp (unlisted, with its own seed, so its prices are its
 * own) and its own fresh accounts, each with exactly the Ṁ1,000 its signup gave it, trades only
 * there, never the Bitcoin perp, and ends with the books adding up to the millionth: the trader's
 * balance, and the perp's two pools, are exactly what the answers say went in and came out.
 * - Anyone reads the Bitcoin perp's price now, kept at Vercel's edge for 5 seconds.
 * - A trader of the run's opens a long, retries it (the first answer, nothing traded twice), adds to
 *   it, closes half (sized on the position it saw), flips to a short and closes it, each at the next
 *   new price; every bad input and every refusal is answered, nothing moved: past 10 times leverage,
 *   more than the balance, nothing to close, a part-close on a position that has since changed, the
 *   perp closing only, the perp switched off, someone signed out, a write from another site.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** What every account's signup gives it, from the house. */
const STARTING = micros('1000');
/** A refusal by the books: 422, with its reason. */
function refusedFor(reason: string) {
  return { status: 422, body: { code: 'REFUSED', defined: true, data: { reason } } };
}

type Trade = {
  status: string;
  margin: string;
  fee: string;
  payout: string;
  balance: string;
  placedAt: string;
  priceAt: string;
  position: { direction: string; size: string } | null;
};

test.describe('the perp for everyone', () => {
  test.skip(() => environment() === 'production', 'No test accounts on production until launch');
  // Staging's firewall challenges a write to the typed API from anything but a browser (Vercel's
  // Security Checkpoint); previews, where the checks run, have no such rule.
  test.skip(
    () => environment() === 'staging',
    "Staging's firewall lets only browsers write to the typed API",
  );

  test("anyone reads the Bitcoin perp's price; a trader of the run's opens, retries, adds, closes half, flips and closes at the next price, is refused every bad input; the books add up", async ({
    playwright,
    request,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(300_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;

    // The Bitcoin perp's price, for anyone, kept at the edge.
    const listed = await call(request, 'GET', '/api/v1/perps');
    expect(listed.status, 'the perps answer').toBe(200);
    expect(listed.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    const bitcoin = (listed.body.perps as Record<string, string>[]).find(
      (perp) => perp.id === BITCOIN_PERP,
    );
    // On our own price since 3.4b: every 5 seconds, the median of three exchanges, stored once.
    expect(bitcoin, 'the Bitcoin perp is listed, on our own price').toMatchObject({
      name: 'Bitcoin price (US dollars)',
      listed: true,
      feed: 'btc-usd',
    });
    expect(Number(bitcoin?.price)).toBeGreaterThan(0);
    expect(Date.parse(bitcoin?.nextPriceAt ?? '') - Date.parse(bitcoin?.priceAt ?? '')).toBe(5_000);
    // Shown on the database's clock: never a price whose 5 seconds haven't started.
    expect(Date.parse(bitcoin?.priceAt ?? '')).toBeLessThanOrEqual(Date.now() + 2_000);

    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    const { as: trader } = await newRunTrader(keys, playwright, baseURL, engine, 'perp-one');
    const perp = await runPerp(admin, browserName);
    try {
      const shown = await call(request, 'GET', `/api/v1/perps/${perp}`);
      expect(shown.body).toMatchObject({ id: perp, listed: false, tradingMode: 'enabled' });
      expect(
        (listed.body.perps as { id: string }[]).some((item) => item.id === perp),
        "the run's perp is never listed",
      ).toBe(false);

      // A fresh account: exactly its starting balance, and no perp positions.
      const start = await call(trader, 'GET', '/api/v1/me/perps');
      expect(start.status).toBe(200);
      expect(start.headers['cache-control']).toBe('private, no-store');
      expect(start.body).toEqual({ balance: '1000.000000', positions: [], next: null });

      // Every answer that moved money, to check the books with at the end.
      const moved: Trade[] = [];
      const trade = async (path: 'open' | 'close', order: Record<string, unknown>) => {
        const answer = await call(trader, 'POST', `/api/v1/perps/${path}`, {
          perpId: perp,
          requestId: randomUUID(),
          ...order,
        });
        if (answer.status === 200) moved.push(answer.body as unknown as Trade);
        return answer;
      };

      // A 5-times long of Ṁ10: the fee is 10 basis points of its Ṁ50, on top.
      const first = {
        perpId: perp,
        requestId: randomUUID(),
        direction: 'long',
        margin: '10',
        leverage: '5',
      };
      const opened = await call(trader, 'POST', '/api/v1/perps/open', first);
      expect(opened.status).toBe(200);
      expect(opened.headers['cache-control']).toBe('private, no-store');
      expect(opened.body).toMatchObject({
        status: 'opened',
        requestId: first.requestId,
        perpId: perp,
        margin: '10.000000',
        fee: '0.050000',
        payout: '0.000000',
        balance: '989.950000',
        position: { direction: 'long', leverage: '5' },
      });
      moved.push(opened.body as unknown as Trade);
      // At the next new price: one published after the order was placed.
      expect(Date.parse(String(opened.body.priceAt))).toBeGreaterThan(
        Date.parse(String(opened.body.placedAt)),
      );
      // The same request again: the first answer, nothing traded twice.
      const retried = await call(trader, 'POST', '/api/v1/perps/open', first);
      expect(retried).toMatchObject({ status: 200, body: opened.body });
      // The same ID for another request is refused.
      expect(
        (await call(trader, 'POST', '/api/v1/perps/open', { ...first, margin: '11' })).status,
      ).toBe(409);

      const added = await trade('open', { direction: 'long', margin: '5', leverage: '5' });
      expect(added.body).toMatchObject({ status: 'added', margin: '5.000000', fee: '0.025000' });
      const held = await call(trader, 'GET', '/api/v1/me/perps');
      const positions = held.body.positions as {
        perpId: string;
        size: string;
        direction: string;
      }[];
      expect(positions.map((p) => [p.perpId, p.direction])).toEqual([[perp, 'long']]);
      const size = positions[0]?.size ?? '0';
      expect(Number(size)).toBeCloseTo(75, 4);

      // Half of it, sized on the position as it was seen; a part-close sized on another size, or on
      // none, is refused.
      expect(
        await trade('close', { fraction: '0.5', expectedSize: '1' }),
        'a part-close on a position that has since changed',
      ).toMatchObject(refusedFor('position_changed'));
      expect((await trade('close', { fraction: '0.5' })).status, 'a part-close with no size').toBe(
        400,
      );
      const half = await trade('close', { fraction: '0.5', expectedSize: size });
      expect(half.body).toMatchObject({ status: 'closed', margin: '0.000000', fee: '0.000000' });
      expect(Number((half.body.position as { size: string }).size)).toBeCloseTo(37.5, 4);

      // Opening the other way closes the long first, at the same price, then opens the short.
      const flipped = await trade('open', { direction: 'short', margin: '4', leverage: '2' });
      expect(flipped.body).toMatchObject({ status: 'opened', position: { direction: 'short' } });
      expect(micros(String(flipped.body.payout))).toBeGreaterThan(0n);
      const closed = await trade('close', { fraction: '1' });
      expect(closed.body).toMatchObject({ status: 'closed', position: null });
      expect((await call(trader, 'GET', '/api/v1/me/perps')).body.positions).toEqual([]);

      // Every refusal, before or by the books, moving nothing.
      const balance = micros(String(closed.body.balance));
      expect(
        await trade('open', { direction: 'long', margin: '10', leverage: '11' }),
      ).toMatchObject(refusedFor('leverage_too_high'));
      expect(
        await trade('open', { direction: 'long', margin: decimal(balance), leverage: '10' }),
      ).toMatchObject(refusedFor('insufficient_balance'));
      expect(await trade('close', { fraction: '1' })).toMatchObject(refusedFor('no_position'));
      for (const [what, order] of [
        ['leverage under 1', { direction: 'long', margin: '10', leverage: '0.5' }],
        ['a margin of zero', { direction: 'long', margin: '0', leverage: '2' }],
        ['a margin as a number', { direction: 'long', margin: 10, leverage: '2' }],
      ] as const) {
        expect((await trade('open', order)).status, what).toBe(400);
      }
      const signedOut = await call(request, 'POST', '/api/v1/perps/open', {
        perpId: perp,
        requestId: randomUUID(),
        direction: 'long',
        margin: '1',
        leverage: '1',
      });
      expect(signedOut.status, 'signed out').toBe(401);
      const forged = await trader.fetch('/api/v1/perps/open', {
        method: 'POST',
        data: {
          perpId: perp,
          requestId: randomUUID(),
          direction: 'long',
          margin: '1',
          leverage: '1',
        },
        headers: { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' },
      });
      expect(forged.status(), 'a cross-site write is refused').toBe(403);
      const nowhere = await call(trader, 'POST', '/api/v1/perps/open', {
        perpId: newRecordId(),
        requestId: randomUUID(),
        direction: 'long',
        margin: '1',
        leverage: '1',
      });
      expect(nowhere.status, 'no such perp').toBe(404);

      // Closing only, then off: no new position, then no trading at all.
      await call(admin, 'POST', `/api/v1/admin/perps/${perp}/mode`, {
        mode: 'reduce-only',
        reason: 'The perp journey winds it down',
      });
      expect(await trade('open', { direction: 'short', margin: '1', leverage: '1' })).toMatchObject(
        refusedFor('trading_off'),
      );
      await call(admin, 'POST', `/api/v1/admin/perps/${perp}/mode`, {
        mode: 'halted',
        reason: 'The perp journey is done',
      });
      expect(await trade('open', { direction: 'short', margin: '1', leverage: '1' })).toMatchObject(
        refusedFor('trading_off'),
      );

      // The books, to the millionth: the trader's balance is the starting balance less everything
      // put in plus everything paid out, and the pools hold the house's subsidy plus the same.
      const putIn = moved.reduce((sum, t) => sum + micros(t.margin) + micros(t.fee), 0n);
      const paidOut = moved.reduce((sum, t) => sum + micros(t.payout), 0n);
      const end = await call(trader, 'GET', '/api/v1/me/perps');
      expect(end.body.balance, "the trader's balance").toBe(decimal(STARTING - putIn + paidOut));
      expect(moved.at(-1)?.balance).toBe(end.body.balance);
      const books = await call(admin, 'GET', `/api/v1/admin/perps/${perp}`);
      const pools = books.body.pools as { long: string; short: string };
      expect(decimal(micros(pools.long) + micros(pools.short)), "the perp's pools").toBe(
        decimal(SUBSIDY * 2n + putIn - paidOut),
      );

      // Retired: its pools back to the house, holding nothing.
      const retired = await call(admin, 'POST', `/api/v1/admin/perps/${perp}/retire`, {
        reason: `The perp journey is done (run ${runKey()})`,
      });
      expect(retired.body).toMatchObject({
        state: 'retired',
        pools: { long: '0.000000', short: '0.000000' },
      });
    } finally {
      // Whatever happened, the run's perp ends switched off, so staging's schedule leaves it alone.
      await call(admin, 'POST', `/api/v1/admin/perps/${perp}/mode`, {
        mode: 'halted',
        reason: `The perp journey cleans up (run ${runKey()})`,
      }).catch(() => undefined);
      await Promise.all([admin.dispose(), trader.dispose()]);
    }
  });
});
