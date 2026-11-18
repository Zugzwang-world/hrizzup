import { readdirSync, readFileSync } from 'node:fs';
import {
  contract,
  isPublished,
  isSocialCall,
  PRINTED_TIME,
  procedures,
  timePlan,
} from '@hrizzup/api';
import { apiKey, marketList, ordersPage } from '@hrizzup/api/examples';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every time the API prints has exactly three decimals (the founder's rule, 18 November 2026), done
 * in the API's one output layer (`lib/api/base.ts`'s `everyCall`, which calls the printer in
 * `@hrizzup/api`, times.ts): here over HTTP as a client sends the calls, and through the MCP server,
 * with the database stood in for by answers in the forms the database and the packages write times
 * in (`…30Z`, `….3Z`, `….123456Z`). The printer itself, and every call that prints a time, are
 * tested with no website in product/packages/api/src/times.test.ts; real answers in the packages'
 * *.db.test.ts. Social's calls, left as they are until social adopts the printer, are in
 * times-social.test.ts.
 */

const signedIn = vi.fn();
const calls = vi.hoisted(() => ({ oneMarket: vi.fn(), openOrders: vi.fn() }));
const keyCalls = vi.hoisted(() => ({ listKeys: vi.fn() }));
const pool = { connect: vi.fn() };

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => pool }));
vi.mock('@/lib/api/edge-cache.ts', () => ({
  MARKETS_TAG: 'markets',
  MARKET_ACTIVITY_TAG: 'market-activity',
  refreshEdge: async () => undefined,
}));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  ...Object.fromEntries(
    Object.entries(keyCalls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  ...Object.fromEntries(
    Object.entries(calls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));

const route = await import('./route.ts');
const { router } = await import('@/lib/api/router.ts');
const { everyCall } = await import('@/lib/api/base.ts');
const { serveMcp } = await import('@/lib/mcp/server.ts');

const SITE = 'https://staging.hrizzup.com';
const PERSON = { id: '00000000-0000-4000-8000-0000000000e1', email: 'ann@times.test' };

async function get(path: string) {
  const response = await (route.GET as (request: Request) => Promise<Response>)(
    new Request(`${SITE}${path}`),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

/** A settled market from the agreement's examples: it has all five times. */
const settled = (() => {
  const found = marketList.markets.find((listed) => listed.market.state === 'settled');
  if (!found) throw new Error("The agreement's examples hold no settled market");
  return found;
})();

/** The same market with each of its five times in another form the database writes one in. */
const QUESTION = 'Will it all be over by 2026-12-31T00:00:00Z?';
function inDatabaseForms() {
  const original = settled.market as unknown as Record<string, string>;
  const record: Record<string, unknown> = { ...original, question: QUESTION };
  const forms = ['', '.3', '.123456', '.12', ''];
  const times = ['opens_at', 'closes_at', 'created_at', 'updated_at', 'settled_at'] as const;
  const printed: Record<string, string> = {};
  for (const [index, key] of times.entries()) {
    const head = String(original[key]).slice(0, 19);
    const written = `${head}${forms[index]}Z`;
    record[key] = written;
    printed[key] = new Date(written).toISOString();
  }
  return { record, printed };
}

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the one output layer', () => {
  it('is the first middleware of every call, exactly once, wrapping the output check', () => {
    const served = procedures(router) as unknown as [
      string,
      { '~orpc': { middlewares: unknown[]; outputValidationIndex: number } },
    ][];
    expect(served.map(([name]) => name).sort()).toEqual(
      procedures(contract)
        .map(([name]) => name)
        .sort(),
    );
    for (const [name, call] of served) {
      const { middlewares, outputValidationIndex } = call['~orpc'];
      expect(middlewares[0], `${name}'s first middleware`).toBe(everyCall);
      expect(middlewares.filter((one) => one === everyCall).length, name).toBe(1);
      expect(outputValidationIndex, `${name} is checked inside it`).toBeGreaterThanOrEqual(1);
    }
    expect(served.some(([name]) => isSocialCall(name.split('.')))).toBe(true);
  });
});

describe('over HTTP, each call prints its times with three decimals', () => {
  it("a market's five times, in every form the database writes one, and its question as it was", async () => {
    const { record, printed } = inDatabaseForms();
    calls.oneMarket.mockResolvedValue({ market: record, probability: null });
    const shown = await get(`/api/v1/markets/${(record as { id: string }).id}`);
    expect(shown.status).toBe(200);
    const market = (shown.body as { market: Record<string, unknown> }).market;
    for (const [key, time] of Object.entries(printed)) {
      expect(market[key], key).toBe(time);
      expect(market[key]).toMatch(PRINTED_TIME);
    }
    // Free text is never touched, even when it reads like a time.
    expect(market.question).toBe(QUESTION);
    expect(Buffer.from(String(market.question)).equals(Buffer.from(QUESTION))).toBe(true);
    // The record the call's work gave is not changed: the printed copy is another object.
    expect((record as Record<string, unknown>).opens_at).not.toMatch(PRINTED_TIME);
  });

  it('your open orders and your keys, a time that is null left null and one that is raw printed', async () => {
    signedIn.mockResolvedValue(PERSON);
    const [order] = ordersPage.orders;
    if (!order) throw new Error('no example order');
    calls.openOrders.mockResolvedValue({
      orders: [
        { ...order, expiresAt: null, createdAt: '2026-11-09T07:20:00Z' },
        { ...order, expiresAt: '2026-11-10T00:00:00.5Z', createdAt: '2026-11-09T07:20:00.123456Z' },
      ],
      next: null,
    });
    const orders = await get('/api/v1/me/orders');
    expect(orders.status).toBe(200);
    expect(
      (orders.body as { orders: { expiresAt: unknown; createdAt: unknown }[] }).orders.map(
        ({ expiresAt, createdAt }) => [expiresAt, createdAt],
      ),
    ).toEqual([
      [null, '2026-11-09T07:20:00.000Z'],
      ['2026-11-10T00:00:00.500Z', '2026-11-09T07:20:00.123Z'],
    ]);

    keyCalls.listKeys.mockResolvedValue({
      keys: [
        { ...apiKey, createdAt: '2026-11-11T09:30:00Z', lastUsedAt: null },
        { ...apiKey, createdAt: '2026-11-11T09:30:00.9Z', lastUsedAt: '2026-11-12T10:00:00.45Z' },
      ],
    });
    const keys = await get('/api/v1/me/keys');
    expect(keys.status).toBe(200);
    expect(
      (keys.body as { keys: { createdAt: unknown; lastUsedAt: unknown }[] }).keys.map(
        ({ createdAt, lastUsedAt }) => [createdAt, lastUsedAt],
      ),
    ).toEqual([
      ['2026-11-11T09:30:00.000Z', null],
      ['2026-11-11T09:30:00.900Z', '2026-11-12T10:00:00.450Z'],
    ]);
  });

  it('health, whose own clock is printed the same way, even if it were written short', async () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-11-09T06:30:00Z');
    const health = await get('/api/v1/health');
    vi.restoreAllMocks();
    expect(health.status).toBe(200);
    expect((health.body as { checkedAt: string }).checkedAt).toBe('2026-11-09T06:30:00.000Z');
  });

  it('a refusal has no time to print and answers as before', async () => {
    calls.oneMarket.mockRejectedValue(new Error('not used'));
    const refused = await get('/api/v1/markets/not-an-id');
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("through the MCP server, a tool's answer prints its times in both forms it gives", () => {
  it('markets_get: the structured answer and the text of it', async () => {
    const { record, printed } = inDatabaseForms();
    calls.oneMarket.mockResolvedValue({ market: record, probability: null });
    const client = new Client({ name: 'hrizzup-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${SITE}/api/v1/mcp`), {
        fetch: (url, init) => serveMcp(new Request(url, init)),
      }),
    );
    const answer = await client.callTool({
      name: 'markets_get',
      arguments: { id: (record as { id: string }).id },
    });
    const structured = (answer.structuredContent as { market: Record<string, unknown> }).market;
    const [first] = answer.content as { type: string; text: string }[];
    const text = (JSON.parse(first?.text ?? '{}') as { market: Record<string, unknown> }).market;
    for (const [key, time] of Object.entries(printed)) {
      expect(structured[key], `structured ${key}`).toBe(time);
      expect(text[key], `text ${key}`).toBe(time);
    }
    expect(structured.question).toBe(QUESTION);
    expect(text.question).toBe(QUESTION);
    await client.close();
  });
});

describe('the real database covers every published call that prints a time', () => {
  /** The database tests of the packages that run the calls (read here, so a change to one re-runs this: web/turbo.json). */
  const databaseTests = [
    new URL('../../../../../packages/markets/src/', import.meta.url),
    new URL('../../../../../packages/perps/src/', import.meta.url),
  ].flatMap((src) =>
    readdirSync(src)
      .filter((file) => file.endsWith('.db.test.ts'))
      .map((file) => readFileSync(new URL(file, src), 'utf8')),
  );

  it("names each one but health in some package's *.db.test.ts, where the real answers are checked", () => {
    expect(databaseTests.length).toBeGreaterThanOrEqual(5);
    const published = procedures(contract)
      .filter(
        ([name, call]) =>
          !isSocialCall(name.split('.')) &&
          isPublished(name.split('.'), call) &&
          timePlan(call['~orpc'].outputSchema).paths.length > 0,
      )
      .map(([name]) => name)
      .filter((name) => name !== 'health');
    expect(published.length).toBe(17);
    for (const name of published) {
      const named = new RegExp(`contract\\.${name.replace('.', '\\.')}\\b`);
      expect(
        databaseTests.some((file) => named.test(file)),
        `${name} is in no database test`,
      ).toBe(true);
    }
  });
});
