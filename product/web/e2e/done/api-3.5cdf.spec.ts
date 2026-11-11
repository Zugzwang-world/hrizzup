import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test } from '@playwright/test';
import { runBot } from '../../../../examples/bot/bot.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { call, micros, settleAndCheckBooks } from '../support/books.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { runAddress, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * The done-tests of PLAN.md steps 3.5c, 3.5d and 3.5f, and 3.4b's "a bot shows the same price", on
 * staging itself (Round 5's R5, milestone 5):
 * - 3.5c: "each read answers for a test market without a key, and a quote matches the trade that
 *   follows it to the exact decimal";
 * - 3.5d: "the example bot with a trading key buys, places and cancels a limit order, sells, and
 *   opens and closes the perp, and the books add up to the exact decimal" (here, on the listed
 *   Bitcoin perp, on our own price);
 * - 3.5f: an MCP client (the official one, as Claude Code speaks it) "connected with a trading key
 *   finds a market, gets a quote and places a trade, and with a read-only key it can't trade";
 * - 3.4b: the price the perp shows and the price every bot reads are the same stored median.
 * Run by hand, once, from this Mac, never by the checks (a couple of minutes):
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/api-3.5cdf.spec.ts'
 * A fresh account of the run's makes the keys, signed in; the bot and the MCP client then use only
 * the keys, as any bot does. Their market trades are in the run's own unlisted test market, which the
 * console's admin test account makes, settles and checks to the millionth; the perp's money is
 * checked from every answer. Staging's whole books are checked after, from the database (the run's
 * record in docs/status/product.md).
 */

const BASE = process.env.BASE_URL ?? '';

