import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_COOKIE, pendingCookieValue } from '@/lib/email-code.ts';

const mocks = vi.hoisted(() => ({
  sendSignInCode: vi.fn(),
  passesBotCheck: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('@/lib/supabase/send-code.ts', () => ({ sendSignInCode: mocks.sendSignInCode }));
vi.mock('@/lib/turnstile.ts', async (original) => ({
  ...(await original<typeof import('@/lib/turnstile.ts')>()),
  passesBotCheck: mocks.passesBotCheck,
}));
vi.mock('@/lib/supabase/route.ts', async (original) => ({
  ...(await original<typeof import('@/lib/supabase/route.ts')>()),
  createRouteClient: () => ({
    supabase: { auth: { verifyOtp: mocks.verifyOtp } },
    respond: <T>(response: T) => response,
  }),
}));

const { POST: askForCode } = await import('./email/code/route.ts');
const { POST: checkCode } = await import('./code/verify/route.ts');
const { POST: startAgain } = await import('./code/cancel/route.ts');

const SITE = 'http://localhost:3000';

/** A form post to our site; a header given as '' is left out (a request with no Origin). */
function post(path: string, fields: Record<string, string>, extra: Record<string, string> = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', origin: SITE, ...extra };
  return new NextRequest(`${SITE}${path}`, {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: Object.entries(headers).filter(([, value]) => value !== ''),
  });
}

const pendingCookie = (email = 'reader@example.com', next = '/sign-in-test') =>
  `${PENDING_COOKIE}=${encodeURIComponent(pendingCookieValue({ email, next }))}`;

const location = (response: Response) => response.headers.get('location');

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable-key-for-this-test');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'secret-key-for-this-test');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret-for-this-test');
  mocks.sendSignInCode.mockResolvedValue('sent');
  mocks.passesBotCheck.mockResolvedValue(true);
  mocks.verifyOtp.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('asking for a code (/auth/email/code)', () => {
  const ask = (fields: Record<string, string> = {}, extra: Record<string, string> = {}) =>
    askForCode(
      post(
        '/auth/email/code',
        {
          email: ' Reader@Example.com ',
          'cf-turnstile-response': 'answer',
          next: '/sign-in-test',
          ...fields,
        },
        extra,
      ),
    );

  it('checks the bot check, emails a code, and remembers the address', async () => {
    const response = await ask();
    expect(response.status).toBe(303);
    expect(location(response)).toBe(`${SITE}/sign-in-test`);
    expect(mocks.passesBotCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: 'turnstile-secret-for-this-test',
        answer: 'answer',
        hostname: 'localhost',
        action: 'email-code',
      }),
    );
    expect(mocks.sendSignInCode).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'secret-key-for-this-test',
      'reader@example.com',
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${PENDING_COOKIE}=`);
    expect(cookie).toContain('reader%40example.com');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Max-Age=600/i);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('marks the cookie Secure off this Mac', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { POST } = await import('./email/code/route.ts');
    const response = await POST(
      post('/auth/email/code', {
        email: 'reader@example.com',
        'cf-turnstile-response': 'answer',
      }),
    );
    expect(response.headers.get('set-cookie')).toMatch(/;\s*Secure/i);
  });

  it('sends nothing when the bot check fails', async () => {
    mocks.passesBotCheck.mockResolvedValue(false);
    const response = await ask();
    expect(location(response)).toBe(`${SITE}/sign-in-test?error=bot-check`);
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('sends nothing for an address that cannot be one', async () => {
    const response = await ask({ email: 'not-an-address' });
    expect(location(response)).toBe(`${SITE}/sign-in-test?error=email`);
    expect(mocks.passesBotCheck).not.toHaveBeenCalled();
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });

  it("passes on Supabase's email limits, and other failures, without a code step", async () => {
    mocks.sendSignInCode.mockResolvedValue('too-many');
    const limited = await ask();
    expect(location(limited)).toBe(`${SITE}/sign-in-test?error=too-many`);
    expect(limited.headers.get('set-cookie')).toBeNull();
    mocks.sendSignInCode.mockResolvedValue('failed');
    expect(location(await ask())).toBe(`${SITE}/sign-in-test?error=send`);
  });

  it('refuses a post from another site, or with no origin, and does nothing where keys are missing', async () => {
    for (const origin of ['https://evil.example', 'null', '']) {
      const refused = await ask({}, { origin });
      expect(refused.status, `origin ${JSON.stringify(origin)}`).toBe(403);
    }
    expect(mocks.passesBotCheck).not.toHaveBeenCalled();
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(location(await ask())).toBe(`${SITE}/sign-in-test?error=not-configured`);
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });

  it("doesn't exist on production", async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    expect((await ask()).status).toBe(404);
    expect(mocks.sendSignInCode).not.toHaveBeenCalled();
  });
});

describe('typing the code (/auth/code/verify)', () => {
  const check = (code: string, cookie: string | null = pendingCookie()) =>
    checkCode(post('/auth/code/verify', { code }, cookie ? { cookie } : {}));

  it('signs in with the code for the remembered address, then forgets the address', async () => {
    const response = await check('1234 5678');
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'reader@example.com',
      token: '12345678',
      type: 'email',
    });
    expect(response.status).toBe(303);
    expect(location(response)).toBe(`${SITE}/sign-in-test`);
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`${PENDING_COOKIE}=;`));
  });

  it('never follows a return path off the site, even one forged into the cookie', async () => {
    const forged = `${PENDING_COOKIE}=${encodeURIComponent(
      JSON.stringify({ email: 'reader@example.com', next: '//evil.example' }),
    )}`;
    const response = await check('12345678', forged);
    expect(location(response)).toBe(`${SITE}/sign-in-test`);
  });

  it('says to try again when Supabase fails or cannot be reached, not that the code is wrong', async () => {
    for (const status of [0, undefined, 500, 503]) {
      mocks.verifyOtp.mockResolvedValue({ data: {}, error: { status } });
      expect(location(await check('12345678')), String(status)).toBe(
        `${SITE}/sign-in-test?error=verify-failed`,
      );
    }
  });

  it('keeps the code step for a wrong code, and says when to wait', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403 } });
    const wrong = await check('12345678');
    expect(location(wrong)).toBe(`${SITE}/sign-in-test?error=code-wrong`);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: { status: 429 } });
    expect(location(await check('12345678'))).toBe(`${SITE}/sign-in-test?error=too-many`);
  });

  it("doesn't ask Supabase about a code that isn't one, or with no address remembered", async () => {
    expect(location(await check('1234'))).toBe(`${SITE}/sign-in-test?error=code-format`);
    expect(location(await check('12345678', null))).toBe(`${SITE}/sign-in-test?error=code-expired`);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('refuses a post from another site, or with no origin', async () => {
    for (const origin of ['https://evil.example', 'null', '']) {
      const response = await checkCode(
        post('/auth/code/verify', { code: '12345678' }, { origin, cookie: pendingCookie() }),
      );
      expect(response.status, `origin ${JSON.stringify(origin)}`).toBe(403);
    }
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});

describe('starting again (/auth/code/cancel)', () => {
  it('forgets the address and returns to the email step', async () => {
    const response = await startAgain(post('/auth/code/cancel', {}, { cookie: pendingCookie() }));
    expect(location(response)).toBe(`${SITE}/sign-in-test`);
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`${PENDING_COOKIE}=;`));
  });
});
