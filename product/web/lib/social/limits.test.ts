import { createHmac } from 'node:crypto';
import type { Redis } from '@upstash/redis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allowAgentWrite,
  allowVisitor,
  enforce,
  LIMITS,
  limiterOf,
  limitHeaders,
  resetLimits,
  visitorLimitsApply,
  visitorOf,
} from './limits.ts';

/**
 * The agents' limits (docs/social/agents-design.md, L1 to L4): what each allows and counts by, where each
 * applies, that a visitor is never an address and no key in Redis holds one, that each fails open, and
 * what a refusal answers. Redis is stood in for: a counter that answers as the limiter's script would, or
 * a client that only shows the keys it is given.
 */

const KEY_ID = '019a7b10-0000-7000-8000-00000000000c';
const ADDRESS = '203.0.113.77';
const SECRET = 'test-secret-for-visitors';
const REDIS = {
  UPSTASH_REDIS_REST_URL: 'https://redis.limits.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-token',
  REDIS_KEY_PREFIX: 'stg',
};
const where = (target: string) => ({ ...REDIS, VERCEL: '1', VERCEL_TARGET_ENV: target });

afterEach(() => {
  vi.useRealTimers();
  resetLimits();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A limiter's stand-in: each call answers what `answers` gives, and records the identifiers asked. */
function counter(
  answer: { success?: boolean; remaining?: number; reset?: number } = {},
  failing = false,
) {
  const asked = { limit: [] as string[], remaining: [] as string[] };
  const reset = answer.reset ?? 1_700_000_030_000;
  return {
    asked,
    limit: {
      async limit(id: string) {
        asked.limit.push(id);
        if (failing) throw new Error('Redis is down');
        return {
          success: answer.success ?? true,
          limit: 60,
          remaining: answer.remaining ?? 59,
          reset,
          pending: Promise.resolve(),
        };
      },
      async getRemaining(id: string) {
        asked.remaining.push(id);
        if (failing) throw new Error('Redis is down');
        return { remaining: answer.remaining ?? 59, reset, limit: 60 };
      },
    } as never,
  };
}
const NOW = () => 1_700_000_000_000;

describe('the limits', () => {
  it('allow what the design says, counted by what it says, under their own Redis names', () => {
    expect(LIMITS).toEqual({
      'agent-write': {
        purpose: 'social-agent-write',
        policy: 'agent-writes',
        count: 60,
        seconds: 60,
      },
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
    });
  });
});

describe('where each limit applies', () => {
  it('L1 applies everywhere Redis is set up, and none applies without it', () => {
    for (const target of ['development', 'preview', 'staging', 'production']) {
      const env = target === 'development' ? REDIS : where(target);
      expect(limiterOf('agent-write', env), target).not.toBeNull();
      resetLimits();
    }
    for (const missing of [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'REDIS_KEY_PREFIX',
    ]) {
      for (const name of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
        expect(
          limiterOf(name, { ...where('staging'), [missing]: undefined }),
          `${name} ${missing}`,
        ).toBeNull();
        resetLimits();
      }
    }
  });

  it('L2 to L4 apply only on staging, and on production from launch', () => {
    for (const name of ['registration', 'refused-code', 'claim-preview'] as const) {
      expect(visitorLimitsApply(where('staging'))).toBe(true);
      expect(visitorLimitsApply(where('production'))).toBe(true);
      expect(visitorLimitsApply(where('preview'))).toBe(false);
      expect(visitorLimitsApply(REDIS)).toBe(false); // this Mac
      expect(limiterOf(name, where('staging')), `${name} staging`).not.toBeNull();
      resetLimits();
      expect(limiterOf(name, where('production')), `${name} production`).not.toBeNull();
      resetLimits();
      expect(limiterOf(name, where('preview')), `${name} preview`).toBeNull();
      expect(limiterOf(name, REDIS), `${name} dev`).toBeNull();
    }
  });

  it('a call on a preview, or this Mac, never reaches Redis for L2 to L4; on staging it does, and fails open', async () => {
    const reached = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', reached);
    for (const [key, value] of Object.entries(where('preview'))) vi.stubEnv(key, value);
    await expect(allowVisitor('registration', 'visitor', 'count')).resolves.toEqual({
      allowed: true,
    });
    await expect(allowVisitor('refused-code', 'visitor', 'peek')).resolves.toEqual({
      allowed: true,
    });
    await expect(allowVisitor('claim-preview', 'visitor', 'count')).resolves.toEqual({
      allowed: true,
    });
    expect(reached).not.toHaveBeenCalled();
    // The agent's writes count on a preview all the same.
    await expect(allowAgentWrite(KEY_ID)).resolves.toEqual({ allowed: true });
    expect(reached).toHaveBeenCalled();
    reached.mockClear();
    resetLimits();
    vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
    await expect(allowVisitor('registration', 'visitor', 'count')).resolves.toEqual({
      allowed: true,
    });
    expect(reached).toHaveBeenCalled();
  });
});

describe('a visitor', () => {
  const headers = (address?: string) => new Headers(address ? { 'x-real-ip': address } : {});
  const expected = (address: string, secret = SECRET) =>
    createHmac('sha256', secret)
      .update(`social-visitor\n${address}`)
      .digest('base64url')
      .slice(0, 32);

  it('is the first 32 characters of an HMAC of the address, keyed with SOCIAL_JOBS_SECRET', () => {
    const visitor = visitorOf(headers(ADDRESS), { SOCIAL_JOBS_SECRET: SECRET });
    expect(visitor).toBe(expected(ADDRESS));
    expect(visitor).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(visitor).not.toContain(ADDRESS);
  });

  it('is the same for one address, and another for another address or another secret', () => {
    const env = { SOCIAL_JOBS_SECRET: SECRET };
    expect(visitorOf(headers(ADDRESS), env)).toBe(visitorOf(headers(ADDRESS), env));
    expect(visitorOf(headers('203.0.113.78'), env)).not.toBe(visitorOf(headers(ADDRESS), env));
    expect(visitorOf(headers(ADDRESS), { SOCIAL_JOBS_SECRET: 'another-secret-entirely' })).not.toBe(
      visitorOf(headers(ADDRESS), env),
    );
  });

  it('is nobody with no secret, or no address: such visitors are never counted as one', () => {
    expect(visitorOf(headers(ADDRESS), {})).toBeNull();
    expect(visitorOf(headers(ADDRESS), { SOCIAL_JOBS_SECRET: '' })).toBeNull();
    expect(visitorOf(headers(), { SOCIAL_JOBS_SECRET: SECRET })).toBeNull();
    expect(visitorOf(headers(''), { SOCIAL_JOBS_SECRET: SECRET })).toBeNull();
  });

  it('is never limited when nobody: the limiter is not even asked', async () => {
    const { limit, asked } = counter({ success: false, remaining: 0 });
    for (const how of ['count', 'peek'] as const) {
      await expect(allowVisitor('registration', null, how, limit)).resolves.toEqual({
        allowed: true,
      });
    }
    expect(asked).toEqual({ limit: [], remaining: [] });
  });
});

describe('counting a call', () => {
  it('L1 counts an agent’s writes by its key’s ID, and says what is left and for how long', async () => {
    const { limit, asked } = counter({ remaining: 41 });
    await expect(allowAgentWrite(KEY_ID, limit, NOW)).resolves.toEqual({
      allowed: true,
      left: { remaining: 41, resetSeconds: 30 },
    });
    expect(asked.limit).toEqual([KEY_ID]);
  });

  it('L1 refuses past the allowance, with the seconds to wait (at least one)', async () => {
    const { limit } = counter({ success: false, remaining: 0 });
    await expect(allowAgentWrite(KEY_ID, limit, NOW)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    const soon = counter({ success: false, remaining: 0, reset: 1_700_000_000_200 });
    await expect(allowAgentWrite(KEY_ID, soon.limit, NOW)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it('L2 to L4 count by the visitor, one call each, or only ask how many are left', async () => {
    for (const name of ['registration', 'refused-code', 'claim-preview'] as const) {
      const counted = counter({ remaining: 3 });
      await expect(
        allowVisitor(name, 'someone', 'count', counted.limit, NOW),
      ).resolves.toMatchObject({
        allowed: true,
      });
      expect(counted.asked).toEqual({ limit: ['someone'], remaining: [] });
      const asking = counter({ remaining: 3 });
      await expect(allowVisitor(name, 'someone', 'peek', asking.limit, NOW)).resolves.toEqual({
        allowed: true,
        left: { remaining: 3, resetSeconds: 30 },
      });
      expect(asking.asked).toEqual({ limit: [], remaining: ['someone'] });
    }
  });

  it('asking is used up at none left, and counts nothing', async () => {
    const { limit, asked } = counter({ remaining: 0 });
    await expect(allowVisitor('refused-code', 'someone', 'peek', limit, NOW)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(asked.limit).toEqual([]);
  });

  it('fails open when Redis never answers: after a second, for a count and for an ask alike', async () => {
    vi.useFakeTimers();
    const hanging = {
      limit: () => new Promise(() => {}),
      getRemaining: () => new Promise(() => {}),
    } as never;
    for (const ask of [
      () => allowAgentWrite(KEY_ID, hanging, NOW),
      () => allowVisitor('registration', 'v', 'count', hanging, NOW),
      () => allowVisitor('registration', 'v', 'peek', hanging, NOW),
      () => allowVisitor('refused-code', 'v', 'peek', hanging, NOW),
    ]) {
      let answer: unknown;
      const pending = ask().then((allowance) => {
        answer = allowance;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(answer).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(answer).toEqual({ allowed: true });
    }
  });

  it('fails open when Redis fails, and is no limit at all with no limiter', async () => {
    const broken = counter({}, true);
    await expect(allowAgentWrite(KEY_ID, broken.limit, NOW)).resolves.toEqual({ allowed: true });
    await expect(allowVisitor('registration', 'v', 'count', broken.limit, NOW)).resolves.toEqual({
      allowed: true,
    });
    await expect(allowVisitor('registration', 'v', 'peek', broken.limit, NOW)).resolves.toEqual({
      allowed: true,
    });
    await expect(allowAgentWrite(KEY_ID, null, NOW)).resolves.toEqual({ allowed: true });
    await expect(allowVisitor('claim-preview', 'v', 'count', null, NOW)).resolves.toEqual({
      allowed: true,
    });
  });
});

describe('the keys in Redis', () => {
  /** A client that shows the keys it is given, then fails, so the limiter opens. */
  function showing() {
    const seen: string[] = [];
    const redis = {
      evalsha: async (_hash: string, keys: string[]) => {
        seen.push(...keys);
        throw new Error('stop');
      },
    } as unknown as Redis;
    return { redis, seen };
  }

  it('start with the environment, then each limit’s own name, then only the key’s ID or the visitor, then a window', async () => {
    const visitor = visitorOf(new Headers({ 'x-real-ip': ADDRESS }), {
      SOCIAL_JOBS_SECRET: SECRET,
    });
    const cases = [
      ['agent-write', KEY_ID, 'stg:rate:social-agent-write'],
      ['registration', visitor as string, 'stg:rate:social-registration'],
      ['refused-code', visitor as string, 'stg:rate:social-refused-code'],
      ['claim-preview', visitor as string, 'stg:rate:social-claim-preview'],
    ] as const;
    for (const [name, id, prefix] of cases) {
      const { redis, seen } = showing();
      const limiter = limiterOf(name, where('staging'), redis);
      expect(limiter).not.toBeNull();
      await allowVisitorOrWrite(name, id, limiter);
      expect(seen.length, name).toBe(4); // a count and an ask, each the window's two keys
      for (const key of seen) {
        expect(key, name).toMatch(new RegExp(`^${prefix}:${id.replace(/[-_]/g, '\\$&')}:\\d+$`));
        expect(key, name).not.toContain(ADDRESS);
      }
      resetLimits();
    }
  });

  async function allowVisitorOrWrite(
    name: keyof typeof LIMITS,
    id: string,
    limiter: ReturnType<typeof limiterOf>,
  ) {
    if (name === 'agent-write') {
      await allowAgentWrite(id, limiter);
      await (limiter as NonNullable<typeof limiter>).getRemaining(id).catch(() => undefined);
    } else {
      await allowVisitor(name, id, 'count', limiter);
      await allowVisitor(name, id, 'peek', limiter);
    }
  }
});

describe('a refusal', () => {
  it('sends the policy and what is left, as the other limits do', () => {
    expect(
      limitHeaders('agent-write', { allowed: true, left: { remaining: 59, resetSeconds: 42 } }),
    ).toEqual({
      'RateLimit-Policy': '"agent-writes";q=60;w=60',
      RateLimit: '"agent-writes";r=59;t=42',
    });
    expect(limitHeaders('registration', { allowed: false, retryAfterSeconds: 900 })).toEqual({
      'RateLimit-Policy': '"registrations";q=10;w=3600',
      RateLimit: '"registrations";r=0;t=900',
    });
    expect(limitHeaders('claim-preview', { allowed: true })).toEqual({});
    expect(
      limitHeaders('refused-code', { allowed: true, left: { remaining: 1, resetSeconds: 5 } }),
    ).toEqual({
      'RateLimit-Policy': '"refused-codes";q=20;w=3600',
      RateLimit: '"refused-codes";r=1;t=5',
    });
  });

  it('is a 429 with the seconds to wait in its data and in Retry-After, saying what to do next', () => {
    const response = new Headers();
    let thrown: unknown;
    try {
      enforce(
        'agent-write',
        { allowed: false, retryAfterSeconds: 12 },
        'Slow down: try again soon',
        response,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      message: 'Slow down: try again soon',
      data: { retryAfterSeconds: 12 },
    });
    expect(response.get('retry-after')).toBe('12');
    expect(response.get('ratelimit-policy')).toBe('"agent-writes";q=60;w=60');
    expect(response.get('ratelimit')).toBe('"agent-writes";r=0;t=12');
  });

  it('lets an allowed call through, setting only the headers', () => {
    const response = new Headers();
    expect(() =>
      enforce(
        'agent-write',
        { allowed: true, left: { remaining: 5, resetSeconds: 9 } },
        'x',
        response,
      ),
    ).not.toThrow();
    expect(response.get('retry-after')).toBeNull();
    expect(response.get('ratelimit')).toBe('"agent-writes";r=5;t=9');
    expect(() => enforce('agent-write', { allowed: true }, 'x')).not.toThrow();
  });
});