test("3.5c, 3.5d and 3.5f's done-tests: the market reads, the example bot and the MCP server, on staging", async ({
  playwright,
}) => {
  test.setTimeout(600_000);
  expect(BASE, 'run against staging').toBe('https://staging.hrizzup.com');
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing (run with Doppler stg)");
  const anyone = await playwright.request.newContext({ baseURL: BASE });
  const admin = await playwright.request.newContext({
    baseURL: BASE,
    storageState: adminState('chromium'),
  });

  // A fresh account of the run's, signed in, makes a trading key and a read-only key.
  const session = await sessionFor(keys, runAddress('done-3-5d', 'chromium'), { create: true });
  const person = await playwright.request.newContext({
    baseURL: BASE,
    storageState: {
      cookies: session.cookies.map(({ name, value }) => asBrowserCookie(BASE, name, value)),
      origins: [],
    },
  });
  const made: string[] = [];
  const newKey = async (scope: 'read' | 'trade') => {
    const answer = await call(person, 'POST', '/api/v1/me/keys', {
      name: `Done-test ${scope} (run ${runKey()})`.slice(0, 60),
      scope,
    });
    expect(answer.status, `a ${scope} key is made`).toBe(201);
    made.push((answer.body.key as { id: string }).id);
    return String(answer.body.secret);
  };
  const clients: Client[] = [];
  try {
    const tradeKey = await newKey('trade');
    const start = micros(String((await call(person, 'GET', '/api/v1/me/positions')).body.balance));

    // The run's own market, unlisted; and the listed Bitcoin perp, on our own price.
    const marketId = newRecordId();
    const market = await call(admin, 'POST', '/api/v1/admin/markets', {
      id: marketId,
      question: `Done-test (run ${runKey()}): will the test desk record event D?`.slice(0, 120),
      categories: ['general'],
      rules: `A test market of the run ${runKey()}, R5's done-test.\nIt settles as the test decides.`,
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      listed: false,
    });
    expect(market.status, 'the console makes the test market').toBe(201);
    expect((await call(admin, 'POST', `/api/v1/admin/markets/${marketId}/open`)).status).toBe(200);
    const perps = await call(anyone, 'GET', '/api/v1/perps');
    const bitcoin = (perps.body.perps as { id: string; feed: string }[])[0];
    expect(bitcoin?.feed, 'the Bitcoin perp is on our own price').toBe('btc-usd');

    // 3.5c: every read, with no key.
    for (const path of [
      `/api/v1/markets/${marketId}`,
      `/api/v1/markets/${marketId}/history?range=1h`,
      `/api/v1/markets/${marketId}/book`,
      `/api/v1/markets/${marketId}/trades`,
      `/api/v1/markets/${marketId}/quote?outcome=yes&amount=10`,
      `/api/v1/perps/${bitcoin?.id}/quote?direction=long&margin=10&leverage=2`,
      '/api/v1/prices/btc-usd',
      '/api/v1/prices/btc-usd/history?range=1h',
    ]) {
      const read = await call(anyone, 'GET', path);
      expect(read.status, `${path}, with no key`).toBe(200);
      expect(read.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    }

    // 3.4b: the perp and every bot read the same stored price.
    const recent = await call(anyone, 'GET', '/api/v1/prices/btc-usd/history?range=1h');
    const stored = new Set(
      (recent.body.points as { price: string }[]).slice(-6).map((point) => point.price),
    );
    const now = await call(anyone, 'GET', '/api/v1/prices/btc-usd');
    const perp = await call(anyone, 'GET', `/api/v1/perps/${bitcoin?.id}`);
    expect(stored.has(String(now.body.price)), "the bots' price is a stored one").toBe(true);
    expect(
      [...stored].some((price) => Number(price) === Number(perp.body.price)),
      "the perp's price is the same stored median",
    ).toBe(true);

    // 3.5d: the example bot, with only the trading key, on the run's market and the Bitcoin perp.
    const lines: string[] = [];
    const ran = await runBot({
      key: tradeKey,
      api: `${BASE}/api/v1`,
      market: marketId,
      perp: String(bitcoin?.id),
      log: (line) => lines.push(line),
    });
    expect(lines.join('\n')).not.toContain(tradeKey);
    expect(ran.order.status).toBe('resting');
    expect(ran.cancelled.status).toBe('cancelled');
    expect({ shares: ran.bought.shares, probAfter: ran.bought.probAfter }).toEqual({
      shares: ran.quote.shares,
      probAfter: ran.quote.probAfter,
    });
    // The account holds no perp position of its own, so the bot trades the perp, closing only its own.
    const { opened, closedHalf, closed } = ran;
    if (!opened || !closedHalf || !closed) throw new Error('The bot left the perp alone');
    expect(closed.position, 'the perp position is closed').toBeNull();
    // 3.4b: every order fills at the next price, one stored after it was placed.
    for (const order of [opened, closedHalf, closed]) {
      expect(Date.parse(String(order.priceAt))).toBeGreaterThan(Date.parse(String(order.placedAt)));
    }
    const perpIn = micros(String(opened.margin)) + micros(String(opened.fee));
    const perpOut = micros(String(closedHalf.payout)) + micros(String(closed.payout));

    // 3.5f: an MCP client with a read-only key can't trade; with the trading key it quotes and trades.
    const connect = async (key: string) => {
      const client = new Client({ name: 'hrizzup-done-test', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${BASE}/api/v1/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${key}` } },
        }),
      );
      clients.push(client);
      return client;
    };
    const reader = await connect(await newKey('read'));
    const readTools = (await reader.listTools()).tools.map((tool) => tool.name);
    expect(readTools).toContain('markets_quote');
    expect(readTools, 'a read-only key has no trading tool').not.toContain('markets_trade');
    const trader = await connect(tradeKey);
    const tools = (await trader.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(
      expect.arrayContaining(['markets_list', 'markets_quote', 'markets_trade']),
    );
    const quoted = await trader.callTool({
      name: 'markets_quote',
      arguments: { id: marketId, outcome: 'no', amount: '15' },
    });
    expect(quoted.isError, JSON.stringify(quoted.content)).toBeFalsy();
    const traded = await trader.callTool({
      name: 'markets_trade',
      arguments: { marketId, requestId: randomUUID(), action: 'buy', outcome: 'no', amount: '15' },
    });
    expect(traded.isError, JSON.stringify(traded.content)).toBeFalsy();
    const quote = quoted.structuredContent as Record<string, string>;
    const trade = traded.structuredContent as Record<string, string>;
    for (const field of ['amount', 'shares', 'probBefore', 'probAfter']) {
      expect(trade[field], `the MCP trade's ${field}, as quoted`).toBe(quote[field]);
    }

    // Every Ṁ: the market's books once it settles (the account's money in the perp set aside, from
    // its answers), and the account's balance the answers' own.
    await settleAndCheckBooks({
      admin,
      marketId,
      traders: [{ name: 'the done-test account', as: person, start: start - perpIn + perpOut }],
      settlement: { outcome: 'yes' },
      evidence: `R5's done-test (run ${runKey()}).`,
    });
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    for (const id of made) {
      await call(person, 'POST', `/api/v1/me/keys/${id}/revoke`).catch(() => undefined);
    }
    await Promise.all([anyone, admin, person].map((context) => context.dispose()));
  }
});
