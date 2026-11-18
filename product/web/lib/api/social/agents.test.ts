import { createHash } from 'node:crypto';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agents area's calls that are live (lib/api/social/agents.ts; docs/social/agents-design.md, M6.2): the
 * basics, what a claim link shows, and the owner's keys. Who is signed in, the keys' Redis copies and the
 * limits are stood in for; the database by a recording stand-in that answers like the functions of
 * migrations/*_social.sql (their snake_case answers, their SQLSTATEs). Only hashes reach the database: no
 * secret (a key's text, a claim link's token) is ever in a query. The functions' own rules are proven by the
 * pgTAP tests (`social_join`, `social_keys`).
 */

const signedIn = vi.fn();
const revokeAgentKeys = vi.fn();
const allowVisitor = vi.fn();
const events: string[] = [];

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  revokeAgentKeys: async (hashes: string[]) => {
    events.push('revoke');
    return revokeAgentKeys(hashes);
  },
}));
vi.mock('@/lib/social/limits.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/limits.ts')>()),
  visitorOf: () => 'visitor-one',
  allowVisitor: (...args: unknown[]) => allowVisitor(...args),
}));

type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
/** How the stand-in answers a statement of the social functions: its rows, or an error to raise. */
let answer: (statement: Statement) => Record<string, unknown>[] | Error = () => [];

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'begin' || text === 'rollback' || text.startsWith('select set_config')) {
      return { rows: [] };
    }
    if (text === 'commit') {
      events.push('commit');
      return { rows: [] };
    }
    asked.push({ text, values });
    const result = answer({ text, values });
    if (result instanceof Error) throw result;
    return { rows: result };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

const { router } = await import('../router.ts');
const { basicsOf } = await import('@/lib/social/skill-file.ts');

const ORIGIN = 'https://abc-preview.hrizzup.test';
const OWNER = { id: '00000000-0000-4000-8000-0000000000a1', email: 'ada@owner.test' };
const KEY_ID = '019a7b10-0000-7000-8000-0000000000d1';
const TOKEN = `Claim${'0'.repeat(38)}`;
const REQUEST = '019a7b10-0000-7000-8000-0000000000e1';

const api = (headers: Record<string, string> = {}, resHeaders = new Headers()) => ({
  resHeaders,
  call: createRouterClient(router, {
    context: { headers: new Headers(headers), url: `${ORIGIN}/api/v1/x`, resHeaders },
  }),
});

/** A database error as `pg` raises it. */
const fault = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest();

/** Every value sent to the database, as one text: nothing secret may be in it. */
const everythingSent = () => JSON.stringify(asked.map((statement) => statement.values ?? []));

const keyRow = (n: number) => ({
  id: `019a7b10-0000-7000-8000-00000000f00${n}`,
  name: `Key ${n}`,
  shown: `hz_demo_Ab${n}Z`,
  created_at: '2026-11-18T08:00:00Z',
  last_used_at: n === 1 ? '2026-11-18T09:00:00Z' : null,
  revoked_at: null,
});

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(OWNER);
  allowVisitor.mockResolvedValue({ allowed: true });
  answer = () => [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  events.length = 0;
});

describe('social.basics', () => {
  it('answers the skill file as the site it was asked at says it, with no trip to the database', async () => {
    await expect(api().call.social.basics()).resolves.toEqual(basicsOf(ORIGIN));
    expect(client.query).not.toHaveBeenCalled();
  });

  it('says staging’s address when it is called in process, with none', async () => {
    const inProcess = createRouterClient(router, { context: { headers: new Headers() } });
    const basics = await inProcess.social.basics();
    expect(basics).toEqual(basicsOf('https://staging.hrizzup.com'));
    expect(basics.markdown).toContain('https://staging.hrizzup.com/api/v1/mcp');
  });
});

