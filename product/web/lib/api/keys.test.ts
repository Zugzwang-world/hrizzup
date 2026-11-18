import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createKey,
  findKey,
  hashKey,
  KEY_CACHE_SECONDS,
  KEY_PREFIX,
  keysSetUp,
  makeKeyText,
  resetKeyCache,
  revokeAgentKeys,
  revokeKey,
  shownPart,
} from './keys.ts';

const ADA = '00000000-0000-4000-8000-00000000a0a1';
const AGENT = '00000000-0000-4000-8000-00000000b0b1';
const KEY_ID = '019a7b10-4c2d-7e3f-8a4b-5c6d7e8f9a0b';

/** A pool whose client answers each query with what `answer` gives, and records them. */
function fakePool(answer: (text: string, values?: unknown[]) => unknown) {
  const queries: { text: string; values?: unknown[] }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/^(begin|commit|rollback)/.test(text) || text.includes('set_config')) return { rows: [] };
      const value = answer(text, values);
      if (value instanceof Error) throw value;
      return { rows: [{ answer: value }] };
    },
    release() {},
  };
  // biome-ignore lint/suspicious/noExplicitAny: a stand-in for pg's PoolClient
  return { pool: { connect: async () => client as any }, queries };
}

type Mode = 'ok' | 'throw' | 'hang';
type Queued = { name: string; value: unknown; options: unknown };

/**
 * A stand-in for Upstash's client: a map, with what each call was given. `modes` makes a call fail
 * (`throw`) or never answer (`hang`): `mget` and `set` as a lookup uses them, `pipeline` (making one)
 * and `exec` (running it) as a revocation does. A pipeline's `set` chains, and its `exec` runs them in
 * order.
 */
function fakeRedis() {
  const held = new Map<string, unknown>();
  const sets: Queued[] = [];
  const mgets: string[][] = [];
  const gets: string[] = [];
  const pipelines: Queued[][] = [];
  const modes: Record<'mget' | 'set' | 'pipeline' | 'exec', Mode> = {
    mget: 'ok',
    set: 'ok',
    pipeline: 'ok',
    exec: 'ok',
  };
  const run = <T>(mode: Mode, work: () => T): Promise<T> => {
    if (mode === 'throw') return Promise.reject(new Error('Redis is down'));
    if (mode === 'hang') return new Promise<T>(() => {});
    return Promise.resolve(work());
  };
  return {
    held,
    sets,
    mgets,
    gets,
    pipelines,
    modes,
    redis: {
      async get(name: string) {
        gets.push(name);
        return held.get(name) ?? null;
      },
      mget(...names: string[]) {
        return run(modes.mget, () => {
          mgets.push(names);
          return names.map((name) => held.get(name) ?? null);
        });
      },
      set(name: string, value: unknown, options: { nx?: boolean }) {
        return run(modes.set, () => {
          sets.push({ name, value, options });
          if (options.nx && held.has(name)) return null;
          held.set(name, value);
          return 'OK';
        });
      },
      pipeline() {
        if (modes.pipeline === 'throw') throw new Error('Redis is down');
        const queued: Queued[] = [];
        const chain = {
          set(name: string, value: unknown, options: unknown) {
            queued.push({ name, value, options });
            return chain;
          },
          exec() {
            return run(modes.exec, () => {
              pipelines.push([...queued]);
              return queued.map(({ name, value }) => {
                held.set(name, value);
                return 'OK';
              });
            });
          },
        };
        return chain;
      },
    },
  };
}

const dbError = (code: string, detail?: string) =>
  Object.assign(new Error(`database error ${code}`), { code, detail });

afterEach(() => {
  resetKeyCache(undefined, undefined);
  vi.useRealTimers();
});

