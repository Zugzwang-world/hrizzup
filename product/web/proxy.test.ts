import { readdirSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The proxy (proxy.ts): it keeps sessions fresh, and hands anyone but an admin who asks for a
 * page of the market console the site's own "not found" page, as for any address the site
 * doesn't have, before the console's page runs. Who is an admin, and Supabase's session client,
 * are stood in for here; the real answers are compared on every preview by the console's
 * journeys (e2e/journeys/console.spec.ts).
 */

const consoleAdmin = vi.fn();
const getClaims = vi.fn();
let refreshes = false;
let supabaseSetUp = true;

vi.mock('./lib/api/console.ts', () => ({
  consoleAdmin: (headers: Headers) => consoleAdmin(headers),
}));
vi.mock('./lib/supabase/route.ts', () => ({
  createRouteClient: () => {
    if (!supabaseSetUp) return null;
    return {
      supabase: { auth: { getClaims: () => getClaims() } },
      // As the real one does when a session was refreshed: its new cookies go on the answer.
      respond: <T extends { cookies: { set: (name: string, value: string) => void } }>(
        response: T,
      ) => {
        if (refreshes) response.cookies.set('sb-session', 'refreshed');
        return response;
      },
    };
  },
}));

const { config, isConsolePage, NO_SUCH_PAGE, proxy } = await import('./proxy.ts');

const SITE = 'https://preview.example';
const request = (path: string) => new NextRequest(new URL(path, SITE));
const ADMIN = { account: '019a6b3c-0000-7000-8000-00000000000a', pool: {} };

/** Where the proxy sent the request: the rewritten address, or null when it went on as asked. */
function rewrittenTo(response: Response): string | null {
  const to = response.headers.get('x-middleware-rewrite');
  return to === null ? null : new URL(to, SITE).pathname;
}

afterEach(() => {
  vi.clearAllMocks();
  refreshes = false;
  supabaseSetUp = true;
});

describe("the market console's pages, to anyone but an admin", () => {
  const pages = ['/console', '/console/markets/new', '/console/markets/019a6c00-0000-7000-8000-0'];

  it('give the site\'s own "not found" page, signed in or not', async () => {
    consoleAdmin.mockResolvedValue(null);
    for (const path of pages) {
      const response = await proxy(request(path));
      expect(rewrittenTo(response), path).toBe(NO_SUCH_PAGE);
      expect(response.headers.get('x-middleware-next'), path).toBeNull();
    }
    expect(consoleAdmin).toHaveBeenCalledTimes(pages.length);
  });

  it('ask who is an admin only after the session is refreshed, with its new cookies', async () => {
    const order: string[] = [];
    getClaims.mockImplementation(async () => order.push('refresh'));
    consoleAdmin.mockImplementation(async () => {
      order.push('admin?');
      return null;
    });
    refreshes = true;
    const response = await proxy(request('/console'));
    expect(order).toEqual(['refresh', 'admin?']);
    // The refreshed session reaches the browser even on "not found": its old one is used up.
    expect(response.cookies.get('sb-session')?.value).toBe('refreshed');
    expect(rewrittenTo(response)).toBe(NO_SUCH_PAGE);
  });

  it('give "not found" where sign-in isn\'t set up, without asking anything', async () => {
    supabaseSetUp = false;
    for (const path of pages) {
      expect(rewrittenTo(await proxy(request(path))), path).toBe(NO_SUCH_PAGE);
    }
    expect(consoleAdmin).not.toHaveBeenCalled();
  });

  it('let an admin through to the page, which checks again', async () => {
    consoleAdmin.mockResolvedValue(ADMIN);
    for (const path of pages) {
      const response = await proxy(request(path));
      expect(rewrittenTo(response), path).toBeNull();
      expect(response.headers.get('x-middleware-next'), path).toBe('1');
    }
  });
});

describe('the sign-in test page', () => {
  it('keeps its session fresh and never asks who is an admin', async () => {
    const response = await proxy(request('/sign-in-test'));
    expect(getClaims).toHaveBeenCalledOnce();
    expect(consoleAdmin).not.toHaveBeenCalled();
    expect(rewrittenTo(response)).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it("goes on as asked where sign-in isn't set up", async () => {
    supabaseSetUp = false;
    const response = await proxy(request('/sign-in-test'));
    expect(rewrittenTo(response)).toBeNull();
  });
});

describe("the console's addresses", () => {
  it('are /console and everything below it, nothing else', () => {
    for (const path of ['/console', '/console/', '/console/markets/new', '/console/markets/x']) {
      expect(isConsolePage(path), path).toBe(true);
    }
    for (const path of ['/', '/consoles', '/console-new', '/sign-in-test', '/api/v1/admin']) {
      expect(isConsolePage(path), path).toBe(false);
    }
  });

  it('are all the proxy runs on, with the sign-in test page', () => {
    expect(config.matcher).toEqual(['/sign-in-test', '/console', '/console/:path*']);
  });
});

describe('the address with no page', () => {
  it('is a private folder, which App Router never routes, and no folder of the site', () => {
    const [first] = NO_SUCH_PAGE.split('/').filter(Boolean);
    expect(NO_SUCH_PAGE.split('/').filter(Boolean)).toHaveLength(1);
    expect(first?.startsWith('_')).toBe(true);
    expect(first?.startsWith('_next')).toBe(false);
    expect(readdirSync(new URL('./app', import.meta.url))).not.toContain(first);
  });
});
