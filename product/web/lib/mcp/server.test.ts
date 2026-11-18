import { contract, isSocialCall, type Meta, procedures } from '@hrizzup/api';
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
// What each tool's calls were given as their context (`createRouterClient`'s `context`).
const contexts = vi.hoisted(() => ({ made: [] as (() => unknown)[] }));
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
vi.mock('@orpc/server', async (original) => {
  const real = await original<typeof import('@orpc/server')>();
  return {
    ...real,
    createRouterClient: ((router: never, options: { context: () => unknown }) => {
      contexts.made.push(options.context);
      return real.createRouterClient(router, options as never);
    }) as unknown as typeof real.createRouterClient,
  };
});
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  ...Object.fromEntries(
    Object.entries(calls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));

const { describedUse, serveMcp, toolHeaders, toolsFor, toolsOf, TOOLS } = await import(
  './server.ts'
);

const SITE = 'https://staging.hrizzup.com';
const MCP = `${SITE}/api/v1/mcp`;
// Made-up keys, never real ones.
const READ_KEY = `hz_demo_${'r'.repeat(43)}`;
const TRADE_KEY = `hz_demo_${'t'.repeat(43)}`;
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;
const ADA = '00000000-0000-4000-8000-00000000a0a1';
const AGENT = '00000000-0000-4000-8000-00000000b0b1';

/** A connected MCP client whose requests our handler serves, with this key (or none) and these other headers. */
async function connect(key?: string, other: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'hrizzup-test', version: '1.0.0' });
  const headers = { ...(key ? { authorization: `Bearer ${key}` } : {}), ...other };
  const transport = new StreamableHTTPClientTransport(new URL(MCP), {
    ...(Object.keys(headers).length > 0 ? { requestInit: { headers } } : {}),
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
      ? { id: '019a7b10-0000-7000-8000-00000000000a', userId: ADA, kind: 'read' }
      : text === TRADE_KEY
        ? { id: '019a7b10-0000-7000-8000-00000000000b', userId: ADA, kind: 'trade' }
        : text === POST_KEY
          ? { id: '019a7b10-0000-7000-8000-00000000000c', agentId: AGENT, kind: 'post' }
          : null,
  );
  contexts.made = [];
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
    // A trading key sees every tool but an agent's own (the posting key's: K8).
    expect(trading.length).toBe(TOOLS.filter((tool) => tool.who !== 'agent').length);
  });
});

describe('a call in beta, or not live yet, or kept out of MCP', () => {
  // A small contract of every kind shows the rule, whichever social calls are live in the real one.
  // oRPC takes any object with a procedure's own fields (`~orpc`) as a call.
  const call = (path: `/${string}`, summary: string, meta: Partial<Meta> = {}) => ({
    '~orpc': {
      meta: { caching: { kind: 'personal' }, ...meta },
      route: { method: 'GET', path, summary },
      errorMap: {},
    },
  });
  const publicRead: Partial<Meta> = {
    caching: { kind: 'public', edgeSeconds: 30, staleSeconds: 60, tags: ['x'] },
  };
  const small = {
    markets: { list: call('/markets', 'The markets', publicRead) },
    health: call('/health', 'Health', publicRead),
    stories: {
      list: call('/stories', 'The stories', { ...publicRead, beta: true }),
      mine: call('/stories/mine', 'My stories', { beta: true }),
      later: call('/stories/later', 'Not built yet', { ...publicRead, beta: true, live: false }),
      toolless: call('/stories/toolless', 'Kept out of MCP', { beta: true, mcp: false }),
      agentOnly: call('/stories/agent', 'For agents', { beta: true, who: 'agent' }),
    },
    owner: { agent: call('/owner/agent', 'Mine to own', { beta: true }) },
    reader: { chat: call('/reader/chat', 'Chat', { beta: true }) },
    admin: { social: { save: call('/admin/social/save', 'Save', { beta: true }) } },
  };

  it('starts a beta call’s summary with "(beta)", and no other call’s', () => {
    const byName = new Map(toolsOf(small).map((tool) => [tool.name, tool]));
    expect(byName.get('stories_list')).toMatchObject({
      summary: '(beta) The stories',
      beta: true,
      isPublic: true,
    });
    expect(byName.get('stories_mine')).toMatchObject({ summary: '(beta) My stories', beta: true });
    expect(byName.get('stories_agentOnly')?.summary).toBe('(beta) For agents');
    expect(byName.get('markets_list')).toMatchObject({ summary: 'The markets', beta: false });
  });

  it('makes no tool of a call not live yet, one kept out of MCP, health, or the unpublished groups', () => {
    expect(toolsOf(small).map((tool) => tool.name)).toEqual([
      'markets_list',
      'stories_list',
      'stories_mine',
      'stories_agentOnly',
    ]);
  });

  it('holds for the real contract: a tool for each published call, "(beta)" on those in beta only', () => {
    const expected = procedures(contract).filter(
      ([name, procedure]) =>
        !/^(admin|auth|keys|owner|reader|health)\b/.test(name) &&
        procedure['~orpc'].meta.live !== false &&
        procedure['~orpc'].meta.mcp !== false,
    );
    expect(TOOLS.map((tool) => tool.path.join('.'))).toEqual(expected.map(([name]) => name));
    for (const tool of TOOLS) {
      expect(tool.summary.startsWith('(beta)'), tool.name).toBe(
        tool.procedure['~orpc'].meta.beta === true,
      );
    }
  });
});

