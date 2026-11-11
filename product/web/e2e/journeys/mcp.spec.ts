import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { call, micros, settleAndCheckBooks } from '../support/books.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: the MCP server (PLAN.md step 3.5f's done-test in miniature), on every pull request's
 * preview, through the official MCP client as Claude Code, Codex and Cursor speak it. A fresh account
 * of the run's makes a read-only key and a trading key while signed in. With the read-only key, the
 * client lists only reading tools and reads its balance; with the trading key, it lists the trading
 * tools, gets a quote in the run's own unlisted market and places the trade, which fills exactly as
 * quoted; the trade is marked as the key's; and the market's books add up. Each run on its own.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

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

test.describe('the MCP server', () => {
  test.skip(() => environment() === 'production', "Production's API opens at launch");
  test.skip(
    () => environment() === 'staging',
    "Staging's done-test connects from the Mac (e2e/done); the checks connect on previews",
  );

  test('a read-only key gets only reading tools; a trading key quotes and trades exactly as quoted; the books add up', async ({
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
    const anyone = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    const { as: person } = await newRunTrader(keys, playwright, baseURL, engine, 'mcp');
    const made: string[] = [];
    const clients: Client[] = [];
    /** An MCP client connected with this key, as an AI tool connects. */
    const connect = async (key: string) => {
      const client = new Client({ name: `hrizzup-journey-${engine}`, version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${baseURL ?? ''}/api/v1/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${key}` } },
          fetch: fetchThrough(anyone),
        }),
      );
      clients.push(client);
      return client;
    };
    try {
      const newKey = async (scope: 'read' | 'trade') => {
        const answer = await call(person, 'POST', '/api/v1/me/keys', {
          name: `MCP journey, ${scope} (run ${runKey()})`.slice(0, 60),
          scope,
        });
        expect(answer.status, `a ${scope} key is made`).toBe(201);
        made.push((answer.body.key as { id: string }).id);
        return String(answer.body.secret);
      };

      // A read-only key: only reading tools.
      const reader = await connect(await newKey('read'));
      const readTools = (await reader.listTools()).tools.map((tool) => tool.name);
      expect(readTools).toEqual(expect.arrayContaining(['markets_quote', 'portfolio_positions']));
      for (const name of ['markets_trade', 'markets_cancelOrder', 'perps_open', 'perps_close']) {
        expect(readTools, `a read-only key has no ${name}`).not.toContain(name);
      }
      const held = await reader.callTool({ name: 'portfolio_positions', arguments: {} });
      expect(held.isError).toBeFalsy();
      const start = micros(String((held.structuredContent as { balance: string }).balance));

      // The run's own market, unlisted.
      const marketId = newRecordId();
      const market = await call(admin, 'POST', '/api/v1/admin/markets', {
        id: marketId,
        question:
          `MCP journey (${engine}, run ${runKey()}): will the test desk record event M?`.slice(
            0,
            120,
          ),
        categories: ['general'],
        rules: `A test market of check run ${runKey()}, the MCP journey's.\nIt settles as the journey decides.`,
        source: { name: "Hrizzup's test desk (a placeholder source)" },
        opensAt: new Date(Date.now() - 60_000).toISOString(),
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        listed: false,
      });
      expect(market.status, 'the console makes the test market').toBe(201);
      expect((await call(admin, 'POST', `/api/v1/admin/markets/${marketId}/open`)).status).toBe(
        200,
      );

      // A trading key: the trading tools; a quote, then the trade, exactly as quoted.
      const trader = await connect(await newKey('trade'));
      const tradeTools = (await trader.listTools()).tools.map((tool) => tool.name);
      expect(tradeTools).toEqual(expect.arrayContaining(['markets_trade', 'perps_open']));
      const quoted = await trader.callTool({
        name: 'markets_quote',
        arguments: { id: marketId, outcome: 'yes', amount: '20' },
      });
      expect(quoted.isError, JSON.stringify(quoted.content)).toBeFalsy();
      const quote = quoted.structuredContent as Record<string, string>;
      const traded = await trader.callTool({
        name: 'markets_trade',
        arguments: {
          marketId,
          requestId: randomUUID(),
          action: 'buy',
          outcome: 'YES',
          amount: '20',
        },
      });
      expect(traded.isError, JSON.stringify(traded.content)).toBeFalsy();
      const trade = traded.structuredContent as Record<string, string>;
      for (const field of ['amount', 'shares', 'probBefore', 'probAfter']) {
        expect(trade[field], `the trade's ${field}, as quoted`).toBe(quote[field]);
      }
      const mine = await trader.callTool({ name: 'portfolio_trades', arguments: { limit: 5 } });
      const listed = (mine.structuredContent as { trades: { id: string; isApi: boolean }[] })
        .trades;
      expect(listed.find((one) => one.id === trade.tradeId)?.isApi, "marked as a key's").toBe(true);

      await settleAndCheckBooks({
        admin,
        marketId,
        traders: [{ name: 'the MCP client', as: person, start }],
        settlement: { outcome: 'no' },
        evidence: `Check run ${runKey()}: the MCP journey's market.`,
      });
    } finally {
      await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
      for (const id of made) {
        await call(person, 'POST', `/api/v1/me/keys/${id}/revoke`).catch(() => undefined);
      }
      await Promise.all([admin.dispose(), anyone.dispose(), person.dispose()]);
    }
  });
});