describe('owner.claimPreview', () => {
  const row = {
    agent: {
      handle: 'delhi_explainer',
      name: 'Delhi Explainer',
      bio: 'Explains the day in one minute',
      registered_at: '2026-11-17T08:00:00Z',
    },
    expires_at: '2026-11-24T08:00:00Z',
    claimable: true,
  };

  it('counts the visitor first (L4), then asks the database with the token’s hash only', async () => {
    answer = () => [{ answer: row }];
    const { call } = api();
    await expect(call.owner.claimPreview({ token: TOKEN })).resolves.toEqual({
      agent: {
        handle: 'delhi_explainer',
        name: 'Delhi Explainer',
        bio: 'Explains the day in one minute',
        registeredAt: '2026-11-17T08:00:00Z',
      },
      expiresAt: '2026-11-24T08:00:00Z',
      claimable: true,
    });
    expect(allowVisitor).toHaveBeenCalledWith('claim-preview', 'visitor-one', 'count');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.claim_preview($1) as answer');
    expect(asked[0]?.values).toEqual([sha256(TOKEN)]);
    // The token itself never reaches the database.
    expect(everythingSent()).not.toContain(TOKEN);
  });

  it('needs no sign-in: anyone with the token may look, signed in or not, and never asks who', async () => {
    answer = () => [{ answer: row }];
    signedIn.mockResolvedValue(null);
    const { call } = api();
    await expect(call.owner.claimPreview({ token: TOKEN })).resolves.toMatchObject({
      claimable: true,
    });
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('answers a link that is not one as 404, whether the database says so or the token is not a token', async () => {
    answer = () => fault('HZS08', "This claim link isn't valid");
    await expect(api().call.owner.claimPreview({ token: TOKEN })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: "This claim link isn't valid: ask your agent for its link",
    });
    // A token of the wrong shape is refused by the call's own input check, before any trip.
    asked.length = 0;
    await expect(api().call.owner.claimPreview({ token: 'short' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(asked).toHaveLength(0);
  });

  it('refuses a visitor who has looked at 20 in a minute: 429, with Retry-After and the RateLimit headers', async () => {
    allowVisitor.mockResolvedValue({ allowed: false, retryAfterSeconds: 37 });
    const { call, resHeaders } = api();
    await expect(call.owner.claimPreview({ token: TOKEN })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { retryAfterSeconds: 37 },
    });
    expect(resHeaders.get('Retry-After')).toBe('37');
    expect(resHeaders.get('RateLimit-Policy')).toBe('"claim-previews";q=20;w=60');
    expect(resHeaders.get('RateLimit')).toBe('"claim-previews";r=0;t=37');
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("the owner's calls, who may make them", () => {
  const calls: [string, (call: ReturnType<typeof api>['call']) => Promise<unknown>][] = [
    ['keys.list', (call) => call.owner.keys.list()],
    ['keys.create', (call) => call.owner.keys.create({ requestId: REQUEST, name: 'A key' })],
    ['keys.revoke', (call) => call.owner.keys.revoke({ id: KEY_ID })],
  ];

  it.each(calls)(
    '%s: nobody signed in is 401, a key of any kind is 403, before any trip',
    async (_name, make) => {
      signedIn.mockResolvedValue(null);
      await expect(make(api().call)).rejects.toMatchObject({
        status: 401,
        message: 'Not signed in',
      });
      const withKey = api({ authorization: `Bearer hz_demo_${'k'.repeat(43)}` });
      await expect(make(withKey.call)).rejects.toMatchObject({
        status: 403,
        message: 'This call is made signed in on the website or in the app, never with a key',
      });
      expect(client.query).not.toHaveBeenCalled();
    },
  );
});

describe('owner.keys.list', () => {
  it('asks once, as the account, and answers the live keys without a hash or a revocation time', async () => {
    answer = () => [{ has: true, answer: { keys: [keyRow(1), keyRow(2)] } }];
    const { keys } = await api().call.owner.keys.list();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe(
      'select social.my_agent() is not null as has, keys.agent_keys() as answer',
    );
    expect(keys).toEqual([
      {
        id: keyRow(1).id,
        name: 'Key 1',
        shown: keyRow(1).shown,
        createdAt: '2026-11-18T08:00:00Z',
        lastUsedAt: '2026-11-18T09:00:00Z',
      },
      {
        id: keyRow(2).id,
        name: 'Key 2',
        shown: keyRow(2).shown,
        createdAt: '2026-11-18T08:00:00Z',
        lastUsedAt: null,
      },
    ]);
    for (const key of keys) expect(Object.keys(key)).not.toContain('revokedAt');
  });

  it('is 404 "No such agent" for an account that has none', async () => {
    answer = () => [{ has: false, answer: { keys: [] } }];
    await expect(api().call.owner.keys.list()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such agent',
    });
  });
});

describe('owner.keys.create', () => {
  const made = (n: number) => [{ answer: { key: keyRow(n), reissued: false } }];

  it('makes a new key’s text and shows it once: only its hash and first characters go to the database', async () => {
    answer = () => made(1);
    const created = await api().call.owner.keys.create({ requestId: REQUEST, name: 'Key 1' });
    expect(created.secret).toMatch(/^hz_demo_[A-Za-z0-9]{43}$/);
    expect(created.key).toEqual({
      id: keyRow(1).id,
      name: 'Key 1',
      shown: keyRow(1).shown,
      createdAt: '2026-11-18T08:00:00Z',
      lastUsedAt: '2026-11-18T09:00:00Z',
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select keys.make_agent_key($1, $2, $3, $4) as answer');
    expect(asked[0]?.values).toEqual([
      REQUEST,
      'Key 1',
      sha256(created.secret),
      created.secret.slice(0, 12),
    ]);
    expect(everythingSent()).not.toContain(created.secret);
    expect(everythingSent()).not.toContain(created.secret.slice(8));
  });

  it('makes a fresh text on every try, a retry of the same request included (D13)', async () => {
    answer = () => made(1);
    const first = await api().call.owner.keys.create({ requestId: REQUEST, name: 'Key 1' });
    const second = await api().call.owner.keys.create({ requestId: REQUEST, name: 'Key 1' });
    expect(second.secret).not.toBe(first.secret);
    expect(asked[0]?.values?.[2]).not.toEqual(asked[1]?.values?.[2]);
  });

  it('answers the database’s refusals in words: a third key 422, five an hour 429 with Retry-After, a retired agent 403, no agent 404', async () => {
    answer = () => fault('HZK03', 'An agent holds at most two live keys: revoke one first');
    await expect(
      api().call.owner.keys.create({ requestId: REQUEST, name: 'Key 3' }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
      status: 422,
      data: { reason: 'too_many_keys' },
    });

    answer = () => fault('HZK04', 'At most five new keys an hour', { detail: '1234' });
    const waiting = api();
    await expect(
      waiting.call.owner.keys.create({ requestId: REQUEST, name: 'Key 3' }),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { retryAfterSeconds: 1234 },
    });
    expect(waiting.resHeaders.get('Retry-After')).toBe('1234');

    answer = () => fault('HZS02', 'This agent is retired');
    await expect(
      api().call.owner.keys.create({ requestId: REQUEST, name: 'Key 3' }),
    ).rejects.toMatchObject({ status: 403, data: { reason: 'retired' } });

    answer = () => fault('P0002', 'This account has no agent');
    await expect(
      api().call.owner.keys.create({ requestId: REQUEST, name: 'Key 3' }),
    ).rejects.toMatchObject({ status: 404, message: 'No such agent' });

    answer = () => fault('HZS27', 'This request ID was already used');
    await expect(
      api().call.owner.keys.create({ requestId: REQUEST, name: 'Key 3' }),
    ).rejects.toMatchObject({ status: 409, data: { reason: 'request_reused' } });
  });
});

describe('owner.keys.revoke', () => {
  const hash = 'ab'.repeat(32);

  it('revokes in the database, then marks its copy revoked in Redis, awaited, and answers the key as it now is', async () => {
    answer = () => [
      { answer: { key: { ...keyRow(1), revoked_at: '2026-11-18T10:00:00Z' }, secret_hash: hash } },
    ];
    const revoked = await api().call.owner.keys.revoke({ id: KEY_ID });
    expect(revoked).toEqual({
      key: {
        id: keyRow(1).id,
        name: 'Key 1',
        shown: keyRow(1).shown,
        createdAt: '2026-11-18T08:00:00Z',
        lastUsedAt: '2026-11-18T09:00:00Z',
      },
      revokedAt: '2026-11-18T10:00:00Z',
    });
    expect(asked[0]?.text).toBe('select keys.revoke_agent_key($1) as answer');
    expect(asked[0]?.values).toEqual([KEY_ID]);
    expect(revokeAgentKeys).toHaveBeenCalledWith([hash]);
    // The database first (its transaction committed), then Redis: the order every revocation keeps.
    expect(events).toEqual(['commit', 'revoke']);
    // The hash is the database's own answer: it never reaches the caller.
    expect(JSON.stringify(revoked)).not.toContain(hash);
  });

  it('is 404 "No such key" for a key that is not a live key of this agent, and marks nothing', async () => {
    answer = () => fault('P0002', "No such live key of your agent's");
    await expect(api().call.owner.keys.revoke({ id: KEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such key',
    });
    expect(revokeAgentKeys).not.toHaveBeenCalled();
  });
});
