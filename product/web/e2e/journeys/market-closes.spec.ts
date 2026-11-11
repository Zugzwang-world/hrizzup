import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { call, micros, settleAndCheckBooks } from '../support/books.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: a market whose closing time passes (the Product chat, 11 November 2026: the founder's run
 * of the example bot picked a test market after it closed, because every read still called it open).
 * The run's own unlisted market closes 45 seconds after it's opened, and nobody closes it in the
 * console. While it's open, with a position in it, the reads that anyone makes (one market, a quote)
 * and the trader's own positions all say open, which also leaves the edge a copy of each, kept for
 * what's left of the 45 seconds at most. Three seconds past the closing time: every read says closed
 * (one market, through the edge; the same market through the MCP server; the trader's positions),
 * a quote and a trade are refused as closed, and the console still has it stored as open, so
 * nothing waited for it. Then the console closes and settles it, and its books add up. The public
 * list's own states are checked in the markets package, where a market can be listed freely: the
 * checks' markets stay off it (CLAUDE.md, "How checks behave"). Each run on its own.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** How long the market stays open: long enough for the run's few calls, short enough to wait for. */
const OPEN_FOR_MS = 45_000;

/** The standard `fetch`, carried by a Playwright request context (Vercel's bypass on a preview). */
function fetchThrough(context: APIRequestContext): typeof fetch {
  return async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await context.fetch(String(input), {
      method: init?.method ?? 'GET',
      headers,
      ...(init?.body === undefined || init.body === null ? {} : { data: String(init.body) }),
    });
    return new Response(response.status() === 202 ? null : await response.text(), {
      status: response.status(),
      headers: response.headers(),
    });
  };
}

/** A refusal by the books: 422, with its reason. */
function refusedFor(reason: string) {
  return { status: 422, body: { code: 'REFUSED', defined: true, data: { reason } } };
}

test.describe('a market whose closing time passes', () => {
  test.skip(() => environment() === 'production', 'No test accounts on production until launch');
  // Staging's firewall challenges a write to the typed API from anything but a browser (Vercel's
  // Security Checkpoint); previews, where the checks run, have no such rule.
  test.skip(
    () => environment() === 'staging',
    "Staging's firewall lets only browsers write to the typed API",
  );

  test('every read says closed at once, through the edge and the MCP server; a quote and a trade are refused; the books add up', async ({
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
    const { as: person } = await newRunTrader(keys, playwright, baseURL, engine, 'closes');
    const start = micros(
      String((await call(person, 'GET', '/api/v1/me/positions')).body.balance ?? '0'),
    );

    // The run's own market, unlisted, closing soon, opened and left for the clock to close.
    const marketId = newRecordId();
    const made = await call(admin, 'POST', '/api/v1/admin/markets', {
      id: marketId,
      question:
        `Closing journey (${engine}, run ${runKey()}): will the test desk record event Z?`.slice(
          0,
          120,
        ),
      categories: ['general'],
      rules: `A test market of check run ${runKey()}, the closing journey's.\nIt settles as the journey decides.`,
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + OPEN_FOR_MS).toISOString(),
      listed: false,
    });
    expect(made.status, 'the console makes the test market').toBe(201);
    const opened = await call(admin, 'POST', `/api/v1/admin/markets/${marketId}/open`);
    expect(opened.body).toMatchObject({ state: 'open' });
    const closesAt = Date.parse(
      String((await call(admin, 'GET', `/api/v1/admin/markets/${marketId}`)).body.closesAt),
    );

    // A position in it, bought while it's open (a trade clears the edge's copies, so the reads that
    // come next are the ones the edge keeps).
    const bought = await call(person, 'POST', '/api/v1/trades', {
      marketId,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'yes',
      amount: '5',
    });
    expect(bought.status, 'a buy while the market is open').toBe(200);

    // While it's open, every read says so.
    const during = await call(anyone, 'GET', `/api/v1/markets/${marketId}`);
    expect(during.status, 'one market').toBe(200);
    expect(during.body).toMatchObject({ market: { id: marketId, state: 'open' } });
    const quoted = await call(
      anyone,
      'GET',
      `/api/v1/markets/${marketId}/quote?outcome=yes&amount=5`,
    );
    expect(quoted.status, 'a quote while it is open').toBe(200);
    const holding = async () => {
      const mine = await call(person, 'GET', '/api/v1/me/positions');
      expect(mine.status, 'the trader reads their positions').toBe(200);
      return (mine.body.positions as { marketId: string; state: string }[]).find(
        (position) => position.marketId === marketId,
      );
    };
    expect(await holding(), 'their position says open').toMatchObject({ state: 'open' });

    // Nobody closes it. Three seconds past its closing time, for the clocks.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, closesAt + 3000 - Date.now())));

    // Every read says closed, though the console still has it stored as open. One market: any copy
    // the edge kept ended with the closing time, so this is a new answer, never the open one.
    const after = await call(anyone, 'GET', `/api/v1/markets/${marketId}`);
    expect(after.status, 'one market, past its closing time').toBe(200);
    expect(after.body, 'one market says closed').toMatchObject({
      market: { id: marketId, state: 'closed' },
      probability: bought.body.probAfter,
    });
    expect(await holding(), 'their position says closed').toMatchObject({ state: 'closed' });
    const mcp = new Client({ name: `hrizzup-journey-${engine}`, version: '1.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${baseURL ?? ''}/api/v1/mcp`), {
        fetch: fetchThrough(anyone),
      }),
    );
    try {
      const read = await mcp.callTool({ name: 'markets_get', arguments: { id: marketId } });
      expect(read.isError, JSON.stringify(read.content)).toBeFalsy();
      expect(read.structuredContent, 'the MCP server says closed').toMatchObject({
        market: { id: marketId, state: 'closed' },
      });
    } finally {
      await mcp.close();
    }
    const view = await call(admin, 'GET', `/api/v1/admin/markets/${marketId}`);
    expect(view.body.state, 'nothing waited for the console: it still has it as open').toBe('open');

    // A quote and a trade are refused as closed.
    const lateQuote = await call(
      anyone,
      'GET',
      `/api/v1/markets/${marketId}/quote?outcome=yes&amount=5`,
    );
    expect(lateQuote, 'a quote past the closing time').toMatchObject(refusedFor('market_closed'));
    const late = await call(person, 'POST', '/api/v1/trades', {
      marketId,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'no',
      amount: '1',
    });
    expect(late, 'a trade past the closing time').toMatchObject(refusedFor('market_closed'));

    // The books add up: the console closes it now, and settles it.
    await settleAndCheckBooks({
      admin,
      marketId,
      traders: [{ name: 'the trader', as: person, start }],
      settlement: { outcome: 'yes' },
      evidence: `Check run ${runKey()}: the closing journey's market.`,
    });
  });
});
