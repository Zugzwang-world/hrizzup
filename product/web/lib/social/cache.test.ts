import type { Redis } from '@upstash/redis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forget, redisPrefix, remember, resetSocialCache } from './cache.ts';

/** A stand-in Redis with just the commands the cache uses. */
function fakeRedis(overrides: Partial<Record<'get' | 'set' | 'del', unknown>> = {}) {
  const store = new Map<string, unknown>();
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const key of keys) store.delete(key);
      return keys.length;
    }),
    ...overrides,
  };
  return { redis, store, cache: { redis: redis as unknown as Redis, prefix: 'tst' } };
}

afterEach(() => resetSocialCache());

describe('the one Redis client', () => {
  it('is null where Redis isn’t set up, and the prefix then is too', () => {
    resetSocialCache(null);
    expect(redisPrefix()).toBeNull();
  });

  it('keeps its environment’s prefix', () => {
    resetSocialCache(fakeRedis().cache);
    expect(redisPrefix()).toBe('tst');
  });
});

describe('remember', () => {
  it('keeps what the database said, with its expiry in the same command, and serves it next time', async () => {
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    const load = vi.fn(async () => ({ title: 'A story' }));
    await expect(remember('tst:cache:x:v1', 30, load)).resolves.toEqual({ title: 'A story' });
    expect(redis.set).toHaveBeenCalledWith('tst:cache:x:v1', { title: 'A story' }, { ex: 30 });
    await expect(remember('tst:cache:x:v1', 30, load)).resolves.toEqual({ title: 'A story' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks the database when Redis fails to answer or to write, and never fails because Redis does', async () => {
    const down = fakeRedis({
      get: vi.fn(async () => {
        throw new Error('down');
      }),
      set: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    resetSocialCache(down.cache);
    await expect(remember('tst:cache:x:v1', 30, async () => 7)).resolves.toBe(7);
  });

  it('asks the database where Redis isn’t set up', async () => {
    resetSocialCache(null);
    await expect(remember('tst:cache:k', 30, async () => 'db')).resolves.toBe('db');
  });

  it('keeps no copy of "nothing", which would hide a later change', async () => {
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    await expect(remember('tst:cache:k', 30, async () => null)).resolves.toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('the names and lifetimes a caller may use', () => {
  it('refuses a key outside the environment’s prefix, for a read and a delete, and touches nothing', async () => {
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    const load = vi.fn(async () => 1);
    for (const key of ['k', 'stg:cache:x', 'tst', 'tstx:cache:x', 'prd:key:v2:abc']) {
      await expect(remember(key, 30, load), key).rejects.toThrow(/prefix/);
      await expect(forget([key]), key).rejects.toThrow(/prefix/);
    }
    // One bad key among good ones deletes none of them.
    await expect(forget(['tst:cache:a', 'k'])).rejects.toThrow(/prefix/);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses a lifetime that is not a whole number of seconds, one or more, whether or not Redis is set up', async () => {
    const { redis, cache } = fakeRedis();
    for (const set of [cache, null]) {
      resetSocialCache(set);
      for (const seconds of [0, -5, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(
          remember('tst:cache:x', seconds, async () => 1),
          String(seconds),
        ).rejects.toThrow(/whole number of seconds/);
      }
    }
    expect(redis.set).not.toHaveBeenCalled();
    resetSocialCache(cache);
    await expect(remember('tst:cache:x', 1, async () => 1)).resolves.toBe(1);
  });
});

describe('forget', () => {
  it('deletes keys in one command and drops a failure', async () => {
    const { redis, store, cache } = fakeRedis();
    resetSocialCache(cache);
    store.set('tst:cache:a', 1);
    store.set('tst:cache:b', 2);
    await forget(['tst:cache:a', 'tst:cache:b']);
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
    await forget([]);
    expect(redis.del).toHaveBeenCalledTimes(1);

    resetSocialCache(
      fakeRedis({
        del: vi.fn(async () => {
          throw new Error('down');
        }),
      }).cache,
    );
    await expect(forget(['tst:cache:a'])).resolves.toBeUndefined();
    resetSocialCache(null);
    await expect(forget(['tst:cache:a'])).resolves.toBeUndefined();
  });
});
