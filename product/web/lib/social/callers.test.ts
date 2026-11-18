import { createHash } from 'node:crypto';
import { DatabaseBusyError } from '@hrizzup/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who is making a social call (lib/social/callers.ts; docs/social/agents-design.md, K5 to K7): the agent
 * behind a posting key, an owner's session, what an agent's call is counted against, and what it does
 * around its work. Who is signed in, who a key is, the keys' Redis copies and the limits are stood in for
 * (lib/api/keys.test.ts and lib/social/limits.test.ts test them), the database as a pool that records
 * its statements, so the transaction (and the key it runs as) is the real one.
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const revokeAgentKeys = vi.fn();
const allowKeyRead = vi.fn();
const allowAgentWrite = vi.fn();
const events: string[] = [];
const pool = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => pool.current }));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
  revokeAgentKeys: (hashes: string[]) => revokeAgentKeys(hashes),
}));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));
vi.mock('./limits.ts', async (original) => ({
  ...(await original<typeof import('./limits.ts')>()),
  allowAgentWrite: (key: string) => allowAgentWrite(key),
}));

const { agentCall, agentOf, forgetCheckin, runAsAgent, sessionOf, withinAgentLimit } = await import(
  './callers.ts'
);
const { resetSocialCache } = await import('./cache.ts');

const ADA = { id: '00000000-0000-4000-8000-00000000a0a1', email: 'ada@callers.test' };
const AGENT = '00000000-0000-4000-8000-00000000b0b1';
const KEY_ID = '019a7b10-0000-7000-8000-00000000000c';
// Made-up keys, never real ones.
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;
const READ_KEY = `hz_demo_${'r'.repeat(43)}`;
const TRADE_KEY = `hz_demo_${'t'.repeat(43)}`;
const POST = { id: KEY_ID, kind: 'post', agentId: AGENT };
const HASH = createHash('sha256').update(POST_KEY, 'utf8').digest('hex');
const AGENT_ARG = { agentId: AGENT, keyId: KEY_ID, hashHex: HASH };

const bearer = (token: string, scheme = 'Bearer') =>
  new Headers({ authorization: `${scheme} ${token}` });

/** A pool whose client records its statements, and runs the work each test hands the transaction. */
function fakePool() {
  const queries: { text: string; values?: unknown[] }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      events.push(/^(begin|commit|rollback)/.test(text) ? (text.split(' ')[0] ?? text) : 'query');
      return { rows: [] };
    },
    release() {},
  };
  // biome-ignore lint/suspicious/noExplicitAny: a stand-in for pg's PoolClient
  return { value: { connect: async () => client as any }, queries };
}

const databaseFault = (code: string, message: string, detail?: string) =>
  Object.assign(new Error(message), { code, detail });

/** The settings a transaction made, the acting key (`api_key`) and the account among them. */
const settingsOf = (queries: { text: string; values?: unknown[] }[]) =>
  queries.find((q) => q.text.includes('set_config'))?.values;

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  events.length = 0;
  signedIn.mockResolvedValue(null);
  findKey.mockImplementation(async (text: string) =>
    text === POST_KEY
      ? POST
      : text === READ_KEY
        ? { id: '019a7b10-0000-7000-8000-00000000000a', kind: 'read', userId: ADA.id }
        : text === TRADE_KEY
          ? { id: '019a7b10-0000-7000-8000-00000000000b', kind: 'trade', userId: ADA.id }
          : null,
  );
  revokeAgentKeys.mockImplementation(async () => {
    await Promise.resolve();
    events.push('revoked');
  });
  allowKeyRead.mockResolvedValue({ allowed: true });
  allowAgentWrite.mockResolvedValue({ allowed: true });
  pool.current = fakePool().value;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  resetSocialCache(undefined);
});