describe("a key's text", () => {
  it('is the prefix and 43 letters and digits, different every time', () => {
    const one = makeKeyText();
    const two = makeKeyText();
    expect(one).toMatch(/^hz_demo_[A-Za-z0-9]{43}$/);
    expect(one).not.toBe(two);
    expect(shownPart(one)).toBe(one.slice(0, 12));
    expect(shownPart(one)).toMatch(/^hz_demo_[A-Za-z0-9]{4}$/);
  });

  it('skips bytes from 248 up, so every character is equally likely', () => {
    // 248 to 255 are skipped; 0 is "A", 61 is "9", 62 wraps to "A" again, 247 is "9".
    let call = 0;
    const random = (size: number) => {
      call += 1;
      const bytes = new Uint8Array(size).fill(call === 1 ? 248 : 0);
      if (call === 2) bytes.set([255, 0, 61, 62, 247, 1]);
      return bytes;
    };
    const text = makeKeyText(random);
    expect(text.startsWith(`${KEY_PREFIX}A9A9B`)).toBe(true);
    expect(text).toHaveLength(KEY_PREFIX.length + 43);
  });

  it('is kept only as its SHA-256 hash', () => {
    const text = `hz_demo_${'a'.repeat(43)}`;
    expect(hashKey(text)).toEqual(createHash('sha256').update(text).digest());
    expect(hashKey(text)).toHaveLength(32);
  });
});

