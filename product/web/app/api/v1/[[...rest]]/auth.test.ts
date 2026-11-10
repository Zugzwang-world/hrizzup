import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The app's sign-in calls in the typed API (PLAN.md step 1.6b; lib/api/auth.ts), through the API's
 * route as the app calls them over HTTP: Supabase Auth's public settings, and asking for an email
 * code behind the bot check. Cloudflare's check and Supabase's email are stood in for; the
 * Screen check runs both for real on every preview (e2e/journeys/app-sign-in.spec.ts).
 */

const mocks = vi.hoisted(() => ({ sendSignInCode: vi.fn(), passesBotCheck: vi.fn() }));

vi.mock('@/lib/supabase/send-code.ts', () => ({ sendSignInCode: mocks.sendSignInCode }));
vi.mock('@/lib/turnstile.ts', async (original) => ({
  ...(await original<typeof import('@/lib/turnstile.ts')>()),
  passesBotCheck: mocks.passesBotCheck,
}));
vi.mock('@/lib/db.ts', () => ({ database: () => null }));

const route = await import('./route.ts');

const SITE = 'https://staging.hrizzup.com';

async function call(method: 'GET' | 'POST', path: string, init: RequestInit = {}) {
  const handler = route[method];
  const response = await handler(new Request(`${SITE}${path}`, { method, ...init }));
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** The app's request for a code: JSON, with no Origin or Sec-Fetch-Site (it isn't a browser). */
const askForCode = (body: unknown, headers: Record<string, string> = {}) =>
  call('POST', '/api/v1/auth/email/code', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7', ...headers },
  });

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_for-this-test');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'secret-key-for-this-test');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret-for-this-test');
  mocks.sendSignInCode.mockResolvedValue('sent');
  mocks.passesBotCheck.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Supabase Auth's public settings (GET /api/v1/auth/settings)", () => {
  it('gives the address and publishable key, kept at the edge briefly, and nothing secret', async () => {
    const answer = await call('GET', '/api/v1/auth/settings');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_for-this-test',
    });
    expect(answer.headers['vercel-cdn-cache-control']).toBe(
      'max-age=300, stale-while-revalidate=300',
    );
    expect(answer.headers['vercel-cache-tag']).toBe('auth-settings');
    expect(JSON.stringify(answer.body)).not.toMatch(/secret/);
  });

  it('answers "not set up" on production until launch, and wherever the keys are missing, never kept', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const production = await call('GET', '/api/v1/auth/settings');
    expect(production.status).toBe(503);
    expect(production.body).toMatchObject({ code: 'NOT_SET_UP' });
    expect(production.headers['cache-control']).toBe('private, no-store');
    expect(production.headers['vercel-cdn-cache-control']).toBeUndefined();

    vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    expect((await call('GET', '/api/v1/auth/settings')).status).toBe(503);
  });
});

describe('asking for an email code (POST /api/v1/auth/email/code)', () => {
  it('checks the bot check for this host and the email-code action, then emails a code', async () => {
    const answer = await askForCode({ email: ' Reader@Example.com ', botCheck: 'answer' });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ email: 'reader@example.com', codeLength: 8, minutes: 10 });
    expect(answer.headers['cache-control']).toBe('private, no-store');
    expect(mocks.passesBotCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: 'turnstile-secret-for-this-test',
        answer: 'answer',
        hostname: 'staging.hrizzup.com',
        action: 'email-code',
        environment: 'staging',
        ip: '203.0.113.7',
      }),
    );
    expect(mocks.sendSignInCode).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'secret-key-for-this-test',
      'reader@example.com',
    );
  });

  it('sends nothing when the bot check refuses the answer', async () => {
    mocks.passesBotCheck.mockResolvedValue(false);
    const answer = await askForCode({ email: 'reader@example.com', botCheck: 'forged' });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ code: 'BOT_CHECK_FAILED' });
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });

  it("refuses an address that can't be one before asking Cloudflare, so the answer isn't spent", async () => {
    const answer = await askForCode({ email: 'not an address', botCheck: 'answer' });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ code: 'INVALID_EMAIL' });
    expect(mocks.passesBotCheck).not.toHaveBeenCalled();
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });

  it('refuses a request without an answer, or with anything else, before anything runs', async () => {
    for (const body of [
      { email: 'reader@example.com' },
      { email: 'reader@example.com', botCheck: '' },
      { email: 'reader@example.com', botCheck: 'answer', next: '/elsewhere' },
      { email: 'x'.repeat(255), botCheck: 'answer' },
    ]) {
      expect((await askForCode(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(mocks.passesBotCheck).not.toHaveBeenCalled();
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });

  it("passes on Supabase's limits and failures, so the app can say what happened", async () => {
    mocks.sendSignInCode.mockResolvedValue('too-many');
    const tooMany = await askForCode({ email: 'reader@example.com', botCheck: 'answer' });
    expect(tooMany.status).toBe(429);
    expect(tooMany.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    mocks.sendSignInCode.mockResolvedValue('failed');
    const failed = await askForCode({ email: 'reader@example.com', botCheck: 'answer' });
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ code: 'SEND_FAILED' });
  });

  it('answers "not set up" on production until launch, sending nothing', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const answer = await askForCode({ email: 'reader@example.com', botCheck: 'answer' });
    expect(answer.status).toBe(503);
    expect(answer.body).toMatchObject({ code: 'NOT_SET_UP' });
    expect(mocks.passesBotCheck).not.toHaveBeenCalled();
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });

  it("refuses a browser's request from another site, as every write the website's session could carry", async () => {
    const answer = await askForCode(
      { email: 'reader@example.com', botCheck: 'answer' },
      { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' },
    );
    expect(answer.status).toBe(403);
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });

  it("has one address: an empty part (//) is an address the API doesn't have, past no firewall rule", async () => {
    for (const path of ['/api/v1//auth/email/code', '/api/v1/auth//email/code']) {
      const answer = await call('POST', path, {
        body: JSON.stringify({ email: 'reader@example.com', botCheck: 'answer' }),
        headers: { 'content-type': 'application/json' },
      });
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).toEqual({
        defined: false,
        code: 'NOT_FOUND',
        status: 404,
        message: 'No such call',
      });
    }
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });
});
