import { redisKey } from '@hrizzup/core';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { waitUntil } from '@vercel/functions';

/**
 * Each person's trades per minute (PLAN.md step 1.7d): the typed API's trading calls (a buy, a
 * sale, a limit order, a cancel) are limited per signed-in account, in Upstash Redis (blueprint
 * section 14), so no one can flood the books or a market's lock. Vercel's firewall limits each
 * address on top (`infra/vercel/firewall.json`).
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

/** How long the limiter waits for Redis before letting a trade through. */
const REDIS_TIMEOUT_MS = 1000;

export type Allowance = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Env = Readonly<Record<string, string | undefined>>;

let limiter: Ratelimit | null | undefined;

/** The limiter for this environment, made once; null where Redis isn't set up. */
export function tradeLimiter(env: Env = process.env): Ratelimit | null {
  if (limiter !== undefined) return limiter;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const prefix = env.REDIS_KEY_PREFIX;
  if (!url || !token || !prefix) {
    limiter = null;
    return limiter;
  }
  limiter = new Ratelimit({
    redis: new Redis({ url, token, enableAutoPipelining: true, retry: false }),
    limiter: Ratelimit.slidingWindow(TRADES_PER_MINUTE, '60 s'),
    prefix: redisKey(prefix, 'rate', 'trade'),
    timeout: REDIS_TIMEOUT_MS,
    analytics: false,
  });
  return limiter;
}

/** Forgets the limiter, so the next call makes it again from the environment (for tests). */
export function resetTradeLimiter(): void {
  limiter = undefined;
}

/**
 * Whether `account` may make another trading call now; if not, how many seconds until it may. Counts
 * the call when it's allowed.
 */
export async function allowTrade(
  account: string,
  limit: Pick<Ratelimit, 'limit'> | null = tradeLimiter(),
  now: () => number = Date.now,
): Promise<Allowance> {
  if (!limit) return { allowed: true };
  try {
    const answer = await limit.limit(account);
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