describe('who a key is', () => {
  const text = `hz_demo_${'a'.repeat(43)}`;
  const hex = hashKey(text).toString('hex');
  const v1 = `stg:key:v1:${hex}`;
  const v2 = `stg:key:v2:${hex}`;
  const asked = (queries: { text: string; values?: unknown[] }[]) =>
    queries.filter((q) => q.text.includes('keys.find'));

  it("asks the database once, by the key's hash with nobody signed in, then keeps it a minute", async () => {
    const { pool, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, kind: 'read' }));
    const { redis, sets } = fakeRedis();
    resetKeyCache(redis as never, 'stg');
    const found = { id: KEY_ID, kind: 'read', userId: ADA };
    await expect(findKey(pool, text)).resolves.toEqual(found);
    await expect(findKey(pool, text)).resolves.toEqual(found);
    expect(asked(queries)).toHaveLength(1);
    expect(asked(queries)[0]?.values).toEqual([hashKey(text)]);
    const settings = queries.find((q) => q.text.includes('set_config'))?.values;
    expect(settings?.[2]).toBe(''); // nobody signed in
    expect(settings?.[5]).toBe(''); // and no key
    expect(sets).toEqual([
      { name: v2, value: found, options: { ex: KEY_CACHE_SECONDS, nx: true } },
    ]);
  });

  it('keeps "not a key" a minute too, and finds nothing', async () => {
    const { pool, queries } = fakePool(() => null);
    const { redis, held } = fakeRedis();
    resetKeyCache(redis as never, 'stg');
    await expect(findKey(pool, text)).resolves.toBeNull();
    await expect(findKey(pool, text)).resolves.toBeNull();
    expect(asked(queries)).toHaveLength(1);
    expect(held.get(v2)).toBe('none');
  });

  it('asks the database every time where Redis is not set up, or fails', async () => {
    const { pool, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, kind: 'trade' }));
    resetKeyCache(null, undefined);
    await findKey(pool, text);
    resetKeyCache(
      {
        mget: async () => {
          throw new Error('Redis is down');
        },
        set: async () => {
          throw new Error('Redis is down');
        },
      } as never,
      'stg',
    );
    await expect(findKey(pool, text)).resolves.toMatchObject({ kind: 'trade' });
    expect(asked(queries)).toHaveLength(2);
  });

  describe('reads v2 and v1 in one MGET (K2)', () => {
    const readCopy = { id: KEY_ID, kind: 'read', userId: ADA };
    const tradeCopy = { id: KEY_ID, kind: 'trade', userId: ADA };
    const postCopy = { id: KEY_ID, kind: 'post', agentId: AGENT };
    // What a deployment from before posting keys kept in v1: a copy with a scope.
    const oldCopy = { id: KEY_ID, userId: ADA, scope: 'read' };
    const v1Holds = [
      ['nothing', undefined],
      ['an old copy', oldCopy],
      ['"none"', 'none'],
    ] as const;

    it.each(v1Holds)('a v2 "none" is a revoked key, with v1 holding %s', async (_name, old) => {
      const { pool, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, kind: 'read' }));
      const { redis, held, mgets, sets } = fakeRedis();
      held.set(v2, 'none');
      if (old !== undefined) held.set(v1, old);
      resetKeyCache(redis as never, 'stg');
      await expect(findKey(pool, text)).resolves.toBeNull();
      expect(asked(queries)).toHaveLength(0);
      expect(mgets).toEqual([[v1, v2]]);
      expect(sets).toEqual([]);
    });

    it.each(v1Holds)("a v2 posting key's copy answers whatever v1 says: %s", async (_name, old) => {
      const { pool, queries } = fakePool(() => null);
      const { redis, held, mgets, sets } = fakeRedis();
      held.set(v2, postCopy);
      if (old !== undefined) held.set(v1, old);
      resetKeyCache(redis as never, 'stg');
      await expect(findKey(pool, text)).resolves.toEqual(postCopy);
      expect(asked(queries)).toHaveLength(0);
      expect(mgets).toEqual([[v1, v2]]);
      expect(sets).toEqual([]);
    });

    it.each([
      ['read', readCopy],
      ['trade', tradeCopy],
    ])(
      'a v2 %s key copy answers unless v1 says "none" (a revocation from before posting keys)',
      async (_kind, copy) => {
        for (const [, old] of v1Holds) {
          const { pool, queries } = fakePool(() => copy);
          const { redis, held } = fakeRedis();
          held.set(v2, copy);
          if (old !== undefined) held.set(v1, old);
          resetKeyCache(redis as never, 'stg');
          const found = await findKey(pool, text);
          expect(found, `v1 ${JSON.stringify(old)}`).toEqual(old === 'none' ? null : copy);
          expect(asked(queries)).toHaveLength(0);
        }
      },
    );

    it.each(v1Holds)(
      'with no v2 copy the database decides, whatever v1 holds: %s',
      async (_name, old) => {
        // Deployments from before posting keys cached a posting key as a v1 miss: v1 alone never answers.
        const { pool, queries } = fakePool(() => ({ id: KEY_ID, kind: 'post', agent_id: AGENT }));
        const { redis, held, sets } = fakeRedis();
        if (old !== undefined) held.set(v1, old);
        resetKeyCache(redis as never, 'stg');
        await expect(findKey(pool, text)).resolves.toEqual(postCopy);
        expect(asked(queries)).toHaveLength(1);
        // Kept under v2, written NX, and v1 never written, over a "none" or a copy.
        expect(sets).toEqual([
          { name: v2, value: postCopy, options: { ex: KEY_CACHE_SECONDS, nx: true } },
        ]);
        expect(held.get(v1)).toEqual(old);
      },
    );

    it.each([
      ['a read copy with no account', { id: KEY_ID, kind: 'read' }],
      ['a read copy of an agent', { id: KEY_ID, kind: 'read', agentId: AGENT }],
      ['a posting copy with no agent', { id: KEY_ID, kind: 'post' }],
      ['a posting copy of an account', { id: KEY_ID, kind: 'post', userId: ADA }],
      ['an unknown kind', { id: KEY_ID, kind: 'admin', userId: ADA }],
      ['an ID that is not a UUID', { id: 'not-a-uuid', kind: 'read', userId: ADA }],
      ['an account that is not a UUID', { id: KEY_ID, kind: 'trade', userId: 'ada' }],
      ['an old v1 copy', { id: KEY_ID, userId: ADA, scope: 'read' }],
      ['some other text', 'revoked'],
      ['a number', 7],
      ['a list', [KEY_ID]],
    ])('a v2 that is %s is no copy: the database decides', async (_name, held2) => {
      const { pool, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, kind: 'trade' }));
      const { redis, held, sets } = fakeRedis();
      held.set(v2, held2);
      resetKeyCache(redis as never, 'stg');
      await expect(findKey(pool, text)).resolves.toEqual(tradeCopy);
      expect(asked(queries)).toHaveLength(1);
      // NX: what is held is never written over, so a copy that is no copy expires on its own.
      expect(sets).toEqual([
        { name: v2, value: tradeCopy, options: { ex: KEY_CACHE_SECONDS, nx: true } },
      ]);
      expect(held.get(v2)).toEqual(held2);
    });

    it('is one MGET, and no other Redis read, however the key is found', async () => {
      const { pool } = fakePool(() => ({ id: KEY_ID, kind: 'post', agent_id: AGENT }));
      const { redis, mgets, gets } = fakeRedis();
      resetKeyCache(redis as never, 'stg');
      await findKey(pool, text);
      await findKey(pool, text);
      expect(mgets).toEqual([
        [v1, v2],
        [v1, v2],
      ]);
      expect(gets).toEqual([]);
    });

    it('asks the database, with nobody signed in and no key, in the database function keys.find', async () => {
      const { pool, queries } = fakePool(() => null);
      resetKeyCache(null, undefined);
      await findKey(pool, text);
      expect(queries.some((q) => q.text.includes('keys.verify'))).toBe(false);
      expect(asked(queries)[0]?.text).toBe('select keys.find($1) as answer');
      const settings = queries.find((q) => q.text.includes('set_config'))?.values;
      expect(settings?.[2]).toBe('');
      expect(settings?.[5]).toBe('');
    });

    it('asks the database when Redis is slow (over 500 ms), fails, or answers something that is no list', async () => {
      vi.useFakeTimers();
      const { pool, queries } = fakePool(() => ({ id: KEY_ID, kind: 'post', agent_id: AGENT }));
      const slow = fakeRedis();
      slow.modes.mget = 'hang';
      slow.modes.set = 'hang';
      resetKeyCache(slow.redis as never, 'stg');
      const lookup = findKey(pool, text);
      await vi.advanceTimersByTimeAsync(499);
      expect(queries).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(600);
      await expect(lookup).resolves.toEqual(postCopy);
      expect(asked(queries)).toHaveLength(1);
      vi.useRealTimers();
      const odd = fakeRedis();
      odd.redis.mget = (async () => 'not a list') as never;
      resetKeyCache(odd.redis as never, 'stg');
      await expect(findKey(pool, text)).resolves.toEqual(postCopy);
      const broken = fakeRedis();
      broken.modes.mget = 'throw';
      broken.modes.set = 'throw';
      resetKeyCache(broken.redis as never, 'stg');
      await expect(findKey(pool, text)).resolves.toEqual(postCopy);
      expect(asked(queries)).toHaveLength(3);
    });

    it('falls to the database, never throws, when the prefix is no environment name', async () => {
      const { pool, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, kind: 'read' }));
      const { redis } = fakeRedis();
      resetKeyCache(redis as never, 'prod');
      await expect(findKey(pool, text)).resolves.toEqual(readCopy);
      expect(asked(queries)).toHaveLength(1);
    });

    it('never writes over a revocation that landed between the database and the copy', async () => {
      const { redis, held, sets } = fakeRedis();
      resetKeyCache(redis as never, 'stg');
      // The key is revoked after the database answered: the revocation's "none" is there first.
      const { pool } = fakePool(() => {
        held.set(v2, 'none');
        return { id: KEY_ID, user_id: ADA, kind: 'trade' };
      });
      await expect(findKey(pool, text)).resolves.toEqual(tradeCopy);
      expect(sets[0]?.options).toEqual({ ex: KEY_CACHE_SECONDS, nx: true });
      expect(held.get(v2)).toBe('none');
      await expect(findKey(pool, text)).resolves.toBeNull();
    });

    it("answers what the database says a key is, whole, or no key: an answer with no account or agent isn't one", async () => {
      const { redis } = fakeRedis();
      resetKeyCache(redis as never, 'stg');
      const bad = fakePool(() => ({ id: KEY_ID, kind: 'post' }));
      await expect(findKey(bad.pool, text)).resolves.toBeNull();
      resetKeyCache(null, undefined);
      const read = fakePool(() => ({ id: KEY_ID, kind: 'read', user_id: ADA, agent_id: AGENT }));
      await expect(findKey(read.pool, text)).resolves.toEqual(readCopy);
      const post = fakePool(() => ({ id: KEY_ID, kind: 'post', user_id: ADA, agent_id: AGENT }));
      await expect(findKey(post.pool, text)).resolves.toEqual(postCopy);
    });
  });
});

