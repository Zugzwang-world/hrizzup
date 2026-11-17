import { os } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where social is off (production, until launch; docs/social/build.md, D14), every social call
 * answers as an address the API doesn't have, whether or not it is live. No social call is live
 * yet, so `social.test.ts` proves only the not-live rule on production; here a made-up live social
 * call shows the social-off choice by itself: served on staging, unmatched on production, while a
 * live call that isn't social's is served on both. The router is a small one of plain procedures
 * (none made from base.ts's implementer), so nothing but the route's own choice can hide the call.
 */

const signedIn = vi.fn();

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: vi.fn() }) }));
vi.mock('@/lib/api/router.ts', () => ({
  router: {
    health: os.route({ method: 'GET', path: '/health' }).handler(() => ({ ok: 'health' })),
    social: {
      lists: os.route({ method: 'GET', path: '/social/lists' }).handler(() => ({ ok: 'social' })),
      me: {
        post: os
          .route({ method: 'POST', path: '/social/me/posts' })
          .handler(() => ({ ok: 'post' })),
      },
    },
    owner: {
      agent: os.route({ method: 'GET', path: '/owner/agent' }).handler(() => ({ ok: 'owner' })),
    },
    reader: { get: os.route({ method: 'GET', path: '/reader' }).handler(() => ({ ok: 'reader' })) },
    admin: {
      social: {
        settings: {
          get: os
            .route({ method: 'GET', path: '/admin/social/settings' })
            .handler(() => ({ ok: 'admin' })),
        },
      },
    },
  },
}));

const route = await import('./route.ts');

const SITE = 'https://staging.hrizzup.com';

async function answer(method: keyof typeof route, path: string, init: RequestInit = {}) {
  const handler = route[method] as (request: Request) => Promise<Response>;
  const response = await handler(new Request(`${SITE}${path}`, { method, ...init }));
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}

const social: [keyof typeof route, string][] = [
  ['GET', '/api/v1/social/lists'],
  ['POST', '/api/v1/social/me/posts'],
  ['GET', '/api/v1/owner/agent'],
  ['GET', '/api/v1/reader'],
];

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('a live social call, where social is on and where it is off', () => {
  it('is served on staging, and a live call that is not social’s is served too', async () => {
    for (const [method, path] of social) {
      const served = await answer(method, path);
      expect(served.status, `${method} ${path}`).toBe(200);
      expect(served.body).toMatch(/"ok"/);
    }
    expect((await answer('GET', '/api/v1/health')).status).toBe(200);
  });

  it('answers exactly as an address the API doesn’t have on production, byte for byte', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const unknown = await answer('GET', '/api/v1/no-such-call');
    expect(unknown.status).toBe(404);
    for (const [method, path] of social) {
      expect(await answer(method, path), `${method} ${path}`).toEqual(unknown);
    }
    // The console's own address for social is turned away by the console's gate, with the same answer.
    expect(await answer('GET', '/api/v1/admin/social/settings')).toEqual(unknown);
  });

  it('leaves the calls that are not social’s alone on production', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const health = await answer('GET', '/api/v1/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: 'health' });
  });
});
