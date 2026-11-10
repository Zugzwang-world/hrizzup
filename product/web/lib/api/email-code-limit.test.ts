import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allowEmailCode,
  EMAIL_CODES_PER_MINUTE,
  emailCodeLimiter,
  resetEmailCodeLimiter,
  visitorId,
} from './email-code-limit.ts';

/**
 * Each visitor's requests for an email code (email-code-limit.ts), with Upstash stood in for: its
 * own library's counting is Upstash's.
 */

const NOW = 1_800_000_000_000;

const answering = (answer: { success: boolean; reset: number }) => ({
  limit: vi
    .fn()
    .mockResolvedValue({ ...answer, limit: 5, remaining: 0, pending: Promise.resolve() }),
});

afterEach(() => {
  resetEmailCodeLimiter();
});

describe('the email codes a visitor may ask for', () => {
  it('are 5 a minute, as the firewall allows every route that sends email', () => {
    expect(EMAIL_CODES_PER_MINUTE).toBe(5);
  });

  it('count each visitor by an ID made from their address, never the address itself', () => {
    const id = visitorId('203.0.113.7', 'server-secret');
    expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(id).not.toContain('203');
    expect(visitorId('203.0.113.7', 'server-secret')).toBe(id);
    expect(visitorId('203.0.113.8', 'server-secret')).not.toBe(id);
    expect(visitorId('203.0.113.7', 'another-secret')).not.toBe(id);
  });

  it('let a request through, counting it', async () => {
    const limit = answering({ success: true, reset: NOW + 60_000 });
    await expect(allowEmailCode('visitor', limit, () => NOW)).resolves.toEqual({ allowed: true });
    expect(limit.limit).toHaveBeenCalledWith('visitor');
  });

  it('refuse one over the limit, with the whole seconds until the window lets it through', async () => {
    await expect(
      allowEmailCode('visitor', answering({ success: false, reset: NOW + 12_100 }), () => NOW),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 13 });
  });

  it('let the request go on when Redis fails, or where it isn’t set up', async () => {
    const failing = { limit: vi.fn().mockRejectedValue(new Error('Redis is down')) };
    await expect(allowEmailCode('visitor', failing)).resolves.toEqual({ allowed: true });
    await expect(allowEmailCode('visitor', null)).resolves.toEqual({ allowed: true });
    expect(emailCodeLimiter({})).toBeNull();
  });

  it("keep their keys under the environment's prefix, for this purpose alone", () => {
    const limiter = emailCodeLimiter({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token-for-this-test',
      REDIS_KEY_PREFIX: 'stg',
    });
    expect((limiter as unknown as { prefix: string }).prefix).toBe('stg:rate:email-code');
  });
});
