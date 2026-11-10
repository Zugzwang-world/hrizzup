import { createdKey, keyList, positionsPage, revokedKey, tradeResult } from '@hrizzup/api/examples';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The typed API's route (route.ts) with bots' API keys (PLAN.md step 3.5a), over HTTP as a bot
 * sends them: who may make which call with a key, what each refusal answers, and that a key's trade
 * runs as the key, so the database stamps it. Who is signed in, who a key is, the limits, the calls'
 * work and the edge are stood in for; finding and making keys is tested in lib/api/keys.test.ts,
 * and the database's part in infra/supabase/tests/api_keys.test.sql.
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const keyCalls = vi.hoisted(() => ({ listKeys: vi.fn(), createKey: vi.fn(), revokeKey: vi.fn() }));
const calls = vi.hoisted(() => ({ placeTrade: vi.fn(), positions: vi.fn(), isAdmin: vi.fn() }));
const signedAs = vi.hoisted(() => ({ keys: [] as (string | null)[] }));
const allowTrade = vi.fn();
const allowKeyRead = vi.fn();
const pool = { connect: vi.fn() };

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => pool }));
vi.mock('@/lib/api/rate-limit.ts', () => ({
  allowTrade: (account: string) => allowTrade(account),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));
vi.mock('@/lib/api/edge-cache.ts', () => ({
  MARKETS_TAG: 'markets',
  refreshEdge: async () => undefined,
}));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
  ...Object.fromEntries(
    Object.entries(keyCalls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));
vi.mock('@hrizzup/db', async (original) => {
  const real = await original<typeof import('@hrizzup/db')>();
  return {
    ...real,
    // Records which key each call's work ran as, then runs it as the real one does.
    asKey: <T>(key: string | null, work: () => Promise<T>) => {
      signedAs.keys.push(key);
      return real.asKey(key, work);
    },
  };
});
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  ...Object.fromEntries(
    Object.entries(calls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));

const route = await import('./route.ts');

const SITE = 'https://staging.hrizzup.com';
const ADA = { id: '00000000-0000-4000-8000-00000000a0a1', email: 'ada@keys.test' };
// Made-up keys, never real ones.
const READ_KEY = `hz_demo_${'r'.repeat(43)}`;
const TRADE_KEY = `hz_demo_${'t'.repeat(43)}`;
const READ = { id: '019a7b10-0000-7000-8000-00000000000a', userId: ADA.id, scope: 'read' };
const TRADE = { id: '019a7b10-0000-7000-8000-00000000000b', userId: ADA.id, scope: 'trade' };

async function answer(
  method: 'GET' | 'POST',
  path: string,
  options: { key?: string; scheme?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.key) headers.authorization = `${options.scheme ?? 'Bearer'} ${options.key}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const handler = route[method] as (request: Request) => Promise<Response>;
  const response = await handler(
    new Request(`${SITE}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

const buy = {
  marketId: tradeResult.marketId,
  requestId: '01a1b0c4-5e00-7a10-9c3d-1f2e3d4c5b6a',
  action: 'buy',
  outcome: 'yes',
  amount: '25',
};

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
  findKey.mockImplementation(async (text: string) =>
    text === READ_KEY ? READ : text === TRADE_KEY ? TRADE : null,
  );
  allowTrade.mockResolvedValue({ allowed: true });
  allowKeyRead.mockResolvedValue({ allowed: true });
  calls.placeTrade.mockResolvedValue(tradeResult);
  calls.positions.mockResolvedValue(positionsPage);
  calls.isAdmin.mockResolvedValue(true);
  signedAs.keys = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('a bot with a read-only key', () => {
  it('reads who it is, with no email or name, and its positions, each counted against its reads a minute', async () => {
    const me = await answer('GET', '/api/v1/me', { key: READ_KEY });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ id: ADA.id, email: null, name: null, signedInWith: 'api_key' });
    expect(me.headers['cache-control']).toBe('private, no-store');
    const held = await answer('GET', '/api/v1/me/positions', { key: READ_KEY, scheme: 'Key' });
    expect(held.status).toBe(200);
    expect(held.body).toEqual(positionsPage);
    expect(calls.positions).toHaveBeenCalledWith(pool, ADA.id, { after: undefined });
    expect(allowKeyRead.mock.calls).toEqual([[READ.id], [READ.id]]);
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('is refused a trade (403), before anything is counted or written', async () => {
    const refused = await answer('POST', '/api/v1/trades', { key: READ_KEY, body: buy });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      code: 'FORBIDDEN',
      message: 'This key is read-only: only a trading key may trade',
    });
    expect(allowTrade).not.toHaveBeenCalled();
    expect(calls.placeTrade).not.toHaveBeenCalled();
  });

  it('is refused past its reads a minute (429), with how long to wait', async () => {
    allowKeyRead.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    const refused = await answer('GET', '/api/v1/me/positions', { key: READ_KEY });
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('7');
    expect(refused.body).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      data: { retryAfterSeconds: 7 },
    });
    expect(calls.positions).not.toHaveBeenCalled();
  });
});

