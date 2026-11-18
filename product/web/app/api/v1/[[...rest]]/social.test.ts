import { contract, isSocialCall, procedures } from '@hrizzup/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The typed API's route (route.ts), for social's calls (docs/social/build.md, D9 and D14). A call
 * not live yet answers exactly as an address the API doesn't have: the same status, headers and
 * body bytes, whoever asks and whatever is sent, before the request is read. The calls that are
 * live (M3's three console calls, then each relay's own as it builds them) are read from their own
 * mark, so this holds for any number of them: to anyone but an admin, a console call is the same
 * answer too. On production, where social is off until launch, every social call is, live or not.
 * Who is signed in and whether they're an admin are stood in for.
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

async function answer(method: keyof typeof route, path: string, init: RequestInit = {}) {
  const handler = route[method] as (request: Request) => Promise<Response>;
  const response = await handler(new Request(`${SITE}${path}`, { method, ...init }));
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}

const socialCalls = procedures(contract).filter(([name]) => isSocialCall(name.split('.')));
/** Whether a call's back end is built: it carries no `live: false`. */
const isLive = ([, procedure]: (typeof socialCalls)[number]) =>
  procedure['~orpc'].meta.live !== false;
const liveCalls = socialCalls.filter(isLive);
const notLiveCalls = socialCalls.filter((call) => !isLive(call));

/** A call's address, with an example for each {part}. */
const addressOf = (path: string) =>
  `/api/v1${path
    .replace('{id}', '01a199e9-d180-75ec-8a81-134dd403419a')
    .replace('{handle}', 'delhi_explainer')
    .replace('{name}', 'voice')
    .replace('{slug}', 'timeline')}`;

type Attempt = [keyof typeof route, string, RequestInit];

/** Every way to send each call: as it is made, with a body that isn't JSON, and in the wrong type. */
const attemptsAt = (calls: typeof socialCalls): Attempt[] =>
  calls.flatMap(([, procedure]) => {
    const { method, path } = procedure['~orpc'].route;
    const address = addressOf(path ?? '');
    const asked = method as 'GET' | 'POST';
    return [
      [asked, address, {}],
      [asked, `${address}?limit=zzz`, {}],
      ...(asked === 'POST'
        ? ([
            ['POST', address, { body: '{', headers: { 'content-type': 'application/json' } }],
            ['POST', address, { body: '{}', headers: { 'content-type': 'application/json' } }],
            ['POST', address, { body: 'x=1', headers: { 'content-type': 'text/plain' } }],
          ] as Attempt[])
        : []),
      // The wrong method for the address is an address the API doesn't have too.
      [asked === 'GET' ? 'DELETE' : 'PUT', address, {}],
    ] as Attempt[];
  });

const attempts = attemptsAt(socialCalls);
const notLiveAttempts = attemptsAt(notLiveCalls);
/** The live calls that anyone but an admin can't find: the console's (their addresses are under /admin/). */
const liveConsoleAttempts = attemptsAt(liveCalls.filter(([name]) => name.startsWith('admin.')));

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("social's calls, the ones not live yet", () => {
  const people = [
    ['signed out', () => signedIn.mockResolvedValue(null)],
    [
      'signed in',
      () => {
        signedIn.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000d2' });
        isAdmin.mockResolvedValue(false);
      },
    ],
    [
      'an admin',
      () => {
        signedIn.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000d1' });
        isAdmin.mockResolvedValue(true);
      },
    ],
  ] as const;

  it('are all 77 of them in the contract, each is tried here at its own address, and M3 made the console’s three live', () => {
    expect(socialCalls.length).toBe(77);
    expect(attempts.length).toBeGreaterThan(socialCalls.length * 3);
    expect(liveCalls.length + notLiveCalls.length).toBe(77);
    expect(liveCalls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'admin.social.invites.create',
        'admin.social.stories.save',
        'admin.social.updates.save',
      ]),
    );
  });

  it("answer exactly as an address the API doesn't have, whoever asks and whatever is sent", async () => {
    const unknown = await answer('GET', '/api/v1/no-such-call');
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body)).toEqual({
      defined: false,
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such call',
    });
    for (const [who, setUp] of people) {
      setUp();
      for (const [method, path, init] of notLiveAttempts) {
        expect(await answer(method, path, init), `${who}: ${method} ${path}`).toEqual(unknown);
      }
    }
  });

  it("answer anyone but an admin the same on the console's live calls, and an admin reaches them", async () => {
    const unknown = await answer('GET', '/api/v1/no-such-call');
    const [signedOut, signedInNotAdmin, admin] = people;
    for (const [who, setUp] of [signedOut, signedInNotAdmin]) {
      setUp();
      for (const [method, path, init] of liveConsoleAttempts) {
        expect(await answer(method, path, init), `${who}: ${method} ${path}`).toEqual(unknown);
      }
    }
    // An admin gets past the gate: what they send is read, so an empty save is a refused input.
    admin[1]();
    for (const path of ['/api/v1/admin/social/stories', '/api/v1/admin/social/updates']) {
      const refused = await answer('POST', path, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      expect(refused.status, path).toBe(400);
      expect(JSON.parse(refused.body).code, path).toBe('BAD_REQUEST');
    }
  });

  it('keep reaching the calls that are live: the router left them out only for the ones not live', async () => {
    signedIn.mockResolvedValue(null);
    const unknown = await answer('GET', '/api/v1/no-such-call');
    const settings = await answer('GET', '/api/v1/auth/settings');
    expect(settings).not.toEqual(unknown);
    expect([200, 503]).toContain(settings.status);
    const signedOut = await answer('GET', '/api/v1/me');
    expect(signedOut.status).toBe(401);
  });

  it("don't exist on production either, where social is off until launch, for anyone", async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const unknown = await answer('GET', '/api/v1/no-such-call');
    for (const [who, setUp] of people) {
      setUp();
      for (const [method, path, init] of attempts) {
        expect(await answer(method, path, init), `${who}: ${method} ${path}`).toEqual(unknown);
      }
    }
    expect(isAdmin).not.toHaveBeenCalled();
  });
});
