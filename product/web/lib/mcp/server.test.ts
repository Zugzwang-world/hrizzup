import { marketQuote, positionsPage, tradeResult } from '@hrizzup/api/examples';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The MCP server (PLAN.md step 3.5f; lib/mcp/server.ts), driven by the official MCP client
 * (`@modelcontextprotocol/client`, as Claude Code, Codex and Cursor speak it) with its requests
 * served by our route's handler, the database stood in for: the tools a key's scope may use, a public
 * read and a trade through them, each running the API's own call, and the refusals (a key that isn't
 * valid, a sign-in session, another site's page, a batch). On a real preview: the journey
 * (e2e/journeys/mcp.spec.ts).
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const allowTrade = vi.fn();
const allowKeyRead = vi.fn();
const calls = vi.hoisted(() => ({
  marketQuote: vi.fn(),
  placeTrade: vi.fn(),
  positions: vi.fn(),
}));
const pool = { connect: vi.fn() };

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => pool }));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowTrade: (account: string) => allowTrade(account),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));
vi.mock('@/lib/api/edge-cache.ts', () => ({
  MARKETS_TAG: 'markets',
  MARKET_ACTIVITY_TAG: 'market-activity',
  refreshEdge: async () => undefined,
}));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
}));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  ...Object.fromEntries(
    Object.entries(calls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));

const { serveMcp, toolsFor, TOOLS } = await import('./server.ts');

const SITE = 'https://staging.hrizzup.com';
const MCP = `${SITE}/api/v1/mcp`;
// Made-up keys, never real ones.
const READ_KEY = `hz_demo_${'r'.repeat(43)}`;
const TRADE_KEY = `hz_demo_${'t'.repeat(43)}`;
const ADA = '00000000-0000-4000-8000-00000000a0a1';