describe("who a call is for: an agent's tools and anyone's (K8)", () => {
  // A small contract with one call of each kind, since none of social's is live yet: a market API's
  // calls (a public read, a personal read, a trade), and social's `anyone` (a public read, a personal
  // read, a write) and `agent` calls (a read, a write). oRPC takes any object with a procedure's own
  // fields (`~orpc`) as a call.
  const call = (
    method: 'GET' | 'POST',
    path: `/${string}`,
    summary: string,
    meta: Partial<Meta> = {},
  ) => ({
    '~orpc': {
      meta: { caching: { kind: 'personal' }, ...meta },
      route: { method, path, summary },
      errorMap: {},
    },
  });
  const publicRead: Partial<Meta> = {
    caching: { kind: 'public', edgeSeconds: 30, staleSeconds: 60, tags: ['x'] },
  };
  const kinds = {
    markets: {
      list: call('GET', '/markets', 'The markets', publicRead),
      positions: call('GET', '/positions', 'Your positions'),
      trade: call('POST', '/trades', 'Trade'),
    },
    social: {
      board: call('GET', '/board', 'The board', { ...publicRead, beta: true, who: 'anyone' }),
      brief: call('GET', '/brief', 'A brief', { beta: true, who: 'anyone' }),
      register: call('POST', '/register', 'Register', { beta: true, who: 'anyone' }),
      me: call('GET', '/me', 'Me', { beta: true, who: 'agent' }),
      post: call('POST', '/post', 'Post', { beta: true, who: 'agent' }),
    },
  };
  const small = toolsOf(kinds);
  const names = (access: 'public' | 'read' | 'trade' | 'post') =>
    toolsFor(access, small).map((tool) => tool.name);

  it('keeps each call’s who on its tool, and none on a market call', () => {
    const byName = new Map(small.map((tool) => [tool.name, tool]));
    expect(byName.get('social_me')?.who).toBe('agent');
    expect(byName.get('social_register')?.who).toBe('anyone');
    expect(byName.get('markets_list')).not.toHaveProperty('who');
  });

  it('shows an agent’s tools only to a posting key, whatever the other rules say', () => {
    for (const access of ['public', 'read', 'trade'] as const) {
      expect(names(access), access).not.toContain('social_me');
      expect(names(access), access).not.toContain('social_post');
    }
    expect(names('post')).toEqual(expect.arrayContaining(['social_me', 'social_post']));
  });

  it('shows anyone’s tools to every access, reads and writes alike, a key or none', () => {
    for (const access of ['public', 'read', 'trade', 'post'] as const) {
      expect(names(access), access).toEqual(
        expect.arrayContaining(['social_board', 'social_brief', 'social_register']),
      );
    }
  });

  it('leaves the market rule as it was for the rest, a posting key counting as none: the public reads', () => {
    expect(names('public')).toEqual([
      'markets_list',
      'social_board',
      'social_brief',
      'social_register',
    ]);
    expect(names('read')).toEqual([
      'markets_list',
      'markets_positions',
      'social_board',
      'social_brief',
      'social_register',
    ]);
    expect(names('trade')).toEqual([
      'markets_list',
      'markets_positions',
      'markets_trade',
      'social_board',
      'social_brief',
      'social_register',
    ]);
    expect(names('post')).toEqual([
      'markets_list',
      'social_board',
      'social_brief',
      'social_register',
      'social_me',
      'social_post',
    ]);
    expect(names('post')).not.toContain('markets_positions');
    expect(names('post')).not.toContain('markets_trade');
  });

  it('says who may use each: an agent’s own, anyone’s, public, personal, trading', () => {
    const use = Object.fromEntries(small.map((tool) => [tool.name, describedUse(tool)]));
    expect(use).toEqual({
      markets_list: 'Public: needs no key.',
      markets_positions: 'Your own: needs a key.',
      markets_trade: 'Trades play money: needs a trading key.',
      social_board: 'Public: needs no key.',
      social_brief: 'Anyone: needs no key.',
      social_register: 'Anyone: needs no key.',
      social_me: "Your agent's own: needs its posting key.",
      social_post: "Your agent's own: needs its posting key.",
    });
  });
});

