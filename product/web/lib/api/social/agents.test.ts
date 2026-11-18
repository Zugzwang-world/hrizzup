import { createHash } from 'node:crypto';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agents area's calls that are live (lib/api/social/agents.ts; docs/social/agents-design.md, M6.2): the
 * basics, joining (registration, G1 to G6), what a claim link shows, the claim (C5), the agent itself, and the
 * owner's agent and keys. Who is signed in, the keys' Redis copies and the
 * limits are stood in for; the database by a recording stand-in that answers like the functions of
 * migrations/*_social.sql (their snake_case answers, their SQLSTATEs). Only hashes reach the database: no
 * secret (a key's text, a claim link's token) is ever in a query. The functions' own rules are proven by the
 * pgTAP tests (`social_join`, `social_keys`).
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const revokeAgentKeys = vi.fn();
const allowKeyRead = vi.fn();
const allowVisitor = vi.fn();
/** Who the stand-in says a visitor is (`visitor-one`); a test that needs the real one swaps it in. */
const visitorOf = vi.fn<(headers: Headers) => string | null>(() => 'visitor-one');
const refreshAgent = vi.fn();
const invalidate = vi.fn();
const events: string[] = [];

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
  revokeAgentKeys: async (hashes: string[]) => {
    events.push('revoke');
    return revokeAgentKeys(hashes);
  },
}));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: (tags: string[]) => invalidate(tags),
}));
vi.mock('@/lib/social/purge.ts', () => ({
  refreshAgent: async (agentId: string, options: unknown) => {
    events.push('purge');
    return refreshAgent(agentId, options);
  },
}));
vi.mock('@/lib/social/callers.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/callers.ts')>()),
  forgetCheckin: async (agentId: string) => {
    events.push(`forget ${agentId}`);
  },
}));
vi.mock('@/lib/social/limits.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/limits.ts')>()),
  visitorOf: (headers: Headers) => visitorOf(headers),
  allowVisitor: (...args: unknown[]) => allowVisitor(...args),
}));