describe('revokeAgentKeys (K3)', () => {
  const one = hashKey(`hz_demo_${'b'.repeat(43)}`).toString('hex');
  const two = hashKey(`hz_demo_${'c'.repeat(43)}`).toString('hex');

  it('sets v1 and v2 to "none" for a minute, over a live copy, in one pipeline in order', async () => {
    const { redis, held, pipelines, sets, mgets } = fakeRedis();
    held.set(`stg:key:v1:${one}`, { id: KEY_ID, userId: ADA, scope: 'read' });
    held.set(`stg:key:v2:${one}`, { id: KEY_ID, kind: 'post', agentId: AGENT });
    resetKeyCache(redis as never, 'stg');
    await revokeAgentKeys([one, two]);
    expect(pipelines).toEqual([
      [
        { name: `stg:key:v1:${one}`, value: 'none', options: { ex: KEY_CACHE_SECONDS } },
        { name: `stg:key:v2:${one}`, value: 'none', options: { ex: KEY_CACHE_SECONDS } },
        { name: `stg:key:v1:${two}`, value: 'none', options: { ex: KEY_CACHE_SECONDS } },
        { name: `stg:key:v2:${two}`, value: 'none', options: { ex: KEY_CACHE_SECONDS } },
      ],
    ]);
    // No NX anywhere, and nothing outside the pipeline.
    expect(pipelines[0]?.every((entry) => !('nx' in (entry.options as object)))).toBe(true);
    expect(sets).toEqual([]);
    expect(mgets).toEqual([]);
    for (const name of [`stg:key:v1:${one}`, `stg:key:v2:${one}`]) {
      expect(held.get(name)).toBe('none');
    }
  });

  it('refuses, with a TypeError, anything but 64 lower-case hex characters, before anything else', async () => {
    const { redis, pipelines } = fakeRedis();
    resetKeyCache(redis as never, 'stg');
    for (const bad of [
      '',
      'abc',
      one.toUpperCase(),
      `${one}0`,
      one.slice(1),
      `${one.slice(0, 63)}g`,
      `stg:key:v1:${one}`,
      Buffer.from(one, 'hex') as never,
      undefined as never,
      7 as never,
    ]) {
      await expect(revokeAgentKeys([one, bad]), String(bad)).rejects.toBeInstanceOf(TypeError);
    }
    expect(pipelines).toEqual([]);
    // Whether or not Redis is there.
    resetKeyCache(null, undefined);
    await expect(revokeAgentKeys(['nope'])).rejects.toBeInstanceOf(TypeError);
  });

  it('does nothing for an empty list, or with no Redis', async () => {
    const { redis, pipelines } = fakeRedis();
    const pipeline = vi.spyOn(redis, 'pipeline');
    resetKeyCache(redis as never, 'stg');
    await expect(revokeAgentKeys([])).resolves.toBeUndefined();
    expect(pipeline).not.toHaveBeenCalled();
    resetKeyCache(null, undefined);
    await expect(revokeAgentKeys([one])).resolves.toBeUndefined();
    expect(pipelines).toEqual([]);
  });

  it('tries twice, and never throws: a pipeline that fails, never answers, or cannot be made', async () => {
    vi.useFakeTimers();
    const failing = fakeRedis();
    failing.modes.exec = 'throw';
    resetKeyCache(failing.redis as never, 'stg');
    const spy = vi.spyOn(failing.redis, 'pipeline');
    await expect(revokeAgentKeys([one])).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);

    const slow = fakeRedis();
    slow.modes.exec = 'hang';
    resetKeyCache(slow.redis as never, 'stg');
    const slowSpy = vi.spyOn(slow.redis, 'pipeline');
    const done = revokeAgentKeys([one]);
    await vi.advanceTimersByTimeAsync(499);
    expect(slowSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBeUndefined();
    expect(slowSpy).toHaveBeenCalledTimes(2);

    const unmade = fakeRedis();
    unmade.modes.pipeline = 'throw';
    resetKeyCache(unmade.redis as never, 'stg');
    await expect(revokeAgentKeys([one])).resolves.toBeUndefined();
    // And a prefix that is no environment name's.
    resetKeyCache(fakeRedis().redis as never, 'prod');
    await expect(revokeAgentKeys([one])).resolves.toBeUndefined();
  });

  it('stops at the first try that lands, and lands on the second after a failure', async () => {
    const flaky = fakeRedis();
    flaky.modes.exec = 'throw';
    resetKeyCache(flaky.redis as never, 'stg');
    const real = flaky.redis.pipeline.bind(flaky.redis);
    let made = 0;
    flaky.redis.pipeline = (() => {
      made += 1;
      if (made === 2) flaky.modes.exec = 'ok';
      return real();
    }) as never;
    await revokeAgentKeys([one]);
    expect(made).toBe(2);
    expect(flaky.pipelines).toHaveLength(1);
    expect(flaky.held.get(`stg:key:v2:${one}`)).toBe('none');
  });
});

