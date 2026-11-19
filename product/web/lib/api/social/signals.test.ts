import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The view note's handler (lib/api/social/signals.ts; docs/social/r11-design.md, section 3.4): what it answers, the
 * 409 for a reused request ID, the visitor limit's 429 and its headers, the contract's own 400s, and that it is
 * not there where social is off (production). Counting and the limit are stood in for: what a note sends to Redis
 * is proven in `lib/social/counting.test.ts`, and the limit's own rules in `lib/social/limits.test.ts`. The
 * database is never reached: a note writes nothing there, so a test that finds it called fails.
 */

const countViews = vi.fn();
const allowVisitor = vi.fn();
/** Who the stand-in says a visitor is; the real one needs the secret and an address. */
const visitorOf = vi.fn<(headers: Headers) => string | null>(() => 'visitor-one');

vi.mock('@/lib/social/counting.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/counting.ts')>()),
  countViews: (...args: unknown[]) => countViews(...args),
}));
vi.mock('@/lib/social/limits.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/limits.ts')>()),
  visitorOf: (headers: Headers) => visitorOf(headers),
  allowVisitor: (...args: unknown[]) => allowVisitor(...args),
}));
const query = vi.fn();
vi.mock('@/lib/db.ts', () => ({
  database: () => ({
    connect: async () => {
      query();
      throw new Error('A view note never touches the database');
    },
  }),
}));

const { router } = await import('../router.ts');
const { NoteReused } = await import('@/lib/social/counting.ts');
const { refusalOf } = await import('@/lib/social/errors.ts');

const ORIGIN = 'https://abc-preview.hrizzup.test';
const REQUEST = '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8d';
const POST = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d';
const STORY = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f';
// A made-up device ID, plainly not a secret.
const DEVICE = 'aaaaaaaaaaaaaaaaaaaaaa';
const noSuchCall = { code: 'NOT_FOUND', status: 404, message: 'No such call' };

const NOTE = {
  requestId: REQUEST,
  device: DEVICE,
  items: [
    { kind: 'post' as const, id: POST },
    { kind: 'story' as const, id: STORY },
  ],
};

