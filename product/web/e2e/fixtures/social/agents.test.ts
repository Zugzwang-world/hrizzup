import { describe, expect, it, vi } from 'vitest';
import { agentsPages } from '../../pages/social/agents.ts';
import { ADMIN_TEST_ACCOUNT } from '../../support/test-accounts.ts';
import {
  AGENT_FIXTURE_HANDLE,
  AGENT_FIXTURE_REQUESTS,
  agentsFixtures,
  ensureAgentFixture,
} from './agents.ts';

/**
 * The agents fixture (docs/social/agents-design.md, V2): "screen check agent", made once on staging and found
 * again. The site, the clock and the waiting are stood in for, so the 90 seconds of its patience take no time.
 */

const BASE = 'https://preview.example.test';
const CONTEXT = {
  baseURL: BASE,
  headers: { 'x-vercel-protection-bypass': 'bypass-value', cookie: 'session=admin' },
};
// Made-up secrets, never real ones.
const CODE = 'hz-abcd-efgh-jkmn-pqrs';
const TOKEN = `Claim${'0'.repeat(38)}`;

type Sent = { method: string; path: string; headers: Record<string, string>; body: unknown };

/** A fake site: `answers` holds, for each call in order, the status and JSON it gives; once they run out it repeats the last. */
function site(answers: [number, unknown?][]) {
  const sent: Sent[] = [];
  let n = 0;
  const fake = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    sent.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: init?.headers as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const [status, body] = answers[Math.min(n, answers.length - 1)] ?? [500];
    n += 1;
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fake, sent };
}

/** A clock the waiting moves, and a sleep that only moves it. */
function clock() {
  let at = 0;
  const sleep = vi.fn(async (ms: number) => {
    at += ms;
  });
  return { sleep, now: () => at };
}

const MADE: [number, unknown?][] = [
  [404],
  [201, { code: CODE }],
  [201, { claimUrl: `${BASE}/sandbox/social/claim/${TOKEN}` }],
  [200, {}],
];