describe("the keys' calls", () => {
  it('make a key: only its hash and first characters reach the database, its text comes back once', async () => {
    const { pool, queries } = fakePool((_text, values) => ({
      id: KEY_ID,
      name: values?.[0],
      scope: values?.[1],
      shown: values?.[3],
      created_at: '2026-11-11T09:30:00Z',
      last_used_at: null,
      revoked_at: null,
    }));
    const made = await createKey(pool, ADA, { name: 'My bot', scope: 'trade' });
    expect(made.secret).toMatch(/^hz_demo_[A-Za-z0-9]{43}$/);
    expect(made.key).toEqual({
      id: KEY_ID,
      name: 'My bot',
      scope: 'trade',
      shown: shownPart(made.secret),
      createdAt: '2026-11-11T09:30:00Z',
      lastUsedAt: null,
    });
    const sent = queries.find((q) => q.text.includes('keys.create'))?.values;
    expect(sent).toEqual(['My bot', 'trade', hashKey(made.secret), shownPart(made.secret)]);
    expect(JSON.stringify(queries)).not.toContain(made.secret);
    const settings = queries.find((q) => q.text.includes('set_config'))?.values;
    expect(settings?.[2]).toBe(ADA);
    expect(settings?.[5]).toBe('');
  });

  it("answer the database's refusals: five live keys, ten an hour with the seconds to wait, no such key", async () => {
    const five = fakePool(() => dbError('HZK01'));
    await expect(createKey(five.pool, ADA, { name: 'Bot', scope: 'read' })).rejects.toMatchObject({
      code: 'REFUSED',
      status: 422,
      data: { reason: 'too_many_keys' },
    });
    const ten = fakePool(() => dbError('HZK02', '1234'));
    await expect(createKey(ten.pool, ADA, { name: 'Bot', scope: 'read' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { retryAfterSeconds: 1234 },
    });
    const none = fakePool(() => dbError('P0002'));
    await expect(revokeKey(none.pool, ADA, KEY_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('revoke a key, writing "none" over the copies Redis keeps, at once, after the database', async () => {
    const hash = hashKey(`hz_demo_${'b'.repeat(43)}`);
    const hex = hash.toString('hex');
    const events: string[] = [];
    const { pool } = fakePool(() => {
      events.push('database');
      return {
        key: {
          id: KEY_ID,
          name: 'My bot',
          scope: 'read',
          shown: 'hz_demo_bbbb',
          created_at: '2026-11-11T09:30:00Z',
          last_used_at: '2026-11-11T09:31:00Z',
          revoked_at: '2026-11-11T09:45:00Z',
        },
        secret_hash: hex,
      };
    });
    const { redis, held, pipelines } = fakeRedis();
    const pipeline = redis.pipeline.bind(redis);
    redis.pipeline = () => {
      events.push('redis');
      return pipeline();
    };
    held.set(`stg:key:v1:${hex}`, { id: KEY_ID, userId: ADA, scope: 'read' });
    held.set(`stg:key:v2:${hex}`, { id: KEY_ID, kind: 'read', userId: ADA });
    resetKeyCache(redis as never, 'stg');
    const revoked = await revokeKey(pool, ADA, KEY_ID);
    expect(revoked).toMatchObject({ revokedAt: '2026-11-11T09:45:00Z', key: { id: KEY_ID } });
    expect(events).toEqual(['database', 'redis']);
    expect(held.get(`stg:key:v1:${hex}`)).toBe('none');
    expect(held.get(`stg:key:v2:${hex}`)).toBe('none');
    expect(pipelines[0]?.map((entry) => entry.options)).toEqual([
      { ex: KEY_CACHE_SECONDS },
      { ex: KEY_CACHE_SECONDS },
    ]);
    // Revoked is revoked: the next lookup is refused from Redis alone.
    const { pool: later, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, kind: 'read' }));
    await expect(findKey(later, `hz_demo_${'b'.repeat(43)}`)).resolves.toBeNull();
    expect(queries.filter((q) => q.text.includes('keys.find'))).toHaveLength(0);
  });

  it('are "not set up here" on production, before launch', () => {
    expect(() => keysSetUp({ VERCEL: '1', VERCEL_TARGET_ENV: 'production' })).toThrow(
      expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', status: 503 }),
    );
    expect(() => keysSetUp({ VERCEL: '1', VERCEL_TARGET_ENV: 'staging' })).not.toThrow();
    expect(() => keysSetUp({})).not.toThrow();
    vi.restoreAllMocks();
  });
});
