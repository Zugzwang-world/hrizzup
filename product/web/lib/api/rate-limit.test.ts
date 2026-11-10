import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allowTrade,
  rateLimitHeaders,
  resetTradeLimiter,
  TRADES_PER_MINUTE,
  tradeLimiter,
} from './rate-limit.ts';

/**
 * Each person's trades a minute (rate-limit.ts), with Upstash stood in for: its own library's
 * counting is Upstash's, and the limit is proven against staging's Redis on a preview (the trading
 * journey).
 */

const ACCOUNT = '00000000-0000-4000-8000-0000000000e1';
const NOW = 1_800_000_000_000;

const answering = (answer: { success: boolean; reset: number; remaining?: number }) => ({
  limit: vi
    .fn()
    .mockResolvedValue({ limit: 30, remaining: 0, pending: Promise.resolve(), ...answer }),
});

afterEach(() => {
  resetTradeLimiter();
});

describe('the trades-a-minute limit', () => {
  it('is 30 a minute', () => {
    expect(TRADES_PER_MINUTE).toBe(30);
  });

  it('lets a call through, counting it against the account', async () => {
    const limit = answering({ success: true, reset: NOW + 60_000, remaining: 29 });
    await expect(allowTrade(ACCOUNT, limit, () => NOW)).resolves.toEqual({
      allowed: true,
      left: { remaining: 29, resetSeconds: 60 },
    });
    expect(limit.limit).toHaveBeenCalledWith(ACCOUNT);
  });

  it("writes the IETF's RateLimit headers: the policy, what's left and when there's room", () => {
    expect(
      rateLimitHeaders('trades', 30, { allowed: true, left: { remaining: 29, resetSeconds: 60 } }),
    ).toEqual({ 'RateLimit-Policy': '"trades";q=30;w=60', RateLimit: '"trades";r=29;t=60' });
    expect(rateLimitHeaders('key-reads', 120, { allowed: false, retryAfterSeconds: 7 })).toEqual({
      'RateLimit-Policy': '"key-reads";q=120;w=60',
      RateLimit: '"key-reads";r=0;t=7',
    });
    // Where Redis didn't count the call (not set up, or failed), there's nothing to say.
    expect(rateLimitHeaders('trades', 30, { allowed: true })).toEqual({});
  });

  it('refuses one over the limit, with the whole seconds until the window lets it through', async () => {
    await expect(
      allowTrade(ACCOUNT, answering({ success: false, reset: NOW + 16_200 }), () => NOW),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 17 });
    await expect(
      allowTrade(ACCOUNT, answering({ success: false, reset: NOW - 5 }), () => NOW),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('lets the call through when Redis fails, or is not set up: the books still check every trade', async () => {
    const failing = { limit: vi.fn().mockRejectedValue(new Error('Redis is down')) };
    await expect(allowTrade(ACCOUNT, failing, () => NOW)).resolves.toEqual({ allowed: true });
    await expect(allowTrade(ACCOUNT, null, () => NOW)).resolves.toEqual({ allowed: true });
  });

  it("isn't made where Redis or the environment's key prefix is missing", () => {
    expect(tradeLimiter({})).toBeNull();
    resetTradeLimiter();
    expect(
      tradeLimiter({
        UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 't',
      }),
    ).toBeNull();
  });

  it("keeps its keys under the environment's prefix, then what they're for", () => {
    const limiter = tradeLimiter({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
      REDIS_KEY_PREFIX: 'stg',
    });
    expect((limiter as unknown as { prefix: string }).prefix).toBe('stg:rate:trade');
    resetTradeLimiter();
    const slot = tradeLimiter({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
      REDIS_KEY_PREFIX: 'dev:slot2',
    });
    expect((slot as unknown as { prefix: string }).prefix).toBe('dev:slot2:rate:trade');
    resetTradeLimiter();
    expect(() =>
      tradeLimiter({
        UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 't',
        REDIS_KEY_PREFIX: 'prod',
      }),
    ).toThrow(/prefix/);
  });
});
