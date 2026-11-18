import { Redis } from '@upstash/redis';

/**
 * Social's use of Redis (docs/social/build.md, section 6 and the blueprint's "Redis (Upstash)"): one
 * client for every area, kept as the rules say, so no area builds its own.
 *
 * - **Every key starts with the environment** (`REDIS_KEY_PREFIX`: `stg`, `pre`, `dev:slot2`), and the
 *   names come from `socialRedis` in `@hrizzup/social`, which holds each name's lifetime. `remember`
 *   writes the value with its expiry in the same command; nothing here ever writes a key without one.
 * - **Never the only copy:** Redis may drop a key whenever it is full. So a read that Redis can't answer
 *   (down, slow, no address set) is answered by the database (`remember` loads), a write that fails is
 *   dropped, and no call fails because Redis does. A call that must count something to be right
 *   (R11's views) has its own failure rule.
 * - **Batched:** the client has auto-pipelining on, so commands issued together travel in one trip.
 */

/** The client and the environment's key prefix. */
export type SocialCache = { redis: Redis; prefix: string };

type Env = Readonly<Record<string, string | undefined>>;

/** How long a read waits for Redis before asking the database. */
const REDIS_TIMEOUT_MS = 500;

let held: SocialCache | null | undefined;

/** The client, made once from the environment; null where Redis isn't set up (this Mac with no address, a check with none). */
export function socialCache(env: Env = process.env): SocialCache | null {
  if (held !== undefined) return held;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const prefix = env.REDIS_KEY_PREFIX;
  held =
    url && token && prefix
      ? { redis: new Redis({ url, token, enableAutoPipelining: true, retry: false }), prefix }
      : null;
  return held;
}

/** Forgets the client, or sets another, so the next call reads the environment again (for tests). */
export function resetSocialCache(next?: SocialCache | null): void {
  held = next;
}

/** The environment's key prefix, or null where Redis isn't set up. */
export const redisPrefix = (): string | null => socialCache()?.prefix ?? null;

function withTimeout<T>(work: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), REDIS_TIMEOUT_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * A key is refused unless it starts with the environment's prefix (`${prefix}:`, from `socialRedis` in
 * `@hrizzup/social`), so no key is ever written or deleted outside this environment's own names, and a
 * lifetime unless it is a whole number of seconds, one or more, so no key lives without an expiry.
 * These are a caller's mistakes, never Redis failing: they throw, they are never swallowed.
 */
function ownKey(cache: SocialCache, key: string): void {
  if (!key.startsWith(`${cache.prefix}:`)) {
    throw new TypeError(`A Redis key starts with the environment's prefix, "${cache.prefix}:"`);
  }
}

function lifetime(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new TypeError('A Redis key lives a whole number of seconds, one or more');
  }
}

/**
 * A value from Redis by its key, or what `load` makes (and keeps there for `seconds`). The value goes
 * through JSON, so it must be plain data. When Redis can't answer or write, the database is asked and
 * nothing fails. `null` is a value `load` may answer, but it isn't kept: a copy of "nothing" would hide
 * a later change. The key must start with the environment's prefix and `seconds` must be 1 or more
 * (see above); where Redis isn't set up the lifetime is still checked.
 */
export async function remember<T>(
  key: string,
  seconds: number,
  load: () => Promise<T>,
): Promise<T> {
  lifetime(seconds);
  const cache = socialCache();
  if (cache) {
    ownKey(cache, key);
    try {
      const found = await withTimeout(cache.redis.get<T>(key));
      if (found !== undefined && found !== null) return found;
    } catch {
      // Redis failed: the database answers.
    }
  }
  const value = await load();
  if (cache && value !== null && value !== undefined) {
    try {
      await withTimeout(cache.redis.set(key, value, { ex: seconds }));
    } catch {
      // Redis failed: the next call asks the database again.
    }
  }
  return value;
}

/**
 * Deletes keys in one command (a write the keys' copies depend on: a save, a revocation). Every key must
 * start with the environment's prefix. A failure of Redis is dropped: every key has its own expiry.
 */
export async function forget(keys: readonly string[]): Promise<void> {
  const cache = socialCache();
  if (!cache || keys.length === 0) return;
  for (const key of keys) ownKey(cache, key);
  try {
    await withTimeout(cache.redis.del(...keys));
  } catch {
    // The copies expire on their own.
  }
}
