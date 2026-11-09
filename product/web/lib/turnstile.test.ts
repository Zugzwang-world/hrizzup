import { describe, expect, it, vi } from 'vitest';
import { type BotCheck, passesBotCheck } from './turnstile.ts';

/** Cloudflare's answer, as its verify address gives it. */
function cloudflare(body: unknown, status = 200) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

const REAL = { success: true, hostname: 'staging.hrizzup.com', action: 'email-code' };
const TESTING = {
  success: true,
  hostname: 'example.com',
  metadata: { result_with_testing_key: true },
};

function check(fetcher: typeof fetch, overrides: Partial<BotCheck> = {}): BotCheck {
  return {
    secret: 'secret-for-this-test',
    answer: 'answer-from-the-widget',
    hostname: 'staging.hrizzup.com',
    action: 'email-code',
    environment: 'staging',
    fetcher,
    ...overrides,
  };
}

describe('the bot check, on our server', () => {
  it('passes a genuine answer, solved on our page for this action', async () => {
    const fetcher = cloudflare(REAL);
    expect(await passesBotCheck(check(fetcher, { ip: '203.0.113.7' }))).toBe(true);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const sent = new URLSearchParams(init?.body as URLSearchParams);
    expect(sent.get('secret')).toBe('secret-for-this-test');
    expect(sent.get('response')).toBe('answer-from-the-widget');
    expect(sent.get('remoteip')).toBe('203.0.113.7');
  });

  it('refuses an answer Cloudflare rejects, or solved on another site or for another action', async () => {
    expect(await passesBotCheck(check(cloudflare({ success: false })))).toBe(false);
    expect(await passesBotCheck(check(cloudflare({ ...REAL, hostname: 'evil.example' })))).toBe(
      false,
    );
    expect(await passesBotCheck(check(cloudflare({ ...REAL, action: 'login' })))).toBe(false);
    expect(await passesBotCheck(check(cloudflare({ ...REAL, success: 'true' })))).toBe(false);
  });

  it("accepts Cloudflare's testing keys only on previews and this Mac", async () => {
    for (const environment of ['preview', 'development'] as const) {
      expect(await passesBotCheck(check(cloudflare(TESTING), { environment })), environment).toBe(
        true,
      );
    }
    for (const environment of ['staging', 'production'] as const) {
      expect(await passesBotCheck(check(cloudflare(TESTING), { environment })), environment).toBe(
        false,
      );
    }
  });

  it('refuses a missing or oversized answer without asking Cloudflare', async () => {
    for (const answer of [null, '', 42, 'x'.repeat(2049)]) {
      const fetcher = cloudflare(REAL);
      expect(await passesBotCheck(check(fetcher, { answer })), String(answer)).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it('fails closed when Cloudflare errors or cannot be reached', async () => {
    expect(await passesBotCheck(check(cloudflare(REAL, 500)))).toBe(false);
    const broken = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await passesBotCheck(check(broken))).toBe(false);
    const garbled = vi.fn(async () => new Response('not json'));
    expect(await passesBotCheck(check(garbled))).toBe(false);
  });
});
