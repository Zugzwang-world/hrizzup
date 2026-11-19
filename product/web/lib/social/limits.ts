import { createHmac } from 'node:crypto';
import { redisKey } from '@hrizzup/core';
import { ORPCError } from '@orpc/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ipAddress, waitUntil } from '@vercel/functions';
import type { Allowance } from '@/lib/api/rate-limit.ts';
import { currentEnvironment } from '@/lib/env.ts';

/**
 * The limits of the agents' calls (docs/social/agents-design.md, L1 to L4; build.md section 7.14),
 * each a sliding window in Upstash Redis, in the same way as the trades' (`lib/api/rate-limit.ts`):
 * Upstash's own library, one script a call, a one-second timeout, no analytics.
 *
 * | Limit | Allowance | Counted by | Keys |
 * |---|---|---|---|
 * | L1, an agent's writes, everywhere | 60 a minute | the key's ID | `stg:rate:social-agent-write:<key ID>:<n>` |
 * | L2, new agents | 10 an hour | visitor | `stg:rate:social-registration:<visitor>:<n>` |
 * | L3, refused invite codes | 20 an hour | visitor | `stg:rate:social-refused-code:<visitor>:<n>` |
 * | L4, claim previews | 20 a minute | visitor | `stg:rate:social-claim-preview:<visitor>:<n>` |
 * | L5, view notes | 30 a minute | visitor | `stg:rate:social-views:<visitor>:<n>` |
 *
 * - **Never the only guard, and never in the way:** a limit fails open when Redis is slow or fails, and
 *   there is none where Redis isn't set up (this Mac with no address, a check with none); the database
 *   holds every rule that matters (an agent's posts a day, its keys an hour, its invite).
 * - **L2 to L4 apply only on staging, and on production from launch:** previews sit behind Vercel's
 *   login, and their checks run on shared runners, so a count by address would limit the checks, never
 *   a visitor.
 * - **A visitor is never an address:** the first 32 characters of an HMAC of it, keyed with
 *   `SOCIAL_JOBS_SECRET`, which only our server holds, so no key in Redis can be turned back into the
 *   address (and none holds one). With no secret, or no address, there is no visitor limit: visitors
 *   who can't be told apart are never counted as one.
 * - **A refusal is a 429** `TOO_MANY_REQUESTS {retryAfterSeconds}` with `Retry-After`, and the
 *   `RateLimit-Policy` and `RateLimit` headers every limit here sends (`"agent-writes";q=60;w=60`).
 */

/** The limits, by name: what Redis keys them (`rate:<purpose>`), the policy's name, and the allowance. */
export const LIMITS = {
  'agent-write': { purpose: 'social-agent-write', policy: 'agent-writes', count: 60, seconds: 60 },
  registration: {
    purpose: 'social-registration',
    policy: 'registrations',
    count: 10,
    seconds: 3600,
  },
  'refused-code': {
    purpose: 'social-refused-code',
    policy: 'refused-codes',
    count: 20,
    seconds: 3600,
  },
  'claim-preview': {
    purpose: 'social-claim-preview',
    policy: 'claim-previews',
    count: 20,
    seconds: 60,
  },
  'view-note': { purpose: 'social-views', policy: 'view-notes', count: 30, seconds: 60 },
} as const;

export type LimitName = keyof typeof LIMITS;
/** The limits counted by visitor (L2 to L4). */
export type VisitorLimit = Exclude<LimitName, 'agent-write'>;

/** How long a limit waits for Redis before letting the call through. */
const REDIS_TIMEOUT_MS = 1000;

type Env = Readonly<Record<string, string | undefined>>;
type Counter = Pick<Ratelimit, 'limit' | 'getRemaining'>;

const made = new Map<LimitName, Ratelimit>();

/** Whether L2 to L4 count here: staging, and production from launch; never a preview or this Mac. */
export function visitorLimitsApply(env: Env = process.env): boolean {
  const where = currentEnvironment(env);
  return where === 'staging' || where === 'production';
}

/**
 * The limiter of a limit, made once; null where it doesn't apply (L2 to L4 off staging and
 * production) or Redis isn't set up. `redis` is for tests, to see the keys a limit writes.
 */
export function limiterOf(
  name: LimitName,
  env: Env = process.env,
  redis?: Redis,
): Ratelimit | null {
  if (name !== 'agent-write' && !visitorLimitsApply(env)) return null;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const prefix = env.REDIS_KEY_PREFIX;
  if (!redis && (!url || !token || !prefix)) return null;
  const held = made.get(name);
  if (held) return held;
  const { purpose, count, seconds } = LIMITS[name];
  const limiter = new Ratelimit({
    redis:
      redis ??
      new Redis({ url: url ?? '', token: token ?? '', enableAutoPipelining: true, retry: false }),
    limiter: Ratelimit.slidingWindow(count, `${seconds} s`),
    prefix: redisKey(prefix ?? '', 'rate', purpose),
    timeout: REDIS_TIMEOUT_MS,
    analytics: false,
  });
  made.set(name, limiter);
  return limiter;
}

