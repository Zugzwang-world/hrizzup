import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The typed API's route (route.ts), for the market console's calls: to anyone but an admin, every
 * request to one of them, whatever it carries (a body that isn't JSON, the wrong content type, a
 * method the call doesn't take), answers exactly as an address the API doesn't have, the same
 * status, body and headers, before the request is read. Who is signed in and whether they're an
 * admin are stood in for; the database's own checks are tested with the database.
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: vi.fn() }) }));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));

const route = await import('./route.ts');

const SITE = 'https://staging.hrizzup.com';
const ID = '019a6b3c-0001-7000-8000-000000000001';

async function answer(method: keyof typeof route, path: string, init: RequestInit = {}) {
  const handler = route[method] as (request: Request) => Promise<Response>;
  const response = await handler(new Request(`${SITE}${path}`, { method, ...init }));
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}

/** Every way to send a console call, sound or not. */
const attempts: [keyof typeof route, string, RequestInit][] = [
  ['GET', '/api/v1/admin/markets', {}],
  ['GET', `/api/v1/admin/markets/${ID}`, {}],
  ['GET', '/api/v1/admin/markets/not-an-id', {}],
  ['POST', '/api/v1/admin/markets', { body: '{', headers: { 'content-type': 'application/json' } }],
  [
    'POST',
    '/api/v1/admin/markets',
    { body: 'question=x', headers: { 'content-type': 'text/plain' } },
  ],
  [
    'POST',
    '/api/v1/admin/markets',
    { body: '{}', headers: { 'content-type': 'application/json' } },
  ],
  [
    'POST',
    `/api/v1/admin/markets/${ID}/settle`,
    { body: '{', headers: { 'content-type': 'application/json' } },
  ],
  ['DELETE', `/api/v1/admin/markets/${ID}`, {}],
  ['GET', '/api/v1/admin', {}],
  ['GET', '/api/v1//admin/markets', {}],
  [
    'POST',
    '/api/v1//admin//markets',
    { body: '{', headers: { 'content-type': 'application/json' } },
  ],
  ['GET', '/api/v1/admin/no-such-call', {}],
];

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the market console's addresses, to anyone but an admin", () => {
  it("answer exactly as an address the API doesn't have, whatever is sent", async () => {
    const unknown = await answer('GET', '/api/v1/no-such-call');
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body)).toEqual({
      defined: false,
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such call',
    });
    for (const [who, setUp] of [
      ['signed out', () => signedIn.mockResolvedValue(null)],
      [
        'signed in, not an admin',
        () => {
          signedIn.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000c2' });
          isAdmin.mockResolvedValue(false);
        },
      ],
      [
        'signed in, the admin check failing',
        () => {
          signedIn.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000c2' });
          isAdmin.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));
        },
      ],
    ] as const) {
      setUp();
      for (const [method, path, init] of attempts) {
        expect(await answer(method, path, init), `${who}: ${method} ${path}`).toEqual(unknown);
      }
    }
  });

  it('answer an admin as calls: a body that is not JSON is refused as such', async () => {
    signedIn.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000c1' });
    isAdmin.mockResolvedValue(true);
    const malformed = await answer('POST', '/api/v1/admin/markets', {
      body: '{',
      headers: { 'content-type': 'application/json' },
    });
    expect(malformed.status).toBe(400);
    expect(malformed.headers['cache-control']).toBe('private, no-store');
  });

  it("don't exist on production, until launch, even for an admin", async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    signedIn.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000c1' });
    isAdmin.mockResolvedValue(true);
    const unknown = await answer('GET', '/api/v1/no-such-call');
    expect(await answer('GET', '/api/v1/admin/markets')).toEqual(unknown);
    expect(await answer('GET', '/api/v1/admin/perps')).toEqual(unknown);
    expect(await answer('GET', '/api/v1/admin/perps/01a1c501-ec40-78f6-87b6-3fb041143421')).toEqual(
      unknown,
    );
    expect(isAdmin).not.toHaveBeenCalled();
  });
});
