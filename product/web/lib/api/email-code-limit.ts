import { createHmac } from 'node:crypto';
import { redisKey } from '@hrizzup/core';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { waitUntil } from '@vercel/functions';
import type { Allowance } from './rate-limit.ts';

/**
 * Each visitor's requests for an email code through the typed API (`auth.emailCode`, PLAN.md step
 * 1.6b), counted by our own server too: at most 5 a minute per visitor, the same as the
 * firewall's rule for everything that sends email (infra/vercel/firewall.json). That rule matches
 * the address as sent, and an address written another way (`/api/v1/auth/./email/code`) reaches
 * the same call without matching it (tried on staging, 10 November 2026), so the call counts for
 * itself, however it was reached.
 *
 * - **Upstash's own library** (`@upstash/ratelimit`), a sliding window, one script per call.
 * - **Keys follow the rules** (blueprint section 14): the environment's prefix, then
 *   `rate:email-code`, then the visitor's address made into an ID, never the address itself: an
 *   HMAC keyed with the bot check's secret, which only our server holds, so the key can't be
 *   turned back into the address. Each expires on its own.
 * - **Never the only guard:** if Redis is slow (over a second) or fails, the request goes on, to
 *   the bot check and Supabase Auth's own limits (one email a minute to an address, and its hourly
 *   limit); where Redis isn't set up, there's no count here at all.
 */

export const EMAIL_CODES_PER_MINUTE = 5;

const REDIS_TIMEOUT_MS = 1000;

type Env = Readonly<Record<string, string | undefined>>;

let limiter: Ratelimit | null | undefined;

/** The limiter for this environment, made once; null where Redis isn't set up. */
export function emailCodeLimiter(env: Env = process.env): Ratelimit | null {
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
    limiter: Ratelimit.slidingWindow(EMAIL_CODES_PER_MINUTE, '60 s'),
    prefix: redisKey(prefix, 'rate', 'email-code'),
    timeout: REDIS_TIMEOUT_MS,
    analytics: false,
  });
  return limiter;
}

/** Forgets the limiter, so the next call makes it again from the environment (for tests). */
export function resetEmailCodeLimiter(): void {
  limiter = undefined;
}

/**
 * A visitor's address as an ID for the count: an HMAC with `secret`, so neither Redis nor anyone
 * reading it learns the address. Visitors with no address known (never on Vercel) share one count.
 */
export function visitorId(address: string | undefined, secret: string): string {
  return createHmac('sha256', secret)
    .update(`email-code-visitor\n${address ?? 'unknown'}`)
    .digest('base64url')
    .slice(0, 32);
}

/** Whether this visitor may ask for another code now; if not, how many seconds until they may. */
export async function allowEmailCode(
  visitor: string,
  limit: Pick<Ratelimit, 'limit'> | null = emailCodeLimiter(),
  now: () => number = Date.now,
): Promise<Allowance> {
  if (!limit) return { allowed: true };
  try {
    const answer = await limit.limit(visitor);
    waitUntil(answer.pending);
    if (answer.success) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((answer.reset - now()) / 1000)),
    };
  } catch {
    // Redis failed: the bot check and Supabase's own limits still stand.
    return { allowed: true };
  }
}