describe('social’s calls follow their live marks', () => {
  const all = procedures(contract);
  const social = all.filter(([name]) => isSocialCall(name.split('.')));
  // A tool for each social call that is live and not kept out of MCP (`mcp: false`), read from the
  // marks themselves, never from `isPublished` (which `toolsOf` filters with too, so a slip in it
  // would grow both sides together). The console's, the owner's and the reader's are never published,
  // so never expected: only the calls under `social` are.
  const expected = social
    .filter(
      ([name, procedure]) =>
        name.startsWith('social.') &&
        procedure['~orpc'].meta.live !== false &&
        procedure['~orpc'].meta.mcp !== false,
    )
    .map(([name]) => name);

  it('are tools exactly when published and not kept out of MCP, and the market API’s tools are all else there is', () => {
    expect(social.length).toBe(74);
    expect(
      TOOLS.filter((tool) => isSocialCall(tool.path)).map((tool) => tool.path.join('.')),
    ).toEqual(expected);
    // The tools of the market API, as before: published and outside social, health apart.
    const others = all.filter(
      ([name, procedure]) =>
        !/^(admin|auth|keys|owner|reader|health|social)\b/.test(name) &&
        procedure['~orpc'].meta.live !== false,
    );
    expect(TOOLS.length).toBe(others.length + expected.length);
    // Never the console's, the owner's or the reader's, whatever their live mark.
    for (const tool of TOOLS) expect(['admin', 'owner', 'reader']).not.toContain(tool.path[0]);
  });

  it('are named to a key only as tools: never a call not published or kept out of MCP', () => {
    const tools = new Set(expected.map((name) => name.replaceAll('.', '_')));
    for (const access of ['public', 'read', 'trade', 'post'] as const) {
      const named = toolsFor(access).map((tool) => tool.name);
      for (const [name] of social) {
        const tool = name.replaceAll('.', '_');
        if (!tools.has(tool)) expect(named, `${access}: ${name}`).not.toContain(tool);
      }
      for (const tool of toolsFor(access)) {
        if (isSocialCall(tool.path)) expect(tools, `${access}: ${tool.name}`).toContain(tool.name);
      }
    }
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
    expect(calls.marketQuote).toHaveBeenCalledWith(
      pool,
      {
        id: marketQuote.marketId,
        outcome: 'yes',
        amount: '25',
      },
      expect.any(Function),
    );
    await client.close();
  });

  it('is told once, whatever its key, to call social_basics first and that an agent’s tools need its posting key (K8)', async () => {
    for (const key of [undefined, POST_KEY]) {
      const client = await connect(key);
      const told = client.getInstructions() ?? '';
      expect(told, String(key)).toContain(
        'Social (beta): an agent calls social_basics, the skill file, first; agent tools need its posting key.',
      );
      // The market API's own lines stay.
      expect(told).toContain('markets_quote');
      await client.close();
    }
  });

  it('with a posting key sees the agent tools that are live, social_me_get among them, and no market tool of a person’s', async () => {
    const client = await connect(POST_KEY);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('social_basics');
    expect(names).toContain('social_me_get');
    for (const personal of ['portfolio_positions', 'markets_trade', 'perps_open', 'me']) {
      expect(names, personal).not.toContain(personal);
    }
    // The same key as a trading key sees none of the agent's own.
    const trade = await connect(TRADE_KEY);
    const traded = (await trade.listTools()).tools.map((tool) => tool.name);
    expect(traded).not.toContain('social_me_get');
    expect(traded).toContain('social_basics');
    await trade.close();
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

describe("an MCP client with an agent's posting key", () => {
  it('is let in, with the public reads and no market tool of its own', async () => {
    const client = await connect(POST_KEY);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names.sort()).toEqual(
      toolsFor('post')
        .map((tool) => tool.name)
        .sort(),
    );
    expect(names).toContain('markets_quote');
    for (const name of ['portfolio_positions', 'me', 'markets_trade', 'perps_open']) {
      expect(names).not.toContain(name);
    }
    expect(findKey).toHaveBeenCalled();
    await client.close();
  });

  it('cannot call a market tool it was not shown', async () => {
    const client = await connect(POST_KEY);
    const refused = await client
      .callTool({ name: 'markets_trade', arguments: { marketId: tradeResult.marketId } })
      .then((answer) => answer.isError === true)
      .catch(() => true);
    expect(refused).toBe(true);
    expect(calls.placeTrade).not.toHaveBeenCalled();
    await client.close();
  });

  it('gives every call the request’s own address, as an HTTP call has it', async () => {
    const client = await connect(POST_KEY);
    await client.listTools();
    expect(contexts.made.length).toBeGreaterThan(0);
    for (const context of contexts.made) {
      expect(context()).toMatchObject({ url: MCP, headers: expect.any(Headers) });
      // Only the key goes on: no cookie, no other header.
      expect([...(context() as { headers: Headers }).headers.keys()]).toEqual(['authorization']);
    }
    await client.close();
  });

  it('also gives them the address the request came from (the limits on a visitor count by it), and no cookie or other header', async () => {
    // `x-real-ip` is the one header `ipAddress()` reads; a cookie, a forwarded-for chain and any other
    // header of the request never reach a call.
    const client = await connect(POST_KEY, {
      'x-real-ip': '203.0.113.7',
      cookie: 'session=made-up',
      'x-forwarded-for': '198.51.100.9',
      'x-custom': 'anything',
    });
    await client.listTools();
    expect(contexts.made.length).toBeGreaterThan(0);
    for (const context of contexts.made) {
      const headers = (context() as { headers: Headers }).headers;
      expect([...headers.keys()].sort()).toEqual(['authorization', 'x-real-ip']);
      expect(headers.get('x-real-ip')).toBe('203.0.113.7');
    }
    await client.close();
  });
});

describe('the headers a tool is given', () => {
  it('are the key and the address, and only a header the request has', () => {
    const request = new Headers({
      authorization: `Bearer ${POST_KEY}`,
      'x-real-ip': '203.0.113.7',
      cookie: 'a=b',
      origin: 'https://elsewhere.example',
    });
    const given = toolHeaders(request);
    expect([...given.entries()].sort()).toEqual([
      ['authorization', `Bearer ${POST_KEY}`],
      ['x-real-ip', '203.0.113.7'],
    ]);
    // No key sent: the address alone; nothing sent: nothing; an empty value is none.
    expect([...toolHeaders(new Headers({ 'x-real-ip': '203.0.113.7' })).keys()]).toEqual([
      'x-real-ip',
    ]);
    expect([...toolHeaders(new Headers({ cookie: 'a=b' })).keys()]).toEqual([]);
    expect([...toolHeaders(new Headers({ 'x-real-ip': '' })).keys()]).toEqual([]);
  });
});

describe('the refusals', () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };

  it("a key that isn't valid, or a sign-in session, is refused before anything runs", async () => {
    const bad = await post(ping, { authorization: `Bearer hz_demo_${'x'.repeat(43)}` });
    expect(bad.status).toBe(401);
    const session = await post(ping, { authorization: 'Bearer a-session-token' });
    expect(session.status).toBe(401);
    // A revoked posting key is any key that isn't valid.
    findKey.mockResolvedValueOnce(null);
    expect((await post(ping, { authorization: `Bearer ${POST_KEY}` })).status).toBe(401);
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
