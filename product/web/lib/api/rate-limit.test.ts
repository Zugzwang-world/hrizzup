import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowTrade, resetTradeLimiter, TRADES_PER_MINUTE, tradeLimiter } from './rate-limit.ts';

/**
 * Each person's trades a minute (rate-limit.ts), with Upstash stood in for: its own library's
 * counting is Upstash's, and the limit is proven against staging's Redis on a preview (the trading
 * journey).
 */

const ACCOUNT = '00000000-0000-4000-8000-0000000000e1';
const NOW = 1_800_000_000_000;

const answering = (answer: { success: boolean; reset: number }) => ({
  limit: vi
    .fn()
    .mockResolvedValue({ ...answer, limit: 30, remaining: 0, pending: Promise.resolve() }),
});

afterEach(() => {
  resetTradeLimiter();
});

describe('the trades-a-minute limit', () => {
  it('is 30 a minute', () => {
    expect(TRADES_PER_MINUTE).toBe(30);
  });

  it('lets a call through, counting it against the account', async () => {
    const limit = answering({ success: true, reset: NOW + 60_000 });
    await expect(allowTrade(ACCOUNT, limit, () => NOW)).resolves.toEqual({ allowed: true });
    expect(limit.limit).toHaveBeenCalledWith(ACCOUNT);
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