describe('the fixture agent', () => {
  it('is one fixture, named for what it is', () => {
    expect(agentsFixtures.map((fixture) => fixture.name)).toEqual(['screen check agent']);
  });

  it('is the one agent the screen check opens: the page’s address names its handle', () => {
    const profile = agentsPages.find((page) => page.route === '/sandbox/social/agents/[handle]');
    expect(profile?.path).toBe(`/sandbox/social/agents/${AGENT_FIXTURE_HANDLE}`);
    expect(AGENT_FIXTURE_HANDLE).toMatch(/^[a-z][a-z0-9_]{2,29}$/);
  });

  it('is done at once when its profile is there: one read, nothing written', async () => {
    const { fake, sent } = site([[200, {}]]);
    await ensureAgentFixture(CONTEXT, { fetch: fake, ...clock() });
    expect(sent).toEqual([
      {
        method: 'GET',
        path: `/api/v1/social/agents/${AGENT_FIXTURE_HANDLE}`,
        headers: { 'x-vercel-protection-bypass': 'bypass-value' },
        body: undefined,
      },
    ]);
  });

  it('is invited by the admin, unlisted, registered with no session and claimed by the admin', async () => {
    const { fake, sent } = site(MADE);
    await ensureAgentFixture(CONTEXT, { fetch: fake, ...clock() });
    expect(sent.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /api/v1/social/agents/${AGENT_FIXTURE_HANDLE}`,
      'POST /api/v1/admin/social/invites',
      'POST /api/v1/social/agents',
      'POST /api/v1/owner/claims',
    ]);
    const [, invite, register, claim] = sent;
    expect(invite?.headers.cookie).toBe('session=admin');
    expect(invite?.body).toEqual({
      requestId: AGENT_FIXTURE_REQUESTS.invite,
      email: ADMIN_TEST_ACCOUNT,
      note: "The screen check's fixture agent",
      house: false,
      listed: false,
    });
    // Registered signed out: the bypass stays for a protected preview, the session does not.
    expect(register?.headers).toMatchObject({ 'x-vercel-protection-bypass': 'bypass-value' });
    expect(register?.headers.cookie).toBeUndefined();
    expect(register?.body).toMatchObject({
      inviteCode: CODE,
      requestId: AGENT_FIXTURE_REQUESTS.register,
      handle: AGENT_FIXTURE_HANDLE,
      name: 'Screen check agent',
    });
    expect(claim?.headers.cookie).toBe('session=admin');
    expect(claim?.body).toEqual({
      requestId: AGENT_FIXTURE_REQUESTS.claim,
      token: TOKEN,
      ownerName: 'Screen check',
    });
  });

  it('has a request ID of its own for each step, fixed, so a second run repeats a step and never doubles it', async () => {
    expect(new Set(Object.values(AGENT_FIXTURE_REQUESTS)).size).toBe(3);
    for (const id of Object.values(AGENT_FIXTURE_REQUESTS)) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const first = site(MADE);
    await ensureAgentFixture(CONTEXT, { fetch: first.fake, ...clock() });
    const second = site(MADE);
    await ensureAgentFixture(CONTEXT, { fetch: second.fake, ...clock() });
    expect(second.sent.map((call) => call.body)).toEqual(first.sent.map((call) => call.body));
  });

  it.each([401, 404, 409])(
    'waits 5 seconds and starts again from the top when a step answers %i',
    async (status) => {
      const { fake, sent } = site([
        [404],
        [status],
        // The next pass: another run has finished it.
        [200, {}],
      ]);
      const world = clock();
      await ensureAgentFixture(CONTEXT, { fetch: fake, ...world });
      expect(world.sleep).toHaveBeenCalledExactlyOnceWith(5000);
      expect(sent.map((call) => `${call.method} ${call.path}`)).toEqual([
        `GET /api/v1/social/agents/${AGENT_FIXTURE_HANDLE}`,
        'POST /api/v1/admin/social/invites',
        `GET /api/v1/social/agents/${AGENT_FIXTURE_HANDLE}`,
      ]);
    },
  );

  it('starts again from the top when registration or the claim is turned away, too', async () => {
    const { fake } = site([[404], [201, { code: CODE }], [409], [200, {}]]);
    const world = clock();
    await ensureAgentFixture(CONTEXT, { fetch: fake, ...world });
    expect(world.sleep).toHaveBeenCalledTimes(1);
    const claimTurnedAway = site([
      [404],
      [201, { code: CODE }],
      [201, { claimUrl: `${BASE}/sandbox/social/claim/${TOKEN}` }],
      [404],
      [200, {}],
    ]);
    const again = clock();
    await ensureAgentFixture(CONTEXT, { fetch: claimTurnedAway.fake, ...again });
    expect(again.sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after 90 seconds, saying what each step last answered and what to check', async () => {
    // The agent is never there, and the invite is always open under another run.
    const fake = vi.fn(
      async (input: URL | RequestInfo) =>
        new Response(null, {
          status: new URL(String(input)).pathname.includes('/invites') ? 409 : 404,
        }),
    ) as unknown as typeof fetch;
    const world = clock();
    const refused = ensureAgentFixture(CONTEXT, { fetch: fake, ...world });
    await expect(refused).rejects.toThrow(
      "The fixture agent screen_check_v1 isn't on this site after 90 seconds (last answers: lookup 404, invite 409).",
    );
    await expect(refused).rejects.toThrow('serves social.agents.get');
    await expect(refused).rejects.toThrow("uses staging's database");
    // 18 waits of 5 seconds.
    expect(world.sleep).toHaveBeenCalledTimes(18);
    expect(world.now()).toBe(90_000);
  });

  it('throws at once for an answer that is no other run’s doing, naming the step and the status, never an answer', async () => {
    const { fake } = site([[404], [201, { code: CODE }], [500, { message: `leaks ${CODE}` }]]);
    const world = clock();
    const failure = await ensureAgentFixture(CONTEXT, { fetch: fake, ...world }).catch(
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("The fixture agent's registration answered 500");
    expect((failure as Error).message).not.toContain(CODE);
    expect(world.sleep).not.toHaveBeenCalled();
  });

  it('throws at once for a 429, which is no other run’s doing: a limit is never waited out', async () => {
    const { fake, sent } = site([[404], [429, { message: `leaks ${CODE}` }]]);
    const world = clock();
    const failure = await ensureAgentFixture(CONTEXT, { fetch: fake, ...world }).catch(
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("The fixture agent's invite answered 429");
    expect((failure as Error).message).not.toContain(CODE);
    expect(world.sleep).not.toHaveBeenCalled();
    expect(sent).toHaveLength(2);
  });

  it('prints nothing, and carries no secret in any error, when the site cannot be reached', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = vi.fn(async () => {
      throw new Error(`connect failed for ${CODE}`);
    }) as unknown as typeof fetch;
    const failure = await ensureAgentFixture(CONTEXT, { fetch: broken, ...clock() }).catch(
      (thrown: unknown) => thrown as Error,
    );
    expect((failure as Error).message).toBe("The fixture agent's lookup did not reach the site");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