describe('a bot with a trading key', () => {
  it('trades as its account, counted against its trades a minute, the work running as the key', async () => {
    const traded = await answer('POST', '/api/v1/trades', { key: TRADE_KEY, body: buy });
    expect(traded.status).toBe(200);
    expect(traded.body).toEqual(tradeResult);
    expect(allowTrade).toHaveBeenCalledWith(ADA.id);
    expect(calls.placeTrade).toHaveBeenCalledWith(pool, ADA.id, buy);
    expect(signedAs.keys).toEqual([TRADE.id]);
  });

  it('answers a key the database no longer takes (revoked a moment ago) as a key that is not valid', async () => {
    calls.placeTrade.mockRejectedValue(
      Object.assign(
        new Error("This key can't trade: it is read-only, revoked or not this account's"),
        {
          code: '42501',
        },
      ),
    );
    const refused = await answer('POST', '/api/v1/trades', { key: TRADE_KEY, body: buy });
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ code: 'UNAUTHORIZED' });
    // Another permission error is no key's fault: it stays a failure of ours.
    calls.placeTrade.mockRejectedValue(
      Object.assign(new Error('permission denied for table x'), { code: '42501' }),
    );
    const failed = await answer('POST', '/api/v1/trades', { key: TRADE_KEY, body: buy });
    expect(failed.status).toBe(500);
  });
});

describe('a key that is not valid', () => {
  it('is refused (401) on personal and trading calls: never made, revoked, or not a key at all', async () => {
    for (const key of [`hz_demo_${'x'.repeat(43)}`, `hz_demo_${'x'.repeat(42)}`, 'not-a-key']) {
      for (const [method, path, body] of [
        ['GET', '/api/v1/me/positions', undefined],
        ['POST', '/api/v1/trades', buy],
      ] as const) {
        const refused = await answer(method, path, { key, scheme: 'Key', body });
        expect(refused.status, `${key} ${path}`).toBe(401);
        expect(refused.body).toMatchObject({ code: 'UNAUTHORIZED' });
      }
    }
    expect(calls.placeTrade).not.toHaveBeenCalled();
  });

  it('never falls back to a session cookie sent beside it', async () => {
    signedIn.mockResolvedValue(ADA);
    const refused = await answer('GET', '/api/v1/me', { key: `hz_demo_${'x'.repeat(43)}` });
    expect(refused.status).toBe(401);
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('does not matter to a public read, which reads no one', async () => {
    const health = await answer('GET', '/api/v1/health', { key: `hz_demo_${'x'.repeat(43)}` });
    expect(health.status).toBe(200);
    expect(findKey).not.toHaveBeenCalled();
  });
});

describe("the keys' own calls", () => {
  it('list, make and revoke for someone signed in, never kept', async () => {
    signedIn.mockResolvedValue(ADA);
    keyCalls.listKeys.mockResolvedValue(keyList);
    keyCalls.createKey.mockResolvedValue(createdKey);
    keyCalls.revokeKey.mockResolvedValue(revokedKey);
    const listed = await answer('GET', '/api/v1/me/keys');
    expect(listed).toMatchObject({ status: 200, body: keyList });
    const made = await answer('POST', '/api/v1/me/keys', {
      body: { name: ' My bot ', scope: 'trade' },
    });
    expect(made).toMatchObject({ status: 201, body: createdKey });
    expect(made.headers['cache-control']).toBe('private, no-store');
    expect(keyCalls.createKey).toHaveBeenCalledWith(pool, ADA.id, {
      name: 'My bot',
      scope: 'trade',
    });
    const revoked = await answer('POST', `/api/v1/me/keys/${createdKey.key.id}/revoke`);
    expect(revoked).toMatchObject({ status: 200, body: revokedKey });
    expect(keyCalls.revokeKey).toHaveBeenCalledWith(pool, ADA.id, createdKey.key.id);
  });

  it('are refused (403) with any key, even a trading one, so a leaked key cannot make another', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/v1/me/keys', undefined],
      ['POST', '/api/v1/me/keys', { name: 'Another', scope: 'trade' }],
      ['POST', `/api/v1/me/keys/${TRADE.id}/revoke`, undefined],
    ] as const) {
      const refused = await answer(method, path, { key: TRADE_KEY, body });
      expect(refused.status, path).toBe(403);
      expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(Object.values(keyCalls).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('answer "not signed in" to nobody, and refuse a name they would not take', async () => {
    const nobody = await answer('GET', '/api/v1/me/keys');
    expect(nobody).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
    signedIn.mockResolvedValue(ADA);
    const bad = await answer('POST', '/api/v1/me/keys', { body: { name: '', scope: 'read' } });
    expect(bad.status).toBe(400);
    expect(keyCalls.createKey).not.toHaveBeenCalled();
  });
});

describe('keys and the admin calls', () => {
  it('a key never reaches the console: it answers as an address the API does not have', async () => {
    // A request with a key is no session (lib/api/context.test.ts), so no admin is signed in.
    const hidden = await answer('GET', '/api/v1/admin/markets', { key: TRADE_KEY });
    expect(hidden).toMatchObject({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'No such call' },
    });
    expect(findKey).not.toHaveBeenCalled();
    expect(calls.isAdmin).not.toHaveBeenCalled();
  });
});

describe('on production, until its API opens at launch', () => {
  it('a key is refused, and making one is "not set up here"', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const refused = await answer('GET', '/api/v1/me/positions', { key: READ_KEY });
    expect(refused).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
    expect(findKey).not.toHaveBeenCalled();
    signedIn.mockResolvedValue(ADA);
    const making = await answer('POST', '/api/v1/me/keys', {
      body: { name: 'Bot', scope: 'read' },
    });
    expect(making).toMatchObject({ status: 503, body: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