/** A connected MCP client whose requests our handler serves, with this key (or none). */
async function connect(key?: string): Promise<Client> {
  const client = new Client({ name: 'hrizzup-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP), {
    ...(key ? { requestInit: { headers: { authorization: `Bearer ${key}` } } } : {}),
    fetch: (url, init) => serveMcp(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  return serveMcp(
    new Request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
  findKey.mockImplementation(async (text: string) =>
    text === READ_KEY
      ? { id: '019a7b10-0000-7000-8000-00000000000a', userId: ADA, scope: 'read' }
      : text === TRADE_KEY
        ? { id: '019a7b10-0000-7000-8000-00000000000b', userId: ADA, scope: 'trade' }
        : null,
  );
  allowTrade.mockResolvedValue({ allowed: true });
  allowKeyRead.mockResolvedValue({ allowed: true });
  calls.marketQuote.mockResolvedValue(marketQuote);
  calls.placeTrade.mockResolvedValue(tradeResult);
  calls.positions.mockResolvedValue(positionsPage);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('the tools', () => {
  it('are the published calls, but health: never the console, the sign-in or the keys', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toContain('markets_quote');
    expect(names).toContain('markets_trade');
    expect(names).toContain('perps_close');
    expect(names).toContain('portfolio_trades');
    expect(names).toContain('prices_get');
    for (const name of names) expect(name).not.toMatch(/^(admin|auth|keys|health)/);
  });

  it('a key decides which: none, the public reads; read-only, every read; trading, all', () => {
    const publicOnes = toolsFor('public').map((tool) => tool.name);
    const reading = toolsFor('read').map((tool) => tool.name);
    const trading = toolsFor('trade').map((tool) => tool.name);
    expect(publicOnes).toContain('markets_quote');
    expect(publicOnes).not.toContain('portfolio_positions');
    expect(publicOnes).not.toContain('markets_trade');
    expect(reading).toEqual(expect.arrayContaining([...publicOnes, 'me', 'portfolio_positions']));
    for (const name of ['markets_trade', 'markets_cancelOrder', 'perps_open', 'perps_close']) {
      expect(reading).not.toContain(name);
      expect(trading).toContain(name);
    }
    expect(trading.length).toBe(TOOLS.length);
  });
});

describe('an MCP client', () => {
  it('with no key lists only the public reads, and gets a quote through one', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      toolsFor('public')
        .map((tool) => tool.name)
        .sort(),
    );
    const quote = tools.find((tool) => tool.name === 'markets_quote');
    expect(quote?.annotations).toMatchObject({ readOnlyHint: true });
    expect(quote?.inputSchema).toMatchObject({ type: 'object' });
    const answer = await client.callTool({
      name: 'markets_quote',
      arguments: { id: marketQuote.marketId, outcome: 'YES', amount: '25' },
    });
    expect(answer.isError).toBeFalsy();
    expect(answer.structuredContent).toEqual(marketQuote);
    expect(calls.marketQuote).toHaveBeenCalledWith(pool, {
      id: marketQuote.marketId,
      outcome: 'yes',
      amount: '25',
    });
    await client.close();
  });

  it('with a read-only key reads its own positions, and has no trading tool', async () => {
    const client = await connect(READ_KEY);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('portfolio_positions');
    expect(names).not.toContain('markets_trade');
    const held = await client.callTool({ name: 'portfolio_positions', arguments: {} });
    expect(held.structuredContent).toEqual(positionsPage);
    expect(calls.positions).toHaveBeenCalledWith(pool, ADA, { after: undefined });
    await client.close();
  });

  it('with a trading key trades as the key, making a request ID when none is sent; a refusal comes back as one', async () => {
    const client = await connect(TRADE_KEY);
    const trade = (await client.listTools()).tools.find((tool) => tool.name === 'markets_trade');
    expect(trade?.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true });
    expect(trade?.inputSchema).toMatchObject({
      type: 'object',
      properties: { action: { enum: ['buy', 'sell'] } },
    });
    const required = (trade?.inputSchema as { required?: string[] } | undefined)?.required ?? [];
    expect(required).toEqual(expect.arrayContaining(['marketId', 'action', 'outcome']));
    expect(required).not.toContain('requestId');
    const traded = await client.callTool({
      name: 'markets_trade',
      arguments: { marketId: tradeResult.marketId, action: 'buy', outcome: 'yes', amount: '25' },
    });
    expect(traded.structuredContent).toEqual(tradeResult);
    const sent = calls.placeTrade.mock.calls[0]?.[2] as { requestId: string };
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(allowTrade).toHaveBeenCalledWith(ADA);
    // Manifold's form: YES and a dry run, passed on as the call takes them.
    calls.placeTrade.mockClear();
    await client.callTool({
      name: 'markets_trade',
      arguments: {
        marketId: tradeResult.marketId,
        action: 'buy',
        outcome: 'YES',
        amount: '25',
        dryRun: true,
      },
    });
    expect(calls.placeTrade.mock.calls[0]?.[2]).toMatchObject({ outcome: 'yes', dryRun: true });
    // A field the call doesn't know is refused, never dropped: a mistyped dry run trades nothing.
    calls.placeTrade.mockClear();
    const unknown = await client.callTool({
      name: 'markets_trade',
      arguments: {
        marketId: tradeResult.marketId,
        action: 'buy',
        outcome: 'yes',
        amount: '25',
        dry_run: true,
      },
    });
    expect(unknown.isError).toBe(true);
    expect(calls.placeTrade).not.toHaveBeenCalled();
    // The contract still checks every input: a sale with an amount is refused, as a tool error.
    const refused = await client.callTool({
      name: 'markets_trade',
      arguments: { marketId: tradeResult.marketId, action: 'sell', outcome: 'yes', amount: '5' },
    });
    expect(refused.isError).toBe(true);
    expect(JSON.parse((refused.content as { text: string }[])[0]?.text ?? '{}')).toMatchObject({
      code: 'BAD_REQUEST',
    });
    await client.close();
  });
});

describe('the refusals', () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };

  it("a key that isn't valid, or a sign-in session, is refused before anything runs", async () => {
    const bad = await post(ping, { authorization: `Bearer hz_demo_${'x'.repeat(43)}` });
    expect(bad.status).toBe(401);
    const session = await post(ping, { authorization: 'Bearer a-session-token' });
    expect(session.status).toBe(401);
    expect(await session.json()).toMatchObject({ message: expect.stringContaining('API key') });
  });

  it("another site's page, a batch, and an oversized message are refused", async () => {
    expect((await post(ping, { origin: 'https://elsewhere.example' })).status).toBe(403);
    expect((await post([ping, { ...ping, id: 2 }])).status).toBe(400);
    expect((await post({ ...ping, padding: 'x'.repeat(70_000) })).status).toBe(413);
    // Counted in bytes: 30,000 three-byte characters are 90 KB.
    expect((await post({ ...ping, padding: '€'.repeat(30_000) })).status).toBe(413);
  });

  it('is not on production until its API opens', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await post(ping)).status).toBe(404);
  });
});
