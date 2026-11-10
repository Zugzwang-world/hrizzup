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
  revokeKey,
  shownPart,
} from './keys.ts';

const ADA = '00000000-0000-4000-8000-00000000a0a1';
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

/** A stand-in for Upstash's client: a map, with what each call was given. */
function fakeRedis() {
  const held = new Map<string, unknown>();
  const sets: { name: string; value: unknown; options: unknown }[] = [];
  return {
    held,
    sets,
    redis: {
      async get(name: string) {
        return held.get(name) ?? null;
      },
      async set(name: string, value: unknown, options: { nx?: boolean }) {
        sets.push({ name, value, options });
        if (options.nx && held.has(name)) return null;
        held.set(name, value);
        return 'OK';
      },
    },
  };
}

const dbError = (code: string, detail?: string) =>
  Object.assign(new Error(`database error ${code}`), { code, detail });

afterEach(() => resetKeyCache(undefined, undefined));

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
  const name = `stg:key:v1:${hashKey(text).toString('hex')}`;

  it("asks the database once, by the key's hash with nobody signed in, then keeps it a minute", async () => {
    const { pool, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, scope: 'read' }));
    const { redis, sets } = fakeRedis();
    resetKeyCache(redis as never, 'stg');
    const found = { id: KEY_ID, userId: ADA, scope: 'read' };
    await expect(findKey(pool, text)).resolves.toEqual(found);
    await expect(findKey(pool, text)).resolves.toEqual(found);
    const asked = queries.filter((q) => q.text.includes('keys.verify'));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.values).toEqual([hashKey(text)]);
    const settings = queries.find((q) => q.text.includes('set_config'))?.values;
    expect(settings?.[2]).toBe(''); // nobody signed in
    expect(settings?.[5]).toBe(''); // and no key
    expect(sets).toEqual([{ name, value: found, options: { ex: KEY_CACHE_SECONDS, nx: true } }]);
  });

  it('keeps "not a key" a minute too, and finds nothing', async () => {
    const { pool, queries } = fakePool(() => null);
    const { redis, held } = fakeRedis();
    resetKeyCache(redis as never, 'stg');
    await expect(findKey(pool, text)).resolves.toBeNull();
    await expect(findKey(pool, text)).resolves.toBeNull();
    expect(queries.filter((q) => q.text.includes('keys.verify'))).toHaveLength(1);
    expect(held.get(name)).toBe('none');
  });

  it('asks the database every time where Redis is not set up, or fails', async () => {
    const { pool, queries } = fakePool(() => ({ id: KEY_ID, user_id: ADA, scope: 'trade' }));
    resetKeyCache(null, undefined);
    await findKey(pool, text);
    resetKeyCache(
      {
        get: async () => {
          throw new Error('Redis is down');
        },
        set: async () => {
          throw new Error('Redis is down');
        },
      } as never,
      'stg',
    );
    await expect(findKey(pool, text)).resolves.toMatchObject({ scope: 'trade' });
    expect(queries.filter((q) => q.text.includes('keys.verify'))).toHaveLength(2);
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

  it('revoke a key, writing "revoked" over the copy Redis keeps, at once', async () => {
    const hash = hashKey(`hz_demo_${'b'.repeat(43)}`);
    const { pool } = fakePool(() => ({
      key: {
        id: KEY_ID,
        name: 'My bot',
        scope: 'read',
        shown: 'hz_demo_bbbb',
        created_at: '2026-11-11T09:30:00Z',
        last_used_at: '2026-11-11T09:31:00Z',
        revoked_at: '2026-11-11T09:45:00Z',
      },
      secret_hash: hash.toString('hex'),
    }));
    const { redis, held, sets } = fakeRedis();
    held.set(`stg:key:v1:${hash.toString('hex')}`, { id: KEY_ID, userId: ADA, scope: 'read' });
    resetKeyCache(redis as never, 'stg');
    const revoked = await revokeKey(pool, ADA, KEY_ID);
    expect(revoked).toMatchObject({ revokedAt: '2026-11-11T09:45:00Z', key: { id: KEY_ID } });
    expect(held.get(`stg:key:v1:${hash.toString('hex')}`)).toBe('none');
    expect(sets[0]?.options).toEqual({ ex: KEY_CACHE_SECONDS });
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