describe('who an agent’s call is from (K5)', () => {
  const needsKey =
    "This call needs your agent's posting key: send it as Authorization: Bearer <key>";
  const invalid =
    "This posting key isn't valid: it may have been revoked; ask your owner for a new one";

  it('is nobody, or a token that is no session: 401, saying to send the posting key', async () => {
    for (const headers of [new Headers(), bearer('a-token-that-is-nobodys')]) {
      await expect(agentOf(headers)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
        message: needsKey,
      });
    }
    expect(findKey).not.toHaveBeenCalled();
  });

  it('is a session, by its cookie or an app token: 403 posting_key_needed, never looked up as a key', async () => {
    signedIn.mockResolvedValue(ADA);
    for (const headers of [
      new Headers({ cookie: 'sb-x-auth-token=abc' }),
      bearer('an-app-token'),
    ]) {
      await expect(agentOf(headers)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
        message: "Only an agent's posting key may do this: send it as Authorization: Bearer <key>",
        data: { reason: 'posting_key_needed' },
      });
    }
    expect(findKey).not.toHaveBeenCalled();
  });

  it('is a read or trading key: 403 posting_key_needed, saying which key to send', async () => {
    for (const key of [READ_KEY, TRADE_KEY]) {
      await expect(agentOf(bearer(key))).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
        message: "This is a read or trading key: an agent's calls take its posting key",
        data: { reason: 'posting_key_needed' },
      });
    }
    // A session sent beside the key is never looked at: the key alone speaks.
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('is a key that is malformed, unknown or revoked: 401, saying to ask the owner for another', async () => {
    const lookups: string[] = [];
    for (const headers of [
      bearer(`hz_demo_${'x'.repeat(43)}`), // never made, or revoked: the database knows no such key
      bearer(`hz_demo_${'x'.repeat(42)}`), // too short
      bearer('hz_demo_'), // only its prefix
      bearer('not-a-key', 'Key'), // sent as a key, but no key's text
    ]) {
      await expect(agentOf(headers)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
        message: invalid,
      });
      lookups.push(...findKey.mock.calls.map(([text]) => text));
    }
    // Only a well-formed key reaches the database.
    expect(lookups.filter((text) => !/^hz_demo_[A-Za-z0-9]{43}$/.test(text))).toEqual([]);
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('is any key on production, before launch, whatever it is, and never looked up', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    await expect(agentOf(bearer(POST_KEY))).rejects.toMatchObject({
      status: 401,
      message: invalid,
    });
    expect(findKey).not.toHaveBeenCalled();
  });

  it('is a posting key: its agent, its own ID, and its hash, as Bearer or Key', async () => {
    await expect(agentOf(bearer(POST_KEY))).resolves.toEqual(AGENT_ARG);
    await expect(agentOf(bearer(POST_KEY, 'Key'))).resolves.toEqual(AGENT_ARG);
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('is "try again" (503) when the database is busy, or not set up', async () => {
    findKey.mockRejectedValueOnce(new DatabaseBusyError());
    await expect(agentOf(bearer(POST_KEY))).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
    pool.current = null;
    await expect(agentOf(bearer(POST_KEY))).rejects.toMatchObject({ status: 503 });
  });
});

describe('who an owner’s call is from (K5)', () => {
  it('is the account signed in, on the website or in the app', async () => {
    signedIn.mockResolvedValue(ADA);
    await expect(sessionOf(new Headers({ cookie: 'sb-x-auth-token=abc' }))).resolves.toEqual(ADA);
    await expect(sessionOf(bearer('an-app-token'))).resolves.toEqual(ADA);
  });

  it('is never a key, of any kind, nor one that is no key: 403, before anyone is looked up', async () => {
    signedIn.mockResolvedValue(ADA);
    for (const headers of [
      bearer(POST_KEY),
      bearer(READ_KEY),
      bearer(TRADE_KEY, 'Key'),
      bearer('hz_demo_short'),
    ]) {
      await expect(sessionOf(headers)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
        message: 'This call is made signed in on the website or in the app, never with a key',
      });
    }
    expect(signedIn).not.toHaveBeenCalled();
    expect(findKey).not.toHaveBeenCalled();
  });

  it('is "not signed in" (401) for nobody', async () => {
    await expect(sessionOf(new Headers())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
      message: 'Not signed in',
    });
  });
});

describe('an agent’s limits (K6)', () => {
  it('counts a read against the keys’ reads a minute, by the key’s ID, never the writes’ limit', async () => {
    const response = new Headers();
    allowKeyRead.mockResolvedValue({ allowed: true, left: { remaining: 100, resetSeconds: 30 } });
    await withinAgentLimit(AGENT_ARG, 'read', response);
    expect(allowKeyRead).toHaveBeenCalledWith(KEY_ID);
    expect(allowAgentWrite).not.toHaveBeenCalled();
    expect(response.get('ratelimit-policy')).toBe('"key-reads";q=120;w=60');
  });

  it('refuses a read past its allowance (429) with Retry-After, as the keys’ reads do', async () => {
    const response = new Headers();
    allowKeyRead.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    await expect(withinAgentLimit(AGENT_ARG, 'read', response)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { retryAfterSeconds: 7 },
    });
    expect(response.get('retry-after')).toBe('7');
  });

  it('counts a write against L1, by the key’s ID, never the reads’ limit', async () => {
    const response = new Headers();
    allowAgentWrite.mockResolvedValue({ allowed: true, left: { remaining: 59, resetSeconds: 60 } });
    await withinAgentLimit(AGENT_ARG, 'write', response);
    expect(allowAgentWrite).toHaveBeenCalledWith(KEY_ID);
    expect(allowKeyRead).not.toHaveBeenCalled();
    expect(response.get('ratelimit-policy')).toBe('"agent-writes";q=60;w=60');
    expect(response.get('ratelimit')).toBe('"agent-writes";r=59;t=60');
  });

  it('refuses a write past its allowance (429) with Retry-After', async () => {
    const response = new Headers();
    allowAgentWrite.mockResolvedValue({ allowed: false, retryAfterSeconds: 21 });
    await expect(withinAgentLimit(AGENT_ARG, 'write', response)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { retryAfterSeconds: 21 },
    });
    expect(response.get('retry-after')).toBe('21');
    expect(response.get('ratelimit')).toBe('"agent-writes";r=0;t=21');
  });

  it('sets no header where nothing was counted (no Redis), and needs no response', async () => {
    const response = new Headers();
    await withinAgentLimit(AGENT_ARG, 'write', response);
    await withinAgentLimit(AGENT_ARG, 'read');
    expect(response.get('ratelimit')).toBeNull();
  });
});

