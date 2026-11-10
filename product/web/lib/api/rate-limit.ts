import { redisKey } from '@hrizzup/core';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { waitUntil } from '@vercel/functions';

/**
 * Each person's trades per minute (PLAN.md step 1.7d): the typed API's trading calls (a buy, a
 * sale, a limit order, a cancel) are limited per signed-in account, in Upstash Redis (blueprint
 * section 14), so no one can flood the books or a market's lock. And each bot's API key's personal
 * reads per minute (step 3.5a): its balance, positions and orders. Vercel's firewall limits each
 * address on top (`infra/vercel/firewall.json`: 60 requests a minute to the typed API).
 *
 * - **A sliding window,** with Upstash's own library (`@upstash/ratelimit`): one script per call,
 *   which reads and counts in one trip (blueprint section 14, rule 3).
 * - **Keys follow the rules:** they start with the environment's prefix (`REDIS_KEY_PREFIX`), then
 *   what they're for, then the account's ID, never anything personal: `stg:rate:trade:<account>:<n>`;
 *   each expires on its own, two windows and a second after it was made.
 * - **Never the only guard:** if Redis is slow (over a second) or fails, the trade goes on, because
 *   the books check every trade themselves; where Redis isn't set up (a check with no keys), there's
 *   no limit at all.
 */

/** At most this many trading calls a minute, for each person. */
export const TRADES_PER_MINUTE = 30;

/** At most this many personal reads a minute, for each API key (the website and the app have none). */
export const KEY_READS_PER_MINUTE = 120;

/** How long the limiter waits for Redis before letting a trade through. */
const REDIS_TIMEOUT_MS = 1000;

export type Allowance = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Env = Readonly<Record<string, string | undefined>>;

let limiter: Ratelimit | null | undefined;
let readLimiter: Ratelimit | null | undefined;

/** A sliding-window limiter of `perMinute`, its keys under `rate:<purpose>`; null without Redis. */
function makeLimiter(env: Env, perMinute: number, purpose: string): Ratelimit | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const prefix = env.REDIS_KEY_PREFIX;
  if (!url || !token || !prefix) return null;
  return new Ratelimit({
    redis: new Redis({ url, token, enableAutoPipelining: true, retry: false }),
    limiter: Ratelimit.slidingWindow(perMinute, '60 s'),
    prefix: redisKey(prefix, 'rate', purpose),
    timeout: REDIS_TIMEOUT_MS,
    analytics: false,
  });
}

/** The trades limiter for this environment, made once; null where Redis isn't set up. */
export function tradeLimiter(env: Env = process.env): Ratelimit | null {
  if (limiter === undefined) limiter = makeLimiter(env, TRADES_PER_MINUTE, 'trade');
  return limiter;
}

/** The API keys' reads limiter, made once: `stg:rate:keyread:<key ID>:<n>`. */
export function keyReadLimiter(env: Env = process.env): Ratelimit | null {
  if (readLimiter === undefined) readLimiter = makeLimiter(env, KEY_READS_PER_MINUTE, 'keyread');
  return readLimiter;
}

/** Forgets the limiters, so the next call makes them again from the environment (for tests). */
export function resetTradeLimiter(): void {
  limiter = undefined;
  readLimiter = undefined;
}

/**
 * Whether `account` may make another trading call now; if not, how many seconds until it may. Counts
 * the call when it's allowed.
 */
export function allowTrade(
  account: string,
  limit: Pick<Ratelimit, 'limit'> | null = tradeLimiter(),
  now: () => number = Date.now,
): Promise<Allowance> {
  return allow(account, limit, now);
}

/** Whether the API key `keyId` may make another personal read now; counted when it's allowed. */
export function allowKeyRead(
  keyId: string,
  limit: Pick<Ratelimit, 'limit'> | null = keyReadLimiter(),
  now: () => number = Date.now,
): Promise<Allowance> {
  return allow(keyId, limit, now);
}

async function allow(
  id: string,
  limit: Pick<Ratelimit, 'limit'> | null,
  now: () => number,
): Promise<Allowance> {
  if (!limit) return { allowed: true };
  try {
    const answer = await limit.limit(id);
    waitUntil(answer.pending);
    if (answer.success) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((answer.reset - now()) / 1000)),
    };
  } catch {
    // Redis failed: the books still check every trade, so the trade goes on.
    return { allowed: true };
  }
}
