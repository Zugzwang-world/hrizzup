import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionFor, TOKEN_ATTEMPTS, tokenRetryWait } from './test-accounts.ts';

/**
 * The Screen check's four parts, and other pull requests' checks, sign in the console's one shared
 * admin test account at about the same moment, each asking for a one-time token that cancels the
 * last (sessionFor, support/test-accounts.ts). Staging refuses a cancelled token (403), and
 * sessionFor asks again. Staging itself isn't involved here: its answers are made up.
 */

const answers = vi.hoisted(() => ({ verify: [] as Array<{ status: number } | null> }));
const calls = vi.hoisted(() => ({ generate: 0, verify: 0 }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        generateLink: async () => {
          calls.generate++;
          return { data: { properties: { hashed_token: 'a-made-up-token' } }, error: null };
        },
      },
    },
  }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (list: Array<{ name: string; value: string }>) => void } },
  ) => ({
    auth: {
      verifyOtp: async () => {
        calls.verify++;
        const error = answers.verify.shift() ?? null;
        if (error) return { data: { session: null }, error };
        options.cookies.setAll([{ name: 'a-made-up-cookie', value: 'a-made-up-value' }]);
        return { data: { session: { access_token: 'access', refresh_token: 'refresh' } }, error };
      },
    },
  }),
}));

const KEYS = { url: 'https://example.invalid', publishableKey: 'p', secretKey: 's' };

beforeEach(() => {
  vi.useFakeTimers();
  calls.generate = 0;
  calls.verify = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('signing in the shared admin test account while others do too', () => {
  it('asks again when its token was cancelled, and gets through', async () => {
    answers.verify = [{ status: 403 }, { status: 403 }, { status: 403 }, { status: 403 }];
    const session = sessionFor(KEYS, 'delivered+market-admin@resend.dev');
    await vi.runAllTimersAsync();
    expect((await session).cookies).toEqual([
      { name: 'a-made-up-cookie', value: 'a-made-up-value' },
    ]);
    expect(calls).toEqual({ generate: 5, verify: 5 });
  });

  it('keeps asking for as many times as a few pull requests at once can cancel it', async () => {
    // Seven cancellations in a row: more than the old five attempts could survive.
    answers.verify = Array.from({ length: TOKEN_ATTEMPTS - 1 }, () => ({ status: 403 }));
    const session = sessionFor(KEYS, 'delivered+market-admin@resend.dev');
    await vi.runAllTimersAsync();
    await expect(session).resolves.toMatchObject({ accessToken: 'access' });
    expect(calls.verify).toBe(TOKEN_ATTEMPTS);
    expect(TOKEN_ATTEMPTS).toBeGreaterThan(5);
  });

  it('gives up with staging’s own refusal once every attempt was cancelled', async () => {
    answers.verify = Array.from({ length: TOKEN_ATTEMPTS + 2 }, () => ({ status: 403 }));
    const session = sessionFor(KEYS, 'delivered+market-admin@resend.dev');
    const refused = expect(session).rejects.toThrow('Staging refused the one-time token (403)');
    await vi.runAllTimersAsync();
    await refused;
    expect(calls.verify).toBe(TOKEN_ATTEMPTS);
  });

  it('reports a refusal of any other account at once: nothing else can have cancelled its token', async () => {
    for (const email of [
      'delivered+run-gh1a1-0123abcd-screens-chromium@resend.dev',
      'delivered+someone@resend.dev',
    ]) {
      calls.generate = 0;
      calls.verify = 0;
      answers.verify = [{ status: 403 }, { status: 403 }];
      const session = sessionFor(KEYS, email);
      const refused = expect(session).rejects.toThrow('Staging refused the one-time token (403)');
      await vi.runAllTimersAsync();
      await refused;
      expect(calls).toEqual({ generate: 1, verify: 1 });
    }
  });

  it('never asks again after any other refusal', async () => {
    answers.verify = [{ status: 429 }];
    const session = sessionFor(KEYS, 'delivered+market-admin@resend.dev');
    const refused = expect(session).rejects.toThrow('Staging refused the one-time token (429)');
    await vi.runAllTimersAsync();
    await refused;
    expect(calls.verify).toBe(1);
  });

  it('waits between half a second and six and a half, at random, so callers that collided spread out', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(tokenRetryWait()).toBe(500);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(tokenRetryWait()).toBeGreaterThan(6499);
    expect(tokenRetryWait()).toBeLessThan(6500);
  });
});