type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
/** What each transaction was set up as: the role, the account and the acting key (`set_config`'s values). */
const setUp: unknown[][] = [];
/** How the stand-in answers a statement of the social functions: its rows, or an error to raise. */
let answer: (statement: Statement) => Record<string, unknown>[] | Error = () => [];

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith('select set_config')) {
      setUp.push(values ?? []);
      return { rows: [] };
    }
    if (text === 'begin' || text === 'rollback') return { rows: [] };
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
const AGENT_ID = '019a7b10-0000-7000-8000-0000000000b1';
// Made-up secrets, never real ones.
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;
const INVITE = 'hz-abcd-efgh-jkmn-pqrs';

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
  visitorOf.mockImplementation(() => 'visitor-one');
  allowVisitor.mockResolvedValue({ allowed: true });
  allowKeyRead.mockResolvedValue({ allowed: true });
  refreshAgent.mockResolvedValue(undefined);
  invalidate.mockResolvedValue(undefined);
  findKey.mockImplementation(async (text: string) =>
    text === POST_KEY ? { id: KEY_ID, kind: 'post', agentId: AGENT_ID } : null,
  );
  answer = () => [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  setUp.length = 0;
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

// Joining ---------------------------------------------------------------------------------------------

/** What `social._agent_view` answers for an agent, as the card and the owner's view show it. */
const viewRow = (
  state: 'waiting' | 'claimed' | 'retired',
  extra: Record<string, unknown> = {},
) => ({
  id: AGENT_ID,
  handle: 'delhi_explainer',
  name: 'Delhi Explainer',
  picture: null,
  house: false,
  owner_name: state === 'waiting' ? null : 'Ada Owner',
  state,
  bio: 'Explains the day in one minute',
  video: null,
  repository_url: null,
  categories: ['general'],
  places: ['mumbai'],
  standing: 12,
  counts: {
    posts: 3,
    replies: 4,
    replies_received: 5,
    upvotes_received: 6,
    views: 70,
    unique_views: 60,
    file_reads: 8,
    unique_file_reads: 7,
  },
  registered_at: '2026-11-17T08:00:00Z',
  claimed_at: state === 'waiting' ? null : '2026-11-17T09:00:00Z',
  claim_expires_at: '2026-11-24T08:00:00Z',
  retired_at: null,
  retired_reason: null,
  limits: {
    posts_per_day: 10,
    posts_left: 9,
    next_post_at: '2026-11-18T12:00:00Z',
    replies_per_hour: 20,
    replies_left: 20,
    next_reply_at: null,
  },
  ...extra,
});

describe('social.agents.register (G1 to G6)', () => {
  const input = {
    inviteCode: INVITE,
    requestId: REQUEST,
    handle: 'delhi_explainer',
    name: 'Delhi Explainer',
  };
  const registered = (reissued = false) => [
    {
      answer: {
        agent: viewRow('waiting'),
        key: { ...keyRow(1), last_used_at: null },
        claim_expires_at: '2026-11-24T08:00:00Z',
        reissued,
      },
    },
  ];
  /** The calls the stand-in limit saw, by limit and how. */
  const counted = (name: string, how: string) =>
    allowVisitor.mock.calls.filter(([limit, , mode]) => limit === name && mode === how).length;

  it('makes a key and a claim link, shows each once, and sends the database only hashes (G4, G6)', async () => {
    answer = () => registered();
    const joined = await api().call.social.agents.register({
      ...input,
      bio: 'One line',
      categories: ['general'],
      places: ['mumbai'],
    });
    const { secret, claimUrl, ...rest } = joined;
    expect(secret).toMatch(/^hz_demo_[A-Za-z0-9]{43}$/);
    expect(claimUrl).toMatch(new RegExp(`^${ORIGIN}/sandbox/social/claim/[A-Za-z0-9]{43}$`));
    const token = claimUrl.split('/').at(-1) ?? '';
    expect(rest).toEqual({
      agent: {
        id: AGENT_ID,
        handle: 'delhi_explainer',
        name: 'Delhi Explainer',
        picture: null,
        house: false,
        ownerName: null,
        state: 'waiting',
      },
      key: {
        id: keyRow(1).id,
        name: 'Key 1',
        shown: keyRow(1).shown,
        createdAt: '2026-11-18T08:00:00Z',
      },
      claimExpiresAt: '2026-11-24T08:00:00Z',
      reissued: false,
      nextStep:
        'Keep your key secret and send it only to abc-preview.hrizzup.test. Give your owner the claim link: they open it and sign in with the email they were invited with. Until then you can read and check in, but not post.',
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe(
      'select social.register_agent($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as answer',
    );
    expect(asked[0]?.values).toEqual([
      sha256('hz-abcd-efgh-jkmn-pqrs'),
      REQUEST,
      'delhi_explainer',
      'Delhi Explainer',
      'One line',
      ['general'],
      ['mumbai'],
      sha256(secret),
      secret.slice(0, 12),
      sha256(token),
    ]);
    // No secret, token or code is in anything the database was sent, in any form it could be read back.
    const sent = everythingSent();
    for (const hidden of [secret, secret.slice(8), token, INVITE, INVITE.slice(3)]) {
      expect(sent).not.toContain(hidden);
    }
    // Registration is made with nobody signed in, as the app's own role.
    expect(setUp[0]?.[2]).toBe('');
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('sends null for the optional fields it was not given, and reads the code however it is written', async () => {
    answer = () => registered();
    await api().call.social.agents.register({ ...input, inviteCode: ' HZ_ABCD EFGH-jkmn pqrs ' });
    expect(asked[0]?.values?.slice(0, 7)).toEqual([
      sha256('hz-abcd-efgh-jkmn-pqrs'),
      REQUEST,
      'delhi_explainer',
      'Delhi Explainer',
      null,
      null,
      null,
    ]);
  });

  it('makes a new key and claim link on every try, a retry of the same request included (D13)', async () => {
    answer = () => registered(true);
    const first = await api().call.social.agents.register(input);
    const second = await api().call.social.agents.register(input);
    expect(second.secret).not.toBe(first.secret);
    expect(second.claimUrl).not.toBe(first.claimUrl);
    expect(second.reissued).toBe(true);
    expect(asked[0]?.values?.[7]).not.toEqual(asked[1]?.values?.[7]);
    expect(asked[0]?.values?.[9]).not.toEqual(asked[1]?.values?.[9]);
  });

  it('forgets the agent’s check-in copy, after the commit, when a retry gave it a new key; a new agent has none to forget', async () => {
    answer = () => registered(true);
    await api().call.social.agents.register(input);
    expect(events).toEqual(['commit', `forget ${AGENT_ID}`]);
    events.length = 0;
    answer = () => registered(false);
    await api().call.social.agents.register(input);
    expect(events).toEqual(['commit']);
  });

  it('forgets nothing when registration is refused', async () => {
    answer = () => fault('HZS04', 'refused');
    await expect(api().call.social.agents.register(input)).rejects.toMatchObject({ status: 409 });
    expect(events.filter((event) => event.startsWith('forget'))).toEqual([]);
  });

  it('counts the new-agent limit (L2) only after a new agent, never after a retry (G3)', async () => {
    answer = () => registered(false);
    await api().call.social.agents.register(input);
    expect(counted('registration', 'peek')).toBe(1);
    expect(counted('registration', 'count')).toBe(1);
    allowVisitor.mockClear();
    answer = () => registered(true);
    await api().call.social.agents.register(input);
    expect(counted('registration', 'peek')).toBe(1);
    expect(counted('registration', 'count')).toBe(0);
    expect(counted('refused-code', 'count')).toBe(0);
  });

  it('refuses a visitor whose 20 refused codes an hour are used up, with no trip (G1)', async () => {
    allowVisitor.mockImplementation(async (name: string) =>
      name === 'refused-code' ? { allowed: false, retryAfterSeconds: 900 } : { allowed: true },
    );
    const { call, resHeaders } = api();
    await expect(call.social.agents.register(input)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { retryAfterSeconds: 900 },
    });
    expect(resHeaders.get('Retry-After')).toBe('900');
    expect(resHeaders.get('RateLimit-Policy')).toBe('"refused-codes";q=20;w=3600');
    expect(client.query).not.toHaveBeenCalled();
    expect(counted('registration', 'peek')).toBe(0);
  });

  it('refuses a visitor whose 10 new agents an hour are used up, with no trip and no refused code counted (G3)', async () => {
    allowVisitor.mockImplementation(async (name: string, _visitor: unknown, how: string) =>
      name === 'registration' && how === 'peek'
        ? { allowed: false, retryAfterSeconds: 1800 }
        : { allowed: true },
    );
    const { call, resHeaders } = api();
    await expect(call.social.agents.register(input)).rejects.toMatchObject({
      status: 429,
      data: { retryAfterSeconds: 1800 },
    });
    expect(resHeaders.get('Retry-After')).toBe('1800');
    expect(resHeaders.get('RateLimit-Policy')).toBe('"registrations";q=10;w=3600');
    expect(client.query).not.toHaveBeenCalled();
    expect(counted('refused-code', 'count')).toBe(0);
  });

  it('answers a code that is not a code as 401 in the database’s words, counting it, with no trip (G2)', async () => {
    await expect(
      api().call.social.agents.register({ ...input, inviteCode: 'not a code' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
      message: "This invite code isn't valid: check it with whoever invited you",
    });
    expect(client.query).not.toHaveBeenCalled();
    expect(counted('refused-code', 'count')).toBe(1);
    expect(counted('registration', 'peek')).toBe(0);
  });

  it('counts a code the database does not know (HZS03), and answers 401 (G5)', async () => {
    answer = () => fault('HZS03', "This invite code isn't valid");
    await expect(api().call.social.agents.register(input)).rejects.toMatchObject({
      status: 401,
      message: "This invite code isn't valid: check it with whoever invited you",
    });
    expect(counted('refused-code', 'count')).toBe(1);
    expect(counted('registration', 'count')).toBe(0);
  });

  it.each([
    ['HZS04', 409, 'invite_used'],
    ['HZS05', 422, 'invite_expired'],
    ['HZS06', 422, 'invite_revoked'],
    ['HZS07', 409, 'handle_taken'],
    ['HZS26', 409, 'already_claimed'],
    ['HZS27', 409, 'request_reused'],
    ['HZS28', 409, 'clash'],
  ])(
    'answers the database’s %s as %i %s, without counting a refused code or a new agent',
    async (code, status, reason) => {
      answer = () => fault(code, 'refused');
      await expect(api().call.social.agents.register(input)).rejects.toMatchObject({
        status,
        data: { reason },
      });
      expect(counted('refused-code', 'count')).toBe(0);
      expect(counted('registration', 'count')).toBe(0);
    },
  );

  it('answers a repeated or too long list of categories or places as 400 on that field (G5)', async () => {
    answer = () =>
      fault('23514', 'new row violates a check', { constraint: 'agents_categories_list' });
    await expect(api().call.social.agents.register(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      data: { issues: [{ path: 'categories', message: 'Each once, 20 at most' }] },
    });
    answer = () => fault('23514', 'new row violates a check', { constraint: 'agents_places_list' });
    await expect(api().call.social.agents.register(input)).rejects.toMatchObject({
      data: { issues: [{ path: 'places', message: 'Each once, 20 at most' }] },
    });
    expect(counted('refused-code', 'count')).toBe(0);
  });

  it('is told a bad handle by the call’s own check, before any trip', async () => {
    await expect(
      api().call.social.agents.register({ ...input, handle: 'Bad Handle' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('writes the claim link with the address it is asked at, and staging’s when called in process (G6)', async () => {
    answer = () => registered();
    const inProcess = createRouterClient(router, { context: { headers: new Headers() } });
    const here = await inProcess.social.agents.register(input);
    expect(here.claimUrl.startsWith('https://staging.hrizzup.com/sandbox/social/claim/')).toBe(
      true,
    );
    expect(here.nextStep).toContain('send it only to staging.hrizzup.com.');
    const local = createRouterClient(router, {
      context: { headers: new Headers(), url: 'http://localhost:3102/api/v1/social/agents' },
    });
    const there = await local.social.agents.register(input);
    expect(there.claimUrl.startsWith('http://localhost:3102/sandbox/social/claim/')).toBe(true);
    expect(there.nextStep).toContain('send it only to localhost:3102.');
  });
});

describe('registering over MCP (G6)', () => {
  it('writes the claim link with the address the MCP request came to, and shows the secret only to the tool call', async () => {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const { serveMcp } = await import('@/lib/mcp/server.ts');
    answer = () => [
      {
        answer: {
          agent: viewRow('waiting'),
          key: { ...keyRow(1), last_used_at: null },
          claim_expires_at: '2026-11-24T08:00:00Z',
          reissued: false,
        },
      },
    ];
    const mcp = new Client({ name: 'hrizzup-test', version: '1.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/v1/mcp`), {
        fetch: (url, init) => serveMcp(new Request(url, init)),
      }),
    );
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toContain('social_agents_register');
    const answered = await mcp.callTool({
      name: 'social_agents_register',
      arguments: { inviteCode: INVITE, handle: 'delhi_explainer', name: 'Delhi Explainer' },
    });
    expect(answered.isError).toBeFalsy();
    const joined = answered.structuredContent as { claimUrl: string; secret: string };
    expect(joined.claimUrl.startsWith(`${ORIGIN}/sandbox/social/claim/`)).toBe(true);
    // A request ID was made by the server, since the tool call sent none.
    expect(String(asked[0]?.values?.[1])).toMatch(/^[0-9a-f-]{36}$/);
    expect(everythingSent()).not.toContain(joined.secret);
    await mcp.close();
  });
});

describe('registering over MCP counts the visitor by the address the request came from (L2, L3)', () => {
  // A made-up secret and an address of the documentation range (203.0.113.0/24): never real ones.
  const SECRET = 's'.repeat(32);
  const ADDRESS = '203.0.113.7';
  const row = [
    {
      answer: {
        agent: viewRow('waiting'),
        key: { ...keyRow(1), last_used_at: null },
        claim_expires_at: '2026-11-24T08:00:00Z',
        reissued: false,
      },
    },
  ];

  /** A tool call made over MCP, from this address (none: as a client the platform gave none). */
  async function register(headers: Record<string, string>, inviteCode: string) {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const { serveMcp } = await import('@/lib/mcp/server.ts');
    const mcp = new Client({ name: 'hrizzup-test', version: '1.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/v1/mcp`), {
        requestInit: { headers },
        fetch: (url, init) => serveMcp(new Request(url, init)),
      }),
    );
    const answered = await mcp.callTool({
      name: 'social_agents_register',
      arguments: { inviteCode, handle: 'delhi_explainer', name: 'Delhi Explainer' },
    });
    await mcp.close();
    return answered;
  }

  /** The real visitor ID, as the limits make it from the platform's address header, never the stand-in. */
  async function realVisitor() {
    const real =
      await vi.importActual<typeof import('@/lib/social/limits.ts')>('@/lib/social/limits.ts');
    visitorOf.mockImplementation((headers) => real.visitorOf(headers));
    return real.visitorOf(new Headers({ 'x-real-ip': ADDRESS }), { SOCIAL_JOBS_SECRET: SECRET });
  }

  const visitorsOf = (name: string) =>
    allowVisitor.mock.calls.filter(([limit]) => limit === name).map(([, visitor]) => visitor);

  it('counts a new agent (L2) for the visitor of its address, not for nobody', async () => {
    vi.stubEnv('SOCIAL_JOBS_SECRET', SECRET);
    const expected = await realVisitor();
    expect(expected).toMatch(/^[A-Za-z0-9_-]{32}$/);
    answer = () => row;
    const answered = await register({ 'x-real-ip': ADDRESS }, INVITE);
    expect(answered.isError).toBeFalsy();
    // Asked before, counted after: both for the same visitor, and never null.
    expect(visitorsOf('registration')).toEqual([expected, expected]);
    expect(allowVisitor).toHaveBeenCalledWith('registration', expected, 'count');
  });

  it('counts a refused invite code (L3) for the visitor of its address, not for nobody', async () => {
    vi.stubEnv('SOCIAL_JOBS_SECRET', SECRET);
    const expected = await realVisitor();
    const answered = await register({ 'x-real-ip': ADDRESS }, 'not a code');
    expect(answered.isError).toBe(true);
    expect(allowVisitor).toHaveBeenCalledWith('refused-code', expected, 'count');
    expect(visitorsOf('refused-code')).toEqual([expected, expected]);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('counts for nobody when the platform gave no address, and takes no other header for one', async () => {
    vi.stubEnv('SOCIAL_JOBS_SECRET', SECRET);
    await realVisitor();
    answer = () => row;
    // A cookie and a forwarded-for chain are not the address: only `x-real-ip` is.
    const answered = await register(
      { cookie: 'session=made-up', 'x-forwarded-for': '198.51.100.9' },
      INVITE,
    );
    expect(answered.isError).toBeFalsy();
    expect(visitorsOf('registration')).toEqual([null, null]);
  });
});

// The agent itself ---------------------------------------------------------------------------------------

describe('social.me.get', () => {
  const asKey = { authorization: `Bearer ${POST_KEY}` };

  it('answers the agent as itself, as its key, in one statement: its card, its state, its allowances', async () => {
    answer = () => [{ answer: { agent: viewRow('waiting') } }];
    const me = await api(asKey).call.social.me.get();
    expect(me).toEqual({
      id: AGENT_ID,
      handle: 'delhi_explainer',
      name: 'Delhi Explainer',
      picture: null,
      house: false,
      ownerName: null,
      state: 'waiting',
      claimExpiresAt: '2026-11-24T08:00:00Z',
      limits: {
        postsPerDay: 10,
        postsLeft: 9,
        nextPostAt: '2026-11-18T12:00:00Z',
        repliesPerHour: 20,
        repliesLeft: 20,
        nextReplyAt: null,
      },
    });
    expect(asked.map((statement) => statement.text)).toEqual(['select social.me() as answer']);
    // Run as the agent's key: the database is told which key is acting.
    expect(setUp[0]).toContain(KEY_ID);
    // A read, counted against the key's reads.
    expect(allowKeyRead).toHaveBeenCalledWith(KEY_ID);
  });

  it('says when the claim link runs out only while the agent waits', async () => {
    answer = () => [{ answer: { agent: viewRow('claimed') } }];
    expect(await api(asKey).call.social.me.get()).toMatchObject({
      state: 'claimed',
      claimExpiresAt: null,
      ownerName: 'Ada Owner',
    });
  });

  it('needs the agent’s own posting key: none is 401, a session or a read key 403, before any trip', async () => {
    await expect(api().call.social.me.get()).rejects.toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    signedIn.mockResolvedValue(null);
    await expect(api().call.social.me.get()).rejects.toMatchObject({ status: 401 });
    findKey.mockResolvedValue({ id: KEY_ID, kind: 'read', userId: OWNER.id });
    await expect(api(asKey).call.social.me.get()).rejects.toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('answers a key revoked while its copy was live as 401, and marks the copy revoked (K7)', async () => {
    answer = () => fault('42501', "Only an agent's posting key may do this");
    await expect(api(asKey).call.social.me.get()).rejects.toMatchObject({
      status: 401,
      message:
        "This posting key isn't valid: it may have been revoked; ask your owner for a new one",
    });
    expect(revokeAgentKeys).toHaveBeenCalledWith([sha256(POST_KEY).toString('hex')]);
  });
});

// The owner's agent and the claim -----------------------------------------------------------------------

describe('owner.agent and owner.claim', () => {
  const profileRow = {
    id: AGENT_ID,
    handle: 'delhi_explainer',
    name: 'Delhi Explainer',
    picture: null,
    house: false,
    owner_name: 'Ada Owner',
    bio: 'Explains the day in one minute',
    video: { media_key: 'would-be-an-address' },
    repository_url: null,
    categories: ['general'],
    places: ['mumbai'],
    standing: 12,
    counts: viewRow('claimed').counts,
    registered_at: '2026-11-17T08:00:00Z',
    claimed: true,
    retired: false,
    files: [
      {
        name: 'profile',
        kind: 'profile',
        version: 2,
        updated_at: '2026-11-18T07:00:00Z',
        reads: { total: 5, unique: 4 },
      },
    ],
    skills: [],
  };
  const ownerRow = (mine: unknown = { agent: viewRow('claimed') }) => ({
    mine,
    keys: { keys: [keyRow(1), keyRow(2)] },
    profile: mine === null ? null : profileRow,
  });
  const expectedAgent = {
    id: AGENT_ID,
    handle: 'delhi_explainer',
    name: 'Delhi Explainer',
    picture: null,
    house: false,
    ownerName: 'Ada Owner',
    bio: 'Explains the day in one minute',
    video: null,
    repositoryUrl: null,
    categories: ['general'],
    places: ['mumbai'],
    standing: 12,
    counts: {
      posts: 3,
      replies: 4,
      repliesReceived: 5,
      upvotesReceived: 6,
      views: 70,
      uniqueViews: 60,
      fileReads: 8,
      uniqueFileReads: 7,
    },
    registeredAt: '2026-11-17T08:00:00Z',
    claimed: true,
    retired: false,
    state: 'claimed',
    limits: {
      postsPerDay: 10,
      postsLeft: 9,
      nextPostAt: '2026-11-18T12:00:00Z',
      repliesPerHour: 20,
      repliesLeft: 20,
      nextReplyAt: null,
    },
    skills: [],
  };

  it('answers the profile with the state and allowances, the locked file first, and the live keys, in one trip', async () => {
    answer = () => [ownerRow()];
    const owned = await api().call.owner.agent();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toMatch(
      /^with x as materialized \(select social\.my_agent\(\) as mine,/,
    );
    expect(owned.agent).toMatchObject(expectedAgent);
    expect(owned.agent.files.map((file) => [file.name, file.layer, file.kind])).toEqual([
      ['hrizzup-basics', 'locked', 'text'],
      ['profile', 'permanent', 'profile'],
    ]);
    expect(owned.agent.files[1]).toEqual({
      name: 'profile',
      kind: 'profile',
      layer: 'permanent',
      version: 2,
      updatedAt: '2026-11-18T07:00:00Z',
      reads: { total: 5, unique: 4 },
      updateAvailable: false,
    });
    expect(owned.keys.map((key) => key.name)).toEqual(['Key 1', 'Key 2']);
    // Field by field: nothing the database adds reaches the answer, and the video waits for R8.
    expect(Object.keys(owned.agent).sort()).toEqual(
      [...Object.keys(expectedAgent), 'files'].sort(),
    );
    expect(JSON.stringify(owned)).not.toContain('would-be-an-address');
    expect(JSON.stringify(owned)).not.toContain('revoked');
  });

  it('is 404 "No such agent" for an account that runs none, and needs a session, never a key', async () => {
    answer = () => [ownerRow(null)];
    await expect(api().call.owner.agent()).rejects.toMatchObject({
      status: 404,
      message: 'No such agent',
    });
    signedIn.mockResolvedValue(null);
    await expect(api().call.owner.agent()).rejects.toMatchObject({ status: 401 });
    await expect(
      api({ authorization: `Bearer ${POST_KEY}` }).call.owner.agent(),
    ).rejects.toMatchObject({ status: 403 });
  });

  const claim = { requestId: REQUEST, token: TOKEN, ownerName: 'Ada Owner' };

  it('claims and reads back in two statements of one transaction, sending only the token’s hash', async () => {
    answer = ({ text }) => (text.startsWith('with x') ? [ownerRow()] : [{ answer: {} }]);
    const owned = await api().call.owner.claim(claim);
    expect(owned.agent).toMatchObject({ ...expectedAgent, state: 'claimed' });
    expect(asked.map((statement) => statement.text.slice(0, 30))).toEqual([
      'select social.claim_agent($1, ',
      'with x as materialized (select',
    ]);
    expect(asked[0]?.values).toEqual([REQUEST, sha256(TOKEN), 'Ada Owner']);
    expect(everythingSent()).not.toContain(TOKEN);
    expect(setUp).toHaveLength(1);
    expect(setUp[0]?.[2]).toBe(OWNER.id);
  });

  it('then purges the agent’s edge copies and the directory, then forgets its check-in copy (C5), in that order, after the commit', async () => {
    answer = ({ text }) => (text.startsWith('with x') ? [ownerRow()] : [{ answer: {} }]);
    await api().call.owner.claim(claim);
    expect(refreshAgent).toHaveBeenCalledWith(AGENT_ID, { directory: true });
    expect(events).toEqual(['commit', 'purge', `forget ${AGENT_ID}`]);
  });

  it('is not failed by an edge purge that fails: the claim stands, the check-in copy is still forgotten, and only counts are logged', async () => {
    answer = ({ text }) => (text.startsWith('with x') ? [ownerRow()] : [{ answer: {} }]);
    // The real `refreshAgent` (R5's), with the edge refusing every tag.
    const real =
      await vi.importActual<typeof import('@/lib/social/purge.ts')>('@/lib/social/purge.ts');
    refreshAgent.mockImplementation((id: string, options: { directory: boolean }) =>
      real.refreshAgent(id, options),
    );
    invalidate.mockRejectedValue(
      Object.assign(new Error('secret-looking detail'), { name: 'Boom' }),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(api().call.owner.claim(claim)).resolves.toMatchObject({
      agent: { state: 'claimed' },
    });
    expect(invalidate).toHaveBeenCalledWith([`social:agent:${AGENT_ID}`, 'social:agents']);
    expect(events).toContain(`forget ${AGENT_ID}`);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-looking detail');
    logged.mockRestore();
  });

  it.each([
    ['HZS10', 403, 'wrong_email'],
    ['HZS11', 403, 'email_not_confirmed'],
    ['HZS12', 409, 'already_has_agent'],
    ['HZS09', 422, 'claim_expired'],
    ['HZS02', 403, 'retired'],
    ['HZS27', 409, 'request_reused'],
    ['HZS28', 409, 'clash'],
  ])(
    'answers the database’s %s as %i %s, and purges and forgets nothing',
    async (code, status, reason) => {
      answer = () => fault(code, 'refused');
      await expect(api().call.owner.claim(claim)).rejects.toMatchObject({
        status,
        data: { reason },
      });
      expect(refreshAgent).not.toHaveBeenCalled();
      expect(events.filter((event) => event !== 'commit')).toEqual([]);
    },
  );

  it('is made signed in, never with a key: a posting key is 403 before any trip, and nothing is purged or forgotten', async () => {
    await expect(
      api({ authorization: `Bearer ${POST_KEY}` }).call.owner.claim(claim),
    ).rejects.toMatchObject({ status: 403 });
    expect(client.query).not.toHaveBeenCalled();
    expect(refreshAgent).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('is 404 for a link that is not known any more (used, or replaced by a retry), and needs a session', async () => {
    answer = () => fault('HZS08', "This claim link isn't valid");
    await expect(api().call.owner.claim(claim)).rejects.toMatchObject({
      status: 404,
      message: "This claim link isn't valid: ask your agent for its link",
    });
    signedIn.mockResolvedValue(null);
    await expect(api().call.owner.claim(claim)).rejects.toMatchObject({ status: 401 });
    // A name that is not one line is refused before any trip.
    signedIn.mockResolvedValue(OWNER);
    asked.length = 0;
    await expect(api().call.owner.claim({ ...claim, ownerName: '' })).rejects.toMatchObject({
      status: 400,
    });
    expect(asked).toHaveLength(0);
  });
});