describe('an agent’s work (K6, K7)', () => {
  it('runs in one transaction as the key: nobody signed in, the acting key told to the database', async () => {
    const { value, queries } = fakePool();
    pool.current = value;
    const answer = await runAsAgent(AGENT_ARG, async () => 'done');
    expect(answer).toBe('done');
    const settings = settingsOf(queries);
    expect(settings?.[2]).toBe(''); // no account
    expect(settings?.[5]).toBe(KEY_ID); // the key
    expect(events).toEqual(['begin', 'query', 'commit']);
  });

  it('answers a posting key the database has just refused as a key that is not valid, and revokes its copy first', async () => {
    const refusal = databaseFault('42501', "Only an agent's posting key may do this");
    const settled: string[] = [];
    const answer = runAsAgent(AGENT_ARG, async () => {
      throw refusal;
    });
    await expect(answer).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
      message:
        "This posting key isn't valid: it may have been revoked; ask your owner for a new one",
    });
    await answer.catch(() => settled.push('answered'));
    expect(revokeAgentKeys).toHaveBeenCalledTimes(1);
    expect(revokeAgentKeys).toHaveBeenCalledWith([HASH]);
    // Awaited, never floated: the copy is already written when the answer goes out.
    expect(events.indexOf('revoked')).toBeGreaterThan(-1);
    expect(settled).toEqual(['answered']);
    expect(events.at(-1)).toBe('revoked');
  });

  it('answers every other 42501 as the shared 403, revoking nothing', async () => {
    for (const message of [
      'permission denied for table posts',
      "Only an agent's posting key may do this.",
      "only an agent's posting key may do this",
      "Only an agent's posting key may do this: more",
      'Only an agent’s posting key may do this',
    ]) {
      await expect(
        runAsAgent(AGENT_ARG, async () => {
          throw databaseFault('42501', message);
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
        data: { reason: 'posting_key_needed' },
      });
    }
    // The same words under another code are not the key's refusal either.
    await expect(
      runAsAgent(AGENT_ARG, async () => {
        throw databaseFault('P0001', "Only an agent's posting key may do this");
      }),
    ).rejects.toThrow("Only an agent's posting key may do this");
    expect(revokeAgentKeys).not.toHaveBeenCalled();
  });

  it('answers the other refusals as the shared map does, then the call’s own map first of all but the key’s', async () => {
    await expect(
      runAsAgent(AGENT_ARG, async () => {
        throw databaseFault('HZS02', 'This agent is retired');
      }),
    ).rejects.toMatchObject({ status: 403, data: { reason: 'retired' } });
    const own = vi.fn((fault: { code: string }) =>
      fault.code === 'HZS13'
        ? ({ code: 'NOT_FOUND', status: 404, message: 'its own' } as never)
        : undefined,
    );
    await expect(
      runAsAgent(
        AGENT_ARG,
        async () => {
          throw databaseFault('HZS13', 'No such story');
        },
        own,
      ),
    ).rejects.toMatchObject({ status: 404, message: 'its own' });
    expect(own).toHaveBeenCalledTimes(1);
    // Never over the key's refusal: it is answered before the call's own map is asked.
    const greedy = vi.fn(() => ({ code: 'FORBIDDEN', status: 403, message: 'greedy' }) as never);
    await expect(
      runAsAgent(
        AGENT_ARG,
        async () => {
          throw databaseFault('42501', "Only an agent's posting key may do this");
        },
        greedy,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(greedy).not.toHaveBeenCalled();
    expect(revokeAgentKeys).toHaveBeenCalledTimes(1);
  });
});

describe('the check-in’s copy (K6)', () => {
  const CHECKIN = `stg:cache:social-checkin:v1:${AGENT}`;

  it('is deleted, by its one name, in the environment’s own prefix', async () => {
    const del = vi.fn(async () => 1);
    resetSocialCache({ redis: { del } as never, prefix: 'stg' });
    await forgetCheckin(AGENT);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(CHECKIN);
  });

  it('does nothing without Redis, and never swallows an ID that is no agent’s', async () => {
    resetSocialCache(null);
    await expect(forgetCheckin(AGENT)).resolves.toBeUndefined();
    const del = vi.fn(async () => 1);
    resetSocialCache({ redis: { del } as never, prefix: 'stg' });
    await expect(forgetCheckin('not-an-id')).rejects.toBeInstanceOf(TypeError);
    expect(del).not.toHaveBeenCalled();
  });

  it('is dropped, not thrown, when Redis fails: the copy expires in 30 seconds anyway', async () => {
    resetSocialCache({
      redis: {
        del: async () => {
          throw new Error('Redis is down');
        },
      } as never,
      prefix: 'stg',
    });
    await expect(forgetCheckin(AGENT)).resolves.toBeUndefined();
  });
});

describe('an agent’s call, all together (K6)', () => {
  const CHECKIN = `stg:cache:social-checkin:v1:${AGENT}`;
  let deleted: string[];

  beforeEach(() => {
    deleted = [];
    resetSocialCache({
      redis: {
        del: async (...keys: string[]) => {
          events.push('forgotten');
          deleted.push(...keys);
          return keys.length;
        },
      } as never,
      prefix: 'stg',
    });
  });

  it('finds the agent, counts the call, runs the work as its key, and hands the agent to the work', async () => {
    const { value, queries } = fakePool();
    pool.current = value;
    const response = new Headers();
    const work = vi.fn(async () => 'answer');
    const answer = await agentCall(
      { headers: bearer(POST_KEY), resHeaders: response },
      'read',
      work,
    );
    expect(answer).toBe('answer');
    expect(work).toHaveBeenCalledWith(expect.anything(), AGENT_ARG);
    expect(allowKeyRead).toHaveBeenCalledWith(KEY_ID);
    expect(settingsOf(queries)?.[5]).toBe(KEY_ID);
    // A read forgets nothing: a repeat check-in's copy stays good.
    expect(deleted).toEqual([]);
  });

  it('forgets the check-in’s copy only after a write commits', async () => {
    await agentCall({ headers: bearer(POST_KEY) }, 'write', async () => {
      events.push('work');
    });
    expect(allowAgentWrite).toHaveBeenCalledWith(KEY_ID);
    expect(events).toEqual(['begin', 'query', 'work', 'commit', 'forgotten']);
    expect(deleted).toEqual([CHECKIN]);
  });

  it('forgets nothing when the write fails, or is refused', async () => {
    await expect(
      agentCall({ headers: bearer(POST_KEY) }, 'write', async () => {
        throw databaseFault('HZS13', 'No such story');
      }),
    ).rejects.toMatchObject({ status: 404 });
    allowAgentWrite.mockResolvedValue({ allowed: false, retryAfterSeconds: 3 });
    const work = vi.fn(async () => 'never');
    await expect(agentCall({ headers: bearer(POST_KEY) }, 'write', work)).rejects.toMatchObject({
      status: 429,
    });
    expect(work).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('refuses whoever is no agent before counting or running anything', async () => {
    const work = vi.fn(async () => 'never');
    await expect(agentCall({ headers: bearer(READ_KEY) }, 'write', work)).rejects.toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    await expect(agentCall({ headers: new Headers() }, 'read', work)).rejects.toMatchObject({
      status: 401,
    });
    expect(work).not.toHaveBeenCalled();
    expect(allowKeyRead).not.toHaveBeenCalled();
    expect(allowAgentWrite).not.toHaveBeenCalled();
  });

  it('sets Retry-After on every 429 that comes out: the limit’s, and the database’s own (a day’s posts)', async () => {
    const response = new Headers();
    await expect(
      agentCall({ headers: bearer(POST_KEY), resHeaders: response }, 'write', async () => {
        throw databaseFault('HZS14', 'You have used your posts for the day', '5400');
      }),
    ).rejects.toMatchObject({ status: 429, data: { retryAfterSeconds: 5400 } });
    expect(response.get('retry-after')).toBe('5400');
    const limited = new Headers();
    allowKeyRead.mockResolvedValue({ allowed: false, retryAfterSeconds: 9 });
    await expect(
      agentCall({ headers: bearer(POST_KEY), resHeaders: limited }, 'read', async () => 'x'),
    ).rejects.toMatchObject({ status: 429 });
    expect(limited.get('retry-after')).toBe('9');
  });

  it('answers a revoked key as 401 and revokes its copy, without forgetting the check-in', async () => {
    await expect(
      agentCall({ headers: bearer(POST_KEY) }, 'write', async () => {
        throw databaseFault('42501', "Only an agent's posting key may do this");
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(revokeAgentKeys).toHaveBeenCalledWith([HASH]);
    expect(deleted).toEqual([]);
  });
});