const api = (headers: Record<string, string> = {}) => {
  const resHeaders = new Headers();
  return {
    resHeaders,
    call: createRouterClient(router, {
      context: { headers: new Headers(headers), url: `${ORIGIN}/api/v1/social/views`, resHeaders },
    }),
  };
};

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  countViews.mockResolvedValue(2);
  allowVisitor.mockResolvedValue({ allowed: true });
  visitorOf.mockImplementation(() => 'visitor-one');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('the view note', () => {
  it('answers how many items were counted, signed out and with no key', async () => {
    const { call } = api();
    await expect(call.social.views(NOTE)).resolves.toEqual({ counted: 2 });
    expect(countViews).toHaveBeenCalledTimes(1);
    expect(countViews).toHaveBeenCalledWith(NOTE, { address: null });
    expect(query).not.toHaveBeenCalled();
  });

  it('answers 0 for a retry or a Redis that was down: still a 200', async () => {
    countViews.mockResolvedValue(0);
    await expect(api().call.social.views(NOTE)).resolves.toEqual({ counted: 0 });
  });

  it('counts the note against the visitor’s limit first, by visitor and never by address', async () => {
    visitorOf.mockImplementation(() => 'visitor-two');
    await api().call.social.views(NOTE);
    expect(allowVisitor).toHaveBeenCalledWith('view-note', 'visitor-two', 'count');
    expect(allowVisitor.mock.invocationCallOrder[0]).toBeLessThan(
      countViews.mock.invocationCallOrder[0] ?? 0,
    );
    // A visitor who can't be told apart is still let through by the limit (it answers allowed), and counted.
    visitorOf.mockImplementation(() => null);
    await api().call.social.views(NOTE);
    expect(allowVisitor).toHaveBeenLastCalledWith('view-note', null, 'count');
  });

  it('gives counting the caller’s address for the cap per address (as `ipAddress` reads it), and none when there is none', async () => {
    await api({ 'x-real-ip': '203.0.113.7' }).call.social.views(NOTE);
    expect(countViews).toHaveBeenLastCalledWith(NOTE, { address: '203.0.113.7' });
    await api({ 'x-real-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }).call.social.views(NOTE);
    expect(countViews).toHaveBeenLastCalledWith(NOTE, {
      address: '2001:db8:1:2:aaaa:bbbb:cccc:dddd',
    });
    await api().call.social.views(NOTE);
    expect(countViews).toHaveBeenLastCalledWith(NOTE, { address: null });
    // The limit stays R6's, by the visitor it makes of the address; nothing else of the address is passed on.
    expect(allowVisitor).toHaveBeenLastCalledWith('view-note', 'visitor-one', 'count');
  });

  it('is 409 request_reused, in the words the API’s other writes use, when the ID was used for another note', async () => {
    countViews.mockRejectedValue(new NoteReused());
    await expect(api().call.social.views(NOTE)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: refusalOf('HZS27')?.message,
      data: { reason: 'request_reused' },
    });
    expect(refusalOf('HZS27')?.message).toBe(
      'This request ID was already used for a different request: make a new one',
    );
  });

  it('lets any other error through as it came', async () => {
    countViews.mockRejectedValue(new TypeError('a bug'));
    await expect(api().call.social.views(NOTE)).rejects.not.toMatchObject({ status: 409 });
  });

  it('is 429 with Retry-After and the RateLimit headers when the allowance says no, and counts nothing', async () => {
    allowVisitor.mockResolvedValue({ allowed: false, retryAfterSeconds: 41 });
    const { call, resHeaders } = api();
    await expect(call.social.views(NOTE)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { retryAfterSeconds: 41 },
    });
    expect(resHeaders.get('Retry-After')).toBe('41');
    expect(resHeaders.get('RateLimit-Policy')).toBe('"view-notes";q=30;w=60');
    expect(resHeaders.get('RateLimit')).toBe('"view-notes";r=0;t=41');
    expect(countViews).not.toHaveBeenCalled();
  });

  it('sends the limit’s headers on a note that is let through', async () => {
    allowVisitor.mockResolvedValue({ allowed: true, left: { remaining: 29, resetSeconds: 60 } });
    const { call, resHeaders } = api();
    await call.social.views(NOTE);
    expect(resHeaders.get('RateLimit')).toBe('"view-notes";r=29;t=60');
    expect(resHeaders.get('Retry-After')).toBeNull();
  });

  it('is 400 for 51 items, none, a short or odd device, or a request ID that is not a UUID, before the limit and the count', async () => {
    const { call } = api();
    const item = (n: number) => ({
      kind: 'post' as const,
      id: `01a1e7fc-c300-7a1b-9c2d-3e4f5a6b${(0x7c00 + n).toString(16)}`,
    });
    const fifty = Array.from({ length: 50 }, (_, n) => item(n));
    await expect(call.social.views({ ...NOTE, items: [...fifty, item(50)] })).rejects.toMatchObject(
      {
        code: 'BAD_REQUEST',
        status: 400,
      },
    );
    for (const bad of [
      { ...NOTE, items: [] },
      { ...NOTE, device: 'short' },
      { ...NOTE, device: `${'a'.repeat(15)} ` },
      { ...NOTE, device: 'a'.repeat(65) },
      { ...NOTE, requestId: 'not-a-uuid' },
      { ...NOTE, items: [{ kind: 'agent', id: POST }] },
      { ...NOTE, items: [{ kind: 'post', id: 'not-a-uuid' }] },
      { ...NOTE, extra: true },
    ]) {
      await expect(call.social.views(bad as never), JSON.stringify(bad)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        status: 400,
      });
    }
    // 50 is the most a note holds, and is let through.
    await expect(call.social.views({ ...NOTE, items: fifty })).resolves.toEqual({ counted: 2 });
    expect(allowVisitor).toHaveBeenCalledTimes(1);
    expect(countViews).toHaveBeenCalledTimes(1);
  });

  it('is an address the API does not have where social is off (production), before any input is read', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    await expect(api().call.social.views(NOTE)).rejects.toMatchObject(noSuchCall);
    await expect(api().call.social.views({} as never)).rejects.toMatchObject(noSuchCall);
    expect(allowVisitor).not.toHaveBeenCalled();
    expect(countViews).not.toHaveBeenCalled();
  });

  it('leaves an agent’s stats for later: its call is not live yet', async () => {
    await expect(api().call.social.me.stats({})).rejects.toMatchObject(noSuchCall);
  });
});
