import {
  consolePerpWithLog,
  perpClosed,
  perpDetails,
  perpOpened,
  perpPositionsPage,
} from '@hrizzup/api/examples';
import { DatabaseBusyError } from '@hrizzup/db';
import { PerpNotSetUpError, PerpTradingError } from '@hrizzup/perps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The typed API's route (route.ts), for the perp's calls (PLAN.md step 3.4a), over HTTP as any client
 * sends them: what each answers, with which headers, and what runs before what. The calls' work
 * (`@hrizzup/perps`), who is signed in, the trades-a-minute limit and the edge are stood in for; the
 * database's part is tested with the database (product/packages/perps and infra/supabase/tests).
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();
// Made before the module stand-ins below, which vitest runs first.
const calls = vi.hoisted(() => ({
  listedPerps: vi.fn(),
  perpDetails: vi.fn(),
  openPerp: vi.fn(),
  closePerp: vi.fn(),
  perpPositions: vi.fn(),
  setPerpMode: vi.fn(),
  setPerpSettings: vi.fn(),
  createTestPerp: vi.fn(),
  retireTestPerp: vi.fn(),
}));
const allowTrade = vi.fn();
const refreshEdge = vi.fn();
const pool = { connect: vi.fn() };

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => pool }));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowTrade: (account: string) => allowTrade(account),
}));
vi.mock('@/lib/api/edge-cache.ts', () => ({
  MARKETS_TAG: 'markets',
  refreshEdge: (tags: string[]) => refreshEdge(tags),
}));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));
vi.mock('@hrizzup/perps', async (original) => ({
  ...(await original<typeof import('@hrizzup/perps')>()),
  ...Object.fromEntries(
    Object.entries(calls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));

const route = await import('./route.ts');

const SITE = 'https://staging.hrizzup.com';
const PERSON = { id: '00000000-0000-4000-8000-0000000000e1', email: 'ann@perps.test' };
const PERP = perpDetails.id;
const REQUEST = '01a1c601-2b00-7b20-8e4f-3a2b1c0d9e8f';
/** The environment's seed for the listed perp, in these tests only. */
const SEED = '0123456789abcdef';

async function answer(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const handler = route[method] as (request: Request) => Promise<Response>;
  const response = await handler(
    new Request(`${SITE}${path}`, {
      method,
      ...(body === undefined
        ? { headers }
        : {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json', ...headers },
          }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

const open = (changes: Record<string, unknown> = {}) => ({
  perpId: PERP,
  requestId: REQUEST,
  direction: 'long',
  margin: '100',
  leverage: '10',
  ...changes,
});

const close = (changes: Record<string, unknown> = {}) => ({
  perpId: PERP,
  requestId: REQUEST,
  fraction: '1',
  ...changes,
});

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  vi.stubEnv('PERP_STAND_IN_SEED', SEED);
  signedIn.mockResolvedValue(PERSON);
  allowTrade.mockResolvedValue({ allowed: true });
  refreshEdge.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the perps' prices", () => {
  it('answer anyone, kept at the edge for 5 seconds and tagged, reading nobody', async () => {
    signedIn.mockResolvedValue(null);
    calls.listedPerps.mockResolvedValue({ perps: [perpDetails] });
    calls.perpDetails.mockResolvedValue(perpDetails);
    for (const path of ['/api/v1/perps', `/api/v1/perps/${PERP}`]) {
      const shown = await answer('GET', path);
      expect(shown.status, path).toBe(200);
      expect(shown.headers['cache-control'], path).toBe('public, max-age=0, must-revalidate');
      expect(shown.headers['vercel-cdn-cache-control'], path).toBe(
        'max-age=5, stale-while-revalidate=10',
      );
      expect(shown.headers['vercel-cache-tag'], path).toBe('perps');
    }
    expect(calls.listedPerps).toHaveBeenCalledWith(pool, { seed: SEED });
    expect(calls.perpDetails).toHaveBeenCalledWith(pool, PERP, { seed: SEED });
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('without a seed here, or with one that is no seed, are "not set up", never kept', async () => {
    for (const seed of ['', 'not-a-seed', '0123456789ABCDEF']) {
      vi.stubEnv('PERP_STAND_IN_SEED', seed);
      calls.listedPerps.mockRejectedValueOnce(new PerpNotSetUpError());
      const shown = await answer('GET', '/api/v1/perps');
      expect(shown.status, seed).toBe(503);
      expect(shown.headers['cache-control'], seed).toBe('private, no-store');
      expect(shown.headers['vercel-cdn-cache-control'], seed).toBeUndefined();
      expect(calls.listedPerps).toHaveBeenLastCalledWith(pool, { seed: undefined });
    }
  });

  it('answer no such perp, an address that is no perp, and a busy database, none kept', async () => {
    calls.perpDetails.mockRejectedValueOnce(new PerpTradingError('not_found', 'No such perp'));
    const missing = await answer('GET', `/api/v1/perps/${PERP}`);
    expect(missing).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
    expect(missing.headers['cache-control']).toBe('private, no-store');
    expect((await answer('GET', '/api/v1/perps/not-a-perp')).status).toBe(400);
    calls.perpDetails.mockRejectedValueOnce(new DatabaseBusyError());
    const busy = await answer('GET', `/api/v1/perps/${PERP}`);
    expect(busy.status).toBe(503);
    expect(busy.headers['vercel-cdn-cache-control']).toBeUndefined();
  });
});

describe('a perp trade', () => {
  it('opens and closes for the signed-in person, each counted, never kept', async () => {
    calls.openPerp.mockResolvedValue(perpOpened);
    calls.closePerp.mockResolvedValue(perpClosed);
    const opened = await answer('POST', '/api/v1/perps/open', open());
    expect(opened).toMatchObject({ status: 200, body: perpOpened });
    expect(opened.headers['cache-control']).toBe('private, no-store');
    expect(calls.openPerp).toHaveBeenCalledWith(pool, PERSON.id, open(), { seed: SEED });
    const closed = await answer('POST', '/api/v1/perps/close', close());
    expect(closed).toMatchObject({ status: 200, body: perpClosed });
    expect(calls.closePerp).toHaveBeenCalledWith(pool, PERSON.id, close(), { seed: SEED });
    expect(allowTrade).toHaveBeenCalledTimes(2);
    expect(allowTrade).toHaveBeenCalledWith(PERSON.id);
    // A trade changes the pools, never the price: the edge copies age out on their own.
    expect(refreshEdge).not.toHaveBeenCalled();
  });

  it('refuses, before anything runs, what the contract does not take', async () => {
    for (const [what, path, sent] of [
      ['leverage under 1', '/api/v1/perps/open', open({ leverage: '0.5' })],
      ['a margin of zero', '/api/v1/perps/open', open({ margin: '0' })],
      ['a margin as a number', '/api/v1/perps/open', open({ margin: 100 })],
      ['no direction', '/api/v1/perps/open', open({ direction: undefined })],
      ['no request ID', '/api/v1/perps/open', open({ requestId: undefined })],
      ['a share of zero', '/api/v1/perps/close', close({ fraction: '0' })],
      ['more than all of it', '/api/v1/perps/close', close({ fraction: '1.5' })],
      ['part, without the size it was sized on', '/api/v1/perps/close', close({ fraction: '0.5' })],
    ] as const) {
      const refused = await answer('POST', path, sent);
      expect(refused.status, what).toBe(400);
      expect(refused.body?.code, what).toBe('BAD_REQUEST');
      expect(refused.headers['cache-control'], what).toBe('private, no-store');
    }
    expect(allowTrade).not.toHaveBeenCalled();
    expect(calls.openPerp).not.toHaveBeenCalled();
    expect(calls.closePerp).not.toHaveBeenCalled();
  });

  it('refuses someone not signed in, counting nothing, and anyone over the limit', async () => {
    signedIn.mockResolvedValueOnce(null);
    expect((await answer('POST', '/api/v1/perps/open', open())).status).toBe(401);
    expect(allowTrade).not.toHaveBeenCalled();
    allowTrade.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 9 });
    const limited = await answer('POST', '/api/v1/perps/close', close());
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('9');
    expect(limited.body).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      data: { retryAfterSeconds: 9 },
    });
    expect(calls.openPerp).not.toHaveBeenCalled();
    expect(calls.closePerp).not.toHaveBeenCalled();
  });

  it('answers every refusal with its reason, and the rest by kind', async () => {
    const cases: [unknown, number, Record<string, unknown>][] = [
      [
        new PerpTradingError('refused', 'Leverage 11 is more than 10', 'leverage_too_high'),
        422,
        { code: 'REFUSED', defined: true, data: { reason: 'leverage_too_high' } },
      ],
      [
        new PerpTradingError('refused', 'More than the balance', 'insufficient_balance'),
        422,
        { code: 'REFUSED', data: { reason: 'insufficient_balance' } },
      ],
      [
        new PerpTradingError('refused', 'Perp trading is halted.', 'trading_off'),
        422,
        { code: 'REFUSED', data: { reason: 'trading_off' } },
      ],
      [
        new PerpTradingError('refused', 'The perp is closing-only', 'trading_off'),
        422,
        { code: 'REFUSED', data: { reason: 'trading_off' } },
      ],
      [new PerpTradingError('not_found', 'No such perp'), 404, { code: 'NOT_FOUND' }],
      [new PerpTradingError('conflict', 'Used already'), 409, { code: 'CONFLICT' }],
      [new PerpTradingError('invalid', 'Not valid'), 400, { code: 'BAD_REQUEST' }],
      [new PerpNotSetUpError(), 503, { code: 'SERVICE_UNAVAILABLE' }],
      [new DatabaseBusyError(), 503, { code: 'SERVICE_UNAVAILABLE' }],
    ];
    for (const [failure, status, body] of cases) {
      calls.openPerp.mockRejectedValueOnce(failure);
      const refused = await answer('POST', '/api/v1/perps/open', open());
      expect(refused.status, String(failure)).toBe(status);
      expect(refused.body, String(failure)).toMatchObject(body);
      expect(refused.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('is refused from another site, before anything runs', async () => {
    const headers = { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' };
    expect((await answer('POST', '/api/v1/perps/open', open(), headers)).status).toBe(403);
    expect((await answer('POST', '/api/v1/perps/close', close(), headers)).status).toBe(403);
    expect(signedIn).not.toHaveBeenCalled();
    expect(calls.openPerp).not.toHaveBeenCalled();
  });
});

describe("the person's own perp positions", () => {
  it('answer only someone signed in, never kept', async () => {
    calls.perpPositions.mockResolvedValue(perpPositionsPage);
    const page = await answer('GET', '/api/v1/me/perps');
    expect(page).toMatchObject({ status: 200, body: perpPositionsPage });
    expect(page.headers['cache-control']).toBe('private, no-store');
    expect(calls.perpPositions).toHaveBeenCalledWith(
      pool,
      PERSON.id,
      { after: undefined },
      {
        seed: SEED,
      },
    );
    signedIn.mockResolvedValue(null);
    expect((await answer('GET', '/api/v1/me/perps')).status).toBe(401);
  });
});

describe("the console's perp changes clear the perps at the edge", () => {
  it('the off switch, the settings and retiring a test perp do; making one does not', async () => {
    isAdmin.mockResolvedValue(true);
    for (const name of [
      'setPerpMode',
      'setPerpSettings',
      'retireTestPerp',
      'createTestPerp',
    ] as const) {
      calls[name].mockResolvedValue(consolePerpWithLog);
    }
    const id = consolePerpWithLog.id;
    await answer('POST', `/api/v1/admin/perps/${id}/mode`, { mode: 'enabled', reason: 'On' });
    await answer('POST', `/api/v1/admin/perps/${id}/settings`, {
      settings: { maxLeverage: '5' },
      reason: 'Gentler',
    });
    await answer('POST', `/api/v1/admin/perps/${id}/retire`, { reason: 'Done' });
    expect(refreshEdge.mock.calls).toEqual([[['perps']], [['perps']], [['perps']]]);
    refreshEdge.mockClear();
    const made = await answer('POST', '/api/v1/admin/perps', {
      id: '01a1ff00-0000-7000-8000-000000000002',
      name: 'A check run’s own test perp',
      seed: '0123456789abcdef',
      standIn: {
        origin: new Date(Date.now() - 60_000).toISOString(),
        startPrice: '100',
        volatility: '40',
      },
      settings: {
        maxLeverage: '10',
        takerFeeBps: '10',
        takerFeeImpact: '0',
        fundingPeriodMs: '3600000',
        fundingSensitivity: '1',
        maxFundingRate: '0.0001',
        maxPriceAgeMs: '120000',
        subsidyLong: '1000',
        subsidyShort: '1000',
      },
      reason: 'A run',
    });
    expect(made.status).toBe(201);
    expect(calls.createTestPerp).toHaveBeenCalled();
    expect(refreshEdge).not.toHaveBeenCalled();
  });
});