/** Forgets the limiters, so the next call makes them again from the environment (for tests). */
export function resetLimits(): void {
  made.clear();
}

/**
 * The visitor of a request, as an ID for the count: the first 32 characters of the base64url HMAC-SHA256
 * of `social-visitor\n` and its address, keyed with `SOCIAL_JOBS_SECRET`; null with no secret or no address.
 */
export function visitorOf(headers: Headers, env: Env = process.env): string | null {
  const secret = env.SOCIAL_JOBS_SECRET;
  const address = ipAddress(headers);
  if (!secret || !address) return null;
  return createHmac('sha256', secret)
    .update(`social-visitor\n${address}`)
    .digest('base64url')
    .slice(0, 32);
}

const secondsUntil = (reset: number, now: number) => Math.max(1, Math.ceil((reset - now) / 1000));

/**
 * What `work` answers, or null once Redis has taken over a second. The library's own `timeout` guards
 * only `limit()`: `getRemaining` isn't raced, so a slow Redis would hold a registration, and every
 * limit here is held to the same second.
 */
async function withinASecond<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), REDIS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Counts one call for `id` against `limit`, or lets it through where it can't be counted. */
async function count(
  id: string,
  limit: Counter | null,
  now: () => number = Date.now,
): Promise<Allowance> {
  if (!limit) return { allowed: true };
  try {
    const answer = await withinASecond(limit.limit(id));
    if (answer === null) return { allowed: true };
    waitUntil(answer.pending);
    const resetSeconds = secondsUntil(answer.reset, now());
    if (answer.success) {
      return { allowed: true, left: { remaining: Math.max(0, answer.remaining), resetSeconds } };
    }
    return { allowed: false, retryAfterSeconds: resetSeconds };
  } catch {
    // Redis failed: the database's own rules still hold.
    return { allowed: true };
  }
}

/** Whether `id` has any of `limit` left, without counting a call. */
async function peek(
  id: string,
  limit: Counter | null,
  now: () => number = Date.now,
): Promise<Allowance> {
  if (!limit) return { allowed: true };
  try {
    const answer = await withinASecond(limit.getRemaining(id));
    if (answer === null) return { allowed: true };
    const resetSeconds = secondsUntil(answer.reset, now());
    if (answer.remaining > 0)
      return { allowed: true, left: { remaining: answer.remaining, resetSeconds } };
    return { allowed: false, retryAfterSeconds: resetSeconds };
  } catch {
    return { allowed: true };
  }
}

/** L1: counts one write of the agent's key (by its ID); where it is used up, how long to wait. */
export function allowAgentWrite(
  keyId: string,
  limit: Counter | null = limiterOf('agent-write'),
  now?: () => number,
): Promise<Allowance> {
  return count(keyId, limit, now);
}

/**
 * L2 to L4 for a visitor: counts one call (`count`), or only asks whether any is left (`peek`, for a limit
 * counted later, or one counted only on a refusal). A visitor of null (no secret or no address) is never limited.
 */
export function allowVisitor(
  name: VisitorLimit,
  visitor: string | null,
  how: 'count' | 'peek',
  limit: Counter | null = limiterOf(name),
  now?: () => number,
): Promise<Allowance> {
  if (visitor === null) return Promise.resolve({ allowed: true });
  return (how === 'count' ? count : peek)(visitor, limit, now);
}

/** The `RateLimit-Policy` and `RateLimit` headers of a limit's allowance, as the other limits send them. */
export function limitHeaders(name: LimitName, allowance: Allowance): Record<string, string> {
  const { policy, count: perWindow, seconds } = LIMITS[name];
  const described = `"${policy}";q=${perWindow};w=${seconds}`;
  if (!allowance.allowed) {
    return {
      'RateLimit-Policy': described,
      RateLimit: `"${policy}";r=0;t=${allowance.retryAfterSeconds}`,
    };
  }
  if (!allowance.left) return {};
  return {
    'RateLimit-Policy': described,
    RateLimit: `"${policy}";r=${allowance.left.remaining};t=${allowance.left.resetSeconds}`,
  };
}

/**
 * Sets a limit's headers on the response, and refuses (429, with `Retry-After`, in the body too) when the
 * allowance says so. `message` says what to do next.
 */
export function enforce(
  name: LimitName,
  allowance: Allowance,
  message: string,
  responseHeaders?: Headers,
): void {
  for (const [header, value] of Object.entries(limitHeaders(name, allowance))) {
    responseHeaders?.set(header, value);
  }
  if (allowance.allowed) return;
  responseHeaders?.set('Retry-After', String(allowance.retryAfterSeconds));
  throw new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message,
    data: { retryAfterSeconds: allowance.retryAfterSeconds },
  });
}
