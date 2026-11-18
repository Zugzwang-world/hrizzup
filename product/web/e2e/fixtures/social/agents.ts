import { ADMIN_TEST_ACCOUNT } from '../../support/test-accounts.ts';
import type { SocialFixture, SocialFixtureContext } from './fixture.ts';

/**
 * The fixtures the checks keep for the social sandbox's agents area (R6; docs/social/agents-design.md, V2): the
 * agent "screen check agent", registered and claimed once on staging by the console's admin test account, and
 * found again on every run after, so the screen check has a profile to open
 * (`e2e/pages/social/agents.ts`, `/sandbox/social/agents/screen_check_v1`). Its invite is unlisted, so it never
 * shows in the directory. Nothing else is ever done to it.
 *
 * - **Each step has a fixed request ID,** so a second run, or another run at the same moment, repeats a step
 *   rather than doing it twice. The IDs and the handle change together: to start again (the fixture agent is
 *   registered but never claimed), raise the version in the handle and make new IDs.
 * - **A step the database refuses because of where another run has got to** (401 a code replaced, 404 no agent
 *   yet, 409 an invite open or used) waits 5 seconds and starts again from the top, for up to 90 seconds; then it
 *   throws, saying what to do.
 * - **Nothing secret is ever shown:** the invite's code, the agent's key and its claim link go from one answer to
 *   the next call and nowhere else; an error names the step and the status, never an answer.
 */

/** The fixture agent's handle, which `e2e/pages/social/agents.ts` opens (its list imports no value, so it names it too). */
export const AGENT_FIXTURE_HANDLE = 'screen_check_v1';

/** The three steps' request IDs: fixed, changed only with the handle. */
export const AGENT_FIXTURE_REQUESTS = {
  invite: '5c0e0a11-0001-4000-8000-000000000001',
  register: '5c0e0a11-0002-4000-8000-000000000002',
  claim: '5c0e0a11-0003-4000-8000-000000000003',
} as const;

const AGENT_NAME = 'Screen check agent';
const OWNER_NAME = 'Screen check';
const WAIT_MS = 5_000;
const GIVE_UP_MS = 90_000;

/** What a fixture is made with: the world's fetch, sleep and clock, so a test can stand in for them. */
export type AgentFixtureWorld = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** The answers that mean "another run is partway": try again from the top. */
const AGAIN = new Set([401, 404, 409]);

/** The headers without the session: the bypass for a protected preview stays, and no one is signed in. */
function signedOut(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'cookie'),
  );
}

/**
 * Makes the fixture agent if it isn't there: invited by the admin (unlisted), registered with no session, claimed
 * by the admin. Finds it again if it is.
 */
export async function ensureAgentFixture(
  { baseURL, headers }: SocialFixtureContext,
  world: AgentFixtureWorld = {},
): Promise<void> {
  const send = world.fetch ?? fetch;
  const sleep =
    world.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = world.now ?? Date.now;
  const started = now();
  const open = signedOut(headers);

  const call = (step: string, path: string, as: Record<string, string>, body?: unknown) =>
    send(new URL(path, baseURL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? as : { ...as, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch(() => {
      throw new Error(`The fixture agent's ${step} did not reach the site`);
    });

  /** One pass from step 1: whether the agent is there at the end. A step another run is in the middle of answers "not yet". */
  async function pass(): Promise<boolean> {
    const found = await call('lookup', `/api/v1/social/agents/${AGENT_FIXTURE_HANDLE}`, open);
    if (found.status === 200) return true;
    if (found.status !== 404) {
      throw new Error(`The fixture agent's lookup answered ${found.status}`);
    }

    const invited = await call('invite', '/api/v1/admin/social/invites', headers, {
      requestId: AGENT_FIXTURE_REQUESTS.invite,
      email: ADMIN_TEST_ACCOUNT,
      note: "The screen check's fixture agent",
      house: false,
      listed: false,
    });
    if (AGAIN.has(invited.status)) return false;
    if (invited.status !== 201 && invited.status !== 200) {
      throw new Error(`The fixture agent's invite answered ${invited.status}`);
    }
    const { code } = (await invited.json()) as { code?: unknown };
    if (typeof code !== 'string') throw new Error("The fixture agent's invite gave no code");

    const registered = await call('registration', '/api/v1/social/agents', open, {
      inviteCode: code,
      requestId: AGENT_FIXTURE_REQUESTS.register,
      handle: AGENT_FIXTURE_HANDLE,
      name: AGENT_NAME,
      bio: 'A fixture the screen check keeps on staging. Not a real agent.',
    });
    if (AGAIN.has(registered.status)) return false;
    if (registered.status !== 201) {
      throw new Error(`The fixture agent's registration answered ${registered.status}`);
    }
    const { claimUrl } = (await registered.json()) as { claimUrl?: unknown };
    const token =
      typeof claimUrl === 'string' ? new URL(claimUrl).pathname.split('/').at(-1) : undefined;
    if (!token) throw new Error("The fixture agent's registration gave no claim link");

    const claimed = await call('claim', '/api/v1/owner/claims', headers, {
      requestId: AGENT_FIXTURE_REQUESTS.claim,
      token,
      ownerName: OWNER_NAME,
    });
    if (AGAIN.has(claimed.status)) return false;
    if (claimed.status !== 200) {
      throw new Error(`The fixture agent's claim answered ${claimed.status}`);
    }
    return true;
  }

  for (;;) {
    if (await pass()) return;
    if (now() - started >= GIVE_UP_MS) {
      throw new Error(
        "The fixture agent is registered but unclaimed: raise its handle's version in fixtures/social/agents.ts",
      );
    }
    await sleep(WAIT_MS);
  }
}

export const agentsFixtures: readonly SocialFixture[] = [
  { name: 'screen check agent', ensure: (context) => ensureAgentFixture(context) },
];
