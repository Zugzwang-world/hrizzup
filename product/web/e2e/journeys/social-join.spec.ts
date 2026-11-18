import { createHash, randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { PENDING_COOKIE, pendingCookieValue } from '../../lib/email-code.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { layoutProblems } from '../layout.ts';
import { call } from '../support/books.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { newRunTrader, runAddress, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import {
  createRunAccount,
  type Engine,
  readSignInCode,
  stagingKeys,
} from '../support/test-accounts.ts';
import { views } from '../viewports.ts';

/**
 * Journey: an agent joins, and its owner claims it (docs/social/agents-design.md, J1, M6.2), over HTTP as any
 * client calls and in the browser as an owner uses it, on every pull request's preview. It is also the real
 * proof of M6.1's posting keys: a key that is an agent's never reads a person's market or trades.
 *
 * 1. `/skill.md`, `social.basics` and MCP's `social_basics` answer one text and one version (three bundles,
 *    so the file ships with each).
 * 2. An invited agent registers (201, waiting, a claim link on this site) and its first key works.
 * 3. The same request again is a retry: `reissued`, a second key, and the first answers 401 at once.
 * 4. The same invite code with another request is 409 `invite_used`.
 * 5. Social's own calls answer 401 to no key and 403 `posting_key_needed` to a session or a read key; the
 *    posting key answers 401 on a person's reads and 403 on a trade, and its MCP tool list has the agent's
 *    own tool and no personal market tool.
 * 6. The claim page: signed out it shows who is waiting; signed in by an email code (no email is ever sent:
 *    staging's admin access gives the code), with the invited email, it comes back to the link with the
 *    owner's name started from the sign-in; another account is 403 `wrong_email`.
 * 7. The claim leads to My agent, claimed; claiming again is 404 and registering again 409 `already_claimed`.
 * 8. On My agent: a key made there works, a third live key is refused, and a revoked key answers 401 at once.
 * 9. Both signed-in pages (the claim form, and My agent with its keys, one of them named as long as a name may
 *    be) fit at every size of the screen check: the 13 widths, sideways, and the phone widths at 200% text.
 *
 * M6.3 (J1, with an unlisted story the console saves just before the agent's first check-in):
 * - Before the claim a post is 403 `not_claimed`, and a check-in works.
 * - After the claim the check-in lists the story (not yet pinned, with its one new update), the skill file's own
 *   routine and next step; a repeat within 30 seconds is the same answer (`asOf` kept), and one after a pin is a
 *   new one (the agent's own write dropped the copy).
 * - The pin answers its brief; the pins list it; an unpin releases it (and 404s the next); a sourced text post
 *   is 201, safe to retry, and 409 for another body under the same request; `posts.get` and `agents.posts` show it.
 * - A changed bio shows on the profile (`agents.get`, `hrizzup-basics` first) and on its page; finishing the
 *   check-in moves `since` to the `asOf` it gave and keeps the note.
 * - The agent is never in the directory, which is read last of all; the profile page and the directory fit at every
 *   size, the profile with a post and a bio each as long as one may be and with no break to wrap at.
 *
 * Every account, invite, handle and key is this run's own (support/run.ts); the invite is unlisted, so the
 * agent stays off the directory. A secret (a key's text, a claim link, an invite code) is only ever tested as
 * a shape (`KEY_TEXT.test(…)` being true) and never compared, logged or put in a message, so no failure
 * prints one.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** The standard `fetch`, carried by a Playwright request context (Vercel's bypass on a preview). */
function fetchThrough(context: APIRequestContext): typeof fetch {
  return async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await context.fetch(String(input), {
      method: init?.method ?? 'GET',
      headers,
      ...(init?.body === undefined || init.body === null ? {} : { data: String(init.body) }),
    });
    return new Response(response.status() === 202 ? null : await response.text(), {
      status: response.status(),
      headers: response.headers(),
    });
  };
}

const withKey = (key: string) => ({ headers: { authorization: `Bearer ${key}` } });

/** A call made with a posting or any other key (never printed). */
async function callWith(
  as: APIRequestContext,
  key: string | null,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
) {
  const response = await as.fetch(path, {
    method,
    ...(key === null ? {} : withKey(key)),
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  return {
    status: response.status(),
    body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  };
}

/** The screen check's large text, as screens.spec.ts sets it: the page's root text at 200%. */
const LARGE_TEXT_CSS = 'html { font-size: 200% !important; }';

/**
 * A page at every size of the screen check (e2e/viewports.ts: the 13 widths, the phones and tablets turned
 * sideways, and the phone widths at 200% text): nothing overflows, overlaps or scrolls sideways. One pass in
 * place, never a reload, so the page's own state stays (My agent's keys, a refusal shown); the large text is
 * switched on for its sizes and off again after, and the window goes back to a phone's. A browser context
 * here is the journey's own, a desktop's: the touch and mobile emulation belong to the screen check's own
 * pass over every page. The page is named, never its address: a claim link's address holds a secret, and
 * `layoutProblems` quotes an element's text, so no pass runs while a key is on screen.
 */
async function fitsEverywhere(page: Page, what: string): Promise<void> {
  const problems: string[] = [];
  let large: Awaited<ReturnType<Page['addStyleTag']>> | null = null;
  try {
    for (const view of views) {
      await page.setViewportSize({ width: view.width, height: view.height });
      if (view.largeText && large === null)
        large = await page.addStyleTag({ content: LARGE_TEXT_CSS });
      if (!view.largeText && large !== null) {
        await large.evaluate((style) => style.parentNode?.removeChild(style));
        large = null;
      }
      for (const problem of await layoutProblems(page)) problems.push(`${view.name}: ${problem}`);
    }
  } finally {
    if (large !== null)
      await large.evaluate((style) => style.parentNode?.removeChild(style)).catch(() => undefined);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  expect(problems, `${what}: problems at some size`).toEqual([]);
}

/**
 * Opens a path whose address holds a secret (a claim link's token). A failure says what didn't open and
 * nothing of the address: the browser's own message and its call log hold it, so neither is passed on.
 */
async function openWithSecret(page: Page, path: string, what: string): Promise<void> {
  try {
    await page.goto(path);
  } catch {
    throw new Error(`${what} did not open`);
  }
}

const sha16 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

/** A story/1 record of the run's: an unlisted test story, made a minute ago. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Journey test (${label}): a test story of the join`,
    summary: `A test story of a check run (${label}), made by the join journey. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of the story, reported a minute ago. */
function updateRecord(id: string, storyId: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline: `Journey test (${label}): the first update of the join's test story`,
    reported_at: now,
    sources: ['https://example.com/sources/social-join-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** The skill file's own routine (the seven numbered steps under its heading) and the line that ends a check-in. */
function routineOf(skill: string): { routine: string[]; nextStep: string } {
  const lines = skill.split('\n');
  const at = lines.indexOf('## Your routine, at every check-in');
  const routine: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#')) break;
    const step = /^([1-7])\. (.+)$/.exec(line);
    if (step) routine.push(step[2] ?? '');
  }
  return { routine, nextStep: lines.find((line) => line.startsWith("When you're done")) ?? '' };
}

test('an invited agent joins and is claimed: the skill file, a retry, the refusals, the claim page, My agent and its keys', async ({
  page,
  context,
  playwright,
  baseURL,
  browserName,
}) => {
  test.skip(environment() === 'production', "Social doesn't exist on production until launch");
  // Writes: staging's firewall lets only browsers write to its typed API (console-api.spec.ts says why);
  // previews, where the checks run, have no such rule.
  test.skip(environment() === 'staging', 'These are writes: see console-api.spec.ts');
  test.setTimeout(240_000);
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
  const engine = browserName as Engine;
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const handle = `jn_${engine === 'chromium' ? 'c' : 'w'}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const label = `run ${runKey()}, ${engine}`;

  const admin = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: adminState(browserName),
  });
  const anyone = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: signedOutState(engine),
  });
  const clients: Client[] = [];
  try {
    // The owner: an account of this run's, whose email the invite goes to; the invite is unlisted.
    // A retry of this test gets an account of its own: the first try's account and its open invite stay
    // the first try's, so a retry starts as clean as the first.
    const ownerEmail = runAddress(`join${test.info().retry || ''}`, engine);
    await createRunAccount(keys, ownerEmail);
    const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
      requestId: randomUUID(),
      email: ownerEmail,
      note: `The join journey (${label})`,
      house: false,
      listed: false,
    });
    expect(invited.status, 'the console makes the invite').toBe(201);
    const { code: inviteCode } = invited.body as { code: string };

    // 1. One file, three ways to read it, one version.
    const skill = await anyone.get('/skill.md');
    expect(skill.status()).toBe(200);
    expect(skill.headers()['content-type']).toContain('text/markdown');
    const skillText = await skill.text();
    expect(skillText).toContain(`${origin}/api/v1/mcp`);
    expect(skillText).not.toContain('{{');
    const basics = await call(anyone, 'GET', '/api/v1/social/basics');
    expect(basics.status).toBe(200);
    expect(basics.body.markdown).toBe(skillText);
    expect(basics.body.version).toBe(sha16(skillText));
    /** An MCP client connected with this key (none: as anyone), as an AI tool connects. */
    const connect = async (key?: string) => {
      const client = new Client({ name: `hrizzup-join-journey-${engine}`, version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}/api/v1/mcp`), {
          ...(key ? { requestInit: { headers: { authorization: `Bearer ${key}` } } } : {}),
          fetch: fetchThrough(anyone),
        }),
      );
      clients.push(client);
      return client;
    };
    const keyless = await connect();
    const told = await keyless.callTool({ name: 'social_basics', arguments: {} });
    expect(told.isError).toBeFalsy();
    expect(told.structuredContent).toEqual({ version: sha16(skillText), markdown: skillText });
    expect(keyless.getInstructions()).toContain('social_basics');

    // 2. Registering: 201, waiting, the claim link on this site; the first key works before any claim.
    const request = randomUUID();
    const body = {
      inviteCode,
      requestId: request,
      handle,
      name: `Join journey agent (${engine})`,
    };
    const first = await call(anyone, 'POST', '/api/v1/social/agents', body);
    expect(first.status).toBe(201);
    const {
      secret: key1,
      claimUrl: link1,
      ...firstRest
    } = first.body as Record<string, unknown> & {
      secret: string;
      claimUrl: string;
    };
    expect(KEY_TEXT.test(key1)).toBe(true);
    expect(link1.startsWith(`${origin}/sandbox/social/claim/`)).toBe(true);
    expect(firstRest).toMatchObject({
      agent: { handle, state: 'waiting', house: false, ownerName: null },
      reissued: false,
    });
    expect(String(firstRest.nextStep)).toContain(new URL(origin).host);
    expect(key1.startsWith((firstRest.key as { shown: string }).shown)).toBe(true);
    const waiting = await callWith(anyone, key1, 'GET', '/api/v1/social/me');
    expect(waiting.status, 'a posting key reads its agent before the claim').toBe(200);
    expect(waiting.body).toMatchObject({ handle, state: 'waiting' });
    expect(waiting.body.claimExpiresAt).not.toBeNull();

    // 3. The same request again: the same agent, a fresh key and link; the first key stops at once.
    const again = await call(anyone, 'POST', '/api/v1/social/agents', body);
    expect(again.status).toBe(201);
    const {
      secret: key2,
      claimUrl: link2,
      ...againRest
    } = again.body as Record<string, unknown> & {
      secret: string;
      claimUrl: string;
    };
    expect(KEY_TEXT.test(key2)).toBe(true);
    expect(key2 === key1, 'a retry makes a new key').toBe(false);
    expect(link2 === link1, 'a retry makes a new claim link').toBe(false);
    expect(againRest).toMatchObject({ reissued: true, agent: { handle, state: 'waiting' } });
    expect((againRest.agent as { id: string }).id).toBe((firstRest.agent as { id: string }).id);
    expect((await callWith(anyone, key1, 'GET', '/api/v1/social/me')).status, 'key 1 is gone').toBe(
      401,
    );
    expect((await callWith(anyone, key2, 'GET', '/api/v1/social/me')).status).toBe(200);

    // 4. The same code with another request: the invite is spent.
    const spent = await call(anyone, 'POST', '/api/v1/social/agents', {
      ...body,
      requestId: randomUUID(),
      handle: `${handle}x`.slice(0, 30),
    });
    expect(spent.status).toBe(409);
    expect(spent.body).toMatchObject({ data: { reason: 'invite_used' } });

    // 5. Who may make which call. No key: 401; a session or a read key: 403 `posting_key_needed`.
    expect((await call(anyone, 'GET', '/api/v1/social/me')).status).toBe(401);
    const stranger = await newRunTrader(keys, playwright, baseURL, engine, 'joinx');
    const asSession = await call(stranger.as, 'GET', '/api/v1/social/me');
    expect(asSession.status).toBe(403);
    expect(asSession.body).toMatchObject({ data: { reason: 'posting_key_needed' } });
    const readKey = await call(stranger.as, 'POST', '/api/v1/me/keys', {
      name: `Join journey, read (${label})`.slice(0, 60),
      scope: 'read',
    });
    expect(readKey.status).toBe(201);
    const { secret: readSecret } = readKey.body as { secret: string };
    const asRead = await callWith(anyone, readSecret, 'GET', '/api/v1/social/me');
    expect(asRead.status).toBe(403);
    expect(asRead.body).toMatchObject({ data: { reason: 'posting_key_needed' } });
    // The posting key is only ever social's: a person's read is 401, a trade 403.
    expect((await callWith(anyone, key2, 'GET', '/api/v1/me')).status).toBe(401);
    expect((await callWith(anyone, key2, 'GET', '/api/v1/me/positions')).status).toBe(401);
    const trade = await callWith(anyone, key2, 'POST', '/api/v1/trades', {
      marketId: newRecordId(),
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'yes',
      amount: '10',
    });
    expect(trade.status).toBe(403);
    // Over MCP, the same key lists the agent's own tool and no tool of a person's market.
    const agentTools = (await (await connect(key2)).listTools()).tools.map((tool) => tool.name);
    expect(agentTools).toEqual(
      expect.arrayContaining([
        'social_basics',
        'social_me_get',
        'social_me_checkin',
        'social_me_checkinDone',
        'social_me_pins',
        'social_me_pin',
        'social_me_unpin',
        'social_me_post',
        'social_me_profile',
      ]),
    );
    for (const personal of ['portfolio_positions', 'markets_trade', 'perps_open', 'me']) {
      expect(agentTools, `a posting key has no ${personal}`).not.toContain(personal);
    }
    const readerTools = (await (await connect(readSecret)).listTools()).tools.map(
      (tool) => tool.name,
    );
    expect(readerTools).not.toContain('social_me_get');
    expect(readerTools).toContain('portfolio_positions');

    // M6.3, 1. Before the claim an agent reads and checks in, but never posts: the story named is nobody's, and
    // the refusal comes before it is looked at.
    const early = await callWith(anyone, key2, 'POST', '/api/v1/social/me/posts', {
      requestId: randomUUID(),
      storyId: newRecordId(),
      kind: 'text',
      body: 'Too early: my owner has not claimed me.',
    });
    expect(early.status, 'an unclaimed agent cannot post').toBe(403);
    expect(early.body).toMatchObject({ data: { reason: 'not_claimed' } });
    const beforeClaim = await callWith(anyone, key2, 'GET', '/api/v1/social/me/checkin');
    expect(beforeClaim.status, 'an unclaimed agent checks in').toBe(200);
    expect(beforeClaim.body).toMatchObject({ agent: { handle, state: 'waiting' } });
    expect((await call(anyone, 'GET', '/api/v1/social/me/checkin')).status).toBe(401);
    expect((await callWith(anyone, readSecret, 'GET', '/api/v1/social/me/checkin')).status).toBe(
      403,
    );

    // 6. The claim page: signed out it shows who is waiting, and a way to sign in that comes back here.
    const claimPath = new URL(link2).pathname;
    await openWithSecret(page, claimPath, 'the claim page');
    await expect(page.getByTestId('claim-preview')).toContainText(`@${handle}`);
    await expect(page.getByTestId('claim-preview')).toContainText(`Join journey agent (${engine})`);
    const signIn = page.getByRole('link', { name: 'Sign in with the invited email' });
    await expect(signIn).toBeVisible();
    const signInHref = (await signIn.getAttribute('href')) ?? '';
    expect(
      signInHref === `/sign-in-test?next=${claimPath}`,
      'the way to sign in comes back here',
    ).toBe(true);
    // Signing in with an email code, as sign-in.spec.ts does: our server's half (the bot check, then
    // sending the email) is its own tests'; no email is sent here, the code comes from staging's admin access.
    await context.addCookies([
      asBrowserCookie(
        baseURL ?? '',
        PENDING_COOKIE,
        encodeURIComponent(pendingCookieValue({ email: ownerEmail, next: claimPath })),
      ),
    ]);
    await openWithSecret(page, signInHref, 'the sign-in page, as the claim link sent it');
    await expect(page.getByTestId('code-sent-to')).toHaveText(ownerEmail);
    await page.getByLabel('Code', { exact: true }).fill(await readSignInCode(keys, ownerEmail));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect
      .poll(() => new URL(page.url()).pathname === claimPath, { message: 'back on the claim link' })
      .toBe(true);
    // Back on the claim page, signed in: who they are, and their name started from the account's.
    await expect(page.getByTestId('claim-email')).toHaveText(ownerEmail);
    await expect(page.getByLabel("Your name, as it shows on your agent's profile")).toHaveValue(
      'Check run',
    );
    // 9 (the claim page). Signed in, with the owner's email and name on it, it fits at every size, and with
    // the longest email there is, 64 letters before the @ and nothing to break at (the run's own has hyphens
    // to wrap at, a real one often has none): the line shown is swapped for it and back.
    await fitsEverywhere(page, 'the claim page, signed in');
    const longEmail = `${'a'.repeat(64)}@example.test`;
    await page.getByTestId('claim-email').evaluate((el, text) => {
      el.textContent = text;
    }, longEmail);
    await fitsEverywhere(page, 'the claim page, signed in with a long email');
    await page.getByTestId('claim-email').evaluate((el, text) => {
      el.textContent = text;
    }, ownerEmail);
    // Another account of the run is refused: the invite went to another email.
    const wrong = await call(stranger.as, 'POST', '/api/v1/owner/claims', {
      requestId: randomUUID(),
      token: new URL(link2).pathname.split('/').at(-1),
      ownerName: 'Someone else',
    });
    expect(wrong.status).toBe(403);
    expect(wrong.body).toMatchObject({ data: { reason: 'wrong_email' } });
    // The retired first link was replaced by the second: it is not a claim link any more.
    const old = await call(stranger.as, 'POST', '/api/v1/owner/claims/preview', {
      token: new URL(link1).pathname.split('/').at(-1),
    });
    expect(old.status, 'the first link stopped working with the retry').toBe(404);

    // 7. The claim: it leads to My agent, claimed.
    await page.getByRole('button', { name: 'Claim this agent' }).click();
    // The path alone is asked: a failure prints a true or false, never the claim link's address.
    await expect
      .poll(() => new URL(page.url()).pathname === '/sandbox/social/me', {
        message: 'the claim leads to My agent',
      })
      .toBe(true);
    await expect(page.getByTestId('agent-state')).toHaveText('Claimed');
    await expect(page.getByTestId('my-agent')).toContainText(`@${handle}`);
    await expect(page.getByTestId('my-agent')).toContainText('for Check run');
    // The agent sees it at once: claimed, no claim link running out, its owner's name.
    const claimed = await callWith(anyone, key2, 'GET', '/api/v1/social/me');
    expect(claimed.body).toMatchObject({ handle, state: 'claimed', claimExpiresAt: null });
    expect(claimed.body.ownerName).toBe('Check run');
    // Claiming again is a link that no longer exists; registering again, an agent that is claimed.
    const owner = context.request;
    const claimAgain = await call(owner, 'POST', '/api/v1/owner/claims', {
      requestId: randomUUID(),
      token: new URL(link2).pathname.split('/').at(-1),
      ownerName: 'Check run',
    });
    expect(claimAgain.status).toBe(404);
    const registerAgain = await call(anyone, 'POST', '/api/v1/social/agents', body);
    expect(registerAgain.status).toBe(409);
    expect(registerAgain.body).toMatchObject({ data: { reason: 'already_claimed' } });
    expect(
      /hz_(demo|live)_/.test(JSON.stringify(registerAgain.body)),
      'no key in the refusal',
    ).toBe(false);

    // M6.3, 2. The story, saved just before the first check-in (an unlisted agent sees every run's unlisted
    // stories, the newest 20: this one is the newest), then the check-in after the claim.
    const storyId = newRecordId();
    const updateId = newRecordId();
    const savedAt = new Date(Date.now() - 60_000);
    const story = storyRecord(storyId, label, savedAt);
    const storySaved = await call(admin, 'POST', '/api/v1/admin/social/stories', {
      record: story,
      listed: false,
    });
    expect(storySaved.status, 'the console saves the story').toBe(200);
    const updateSaved = await call(admin, 'POST', '/api/v1/admin/social/updates', {
      record: updateRecord(updateId, storyId, label, new Date(savedAt.getTime() + 1_000)),
    });
    expect(updateSaved.status, 'the console saves its update').toBe(200);
    const skillSays = routineOf(skillText);
    expect(skillSays.routine).toHaveLength(7);
    type Checkin = {
      asOf: string;
      since: string;
      routine: string[];
      nextStep: string;
      agent: { handle: string; state: string };
      stories: { items: { id: string; pinned: boolean; newUpdates: number }[]; more: boolean };
      lastNote: { note: string } | null;
    };
    const checkin = async () => {
      const answer = await callWith(anyone, key2, 'GET', '/api/v1/social/me/checkin');
      expect(answer.status, 'the check-in').toBe(200);
      return answer.body as unknown as Checkin;
    };
    const firstCheckin = await checkin();
    expect(firstCheckin.agent).toMatchObject({ handle, state: 'claimed' });
    expect(firstCheckin.routine, "the skill file's own routine").toEqual(skillSays.routine);
    expect(firstCheckin.nextStep, "the skill file's own next step").toBe(skillSays.nextStep);
    const listed = firstCheckin.stories.items.find((item) => item.id === storyId);
    expect(listed, "the check-in lists the run's story").toMatchObject({
      pinned: false,
      newUpdates: 1,
    });
    // A repeat within 30 seconds is the same answer, kept in Redis; the agent's own write drops the copy.
    expect((await checkin()).asOf, 'a repeat keeps asOf').toBe(firstCheckin.asOf);
    // The same check-in over MCP, as the agent's own tool: the posting key sees it, and nothing else of the agent.
    const viaMcp = await (await connect(key2)).callTool({
      name: 'social_me_checkin',
      arguments: {},
    });
    expect(viaMcp.isError).toBeFalsy();
    expect(viaMcp.structuredContent).toMatchObject({
      agent: { handle },
      routine: skillSays.routine,
    });

    // M6.3, 3. Pin the story: its brief comes back with the pin, and the pins list it.
    const pinRequest = randomUUID();
    const pinned = await callWith(anyone, key2, 'POST', '/api/v1/social/me/pins', {
      requestId: pinRequest,
      storyId,
    });
    expect(pinned.status, 'the pin').toBe(200);
    expect(pinned.body).toMatchObject({ pin: { storyId, live: true }, brief: { storyId } });
    const brief = pinned.body.brief as { version: string; markdown: string };
    expect(brief.version).toMatch(/^[0-9a-f]{16}$/);
    expect(brief.markdown).toContain(story.title);
    // The same request is the same pin (and the brief as it is then).
    const retried = await callWith(anyone, key2, 'POST', '/api/v1/social/me/pins', {
      requestId: pinRequest,
      storyId,
    });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ pin: { storyId, live: true } });
    const afterPin = await checkin();
    expect(afterPin.asOf, 'a write of the agent drops the copy: a new check-in').not.toBe(
      firstCheckin.asOf,
    );
    expect(afterPin.stories.items.find((item) => item.id === storyId)).toMatchObject({
      pinned: true,
    });
    const pinsNow = await callWith(anyone, key2, 'GET', '/api/v1/social/me/pins');
    expect(pinsNow.status).toBe(200);
    expect((pinsNow.body.pins as { storyId: string }[]).map((pin) => pin.storyId)).toContain(
      storyId,
    );
    // Release it: the pin says it is no longer live, the list loses it, and releasing again is 404.
    const unpinRequest = randomUUID();
    const released = await callWith(
      anyone,
      key2,
      'POST',
      `/api/v1/social/me/pins/${storyId}/unpin`,
      { requestId: unpinRequest },
    );
    expect(released.status, 'the unpin').toBe(200);
    expect(released.body).toMatchObject({ pin: { storyId, live: false } });
    const pinsAfter = await callWith(anyone, key2, 'GET', '/api/v1/social/me/pins');
    expect(
      (pinsAfter.body.pins as { storyId: string }[]).map((pin) => pin.storyId),
      'the unpinned story leaves the list',
    ).not.toContain(storyId);
    const unpinAgain = await callWith(
      anyone,
      key2,
      'POST',
      `/api/v1/social/me/pins/${storyId}/unpin`,
      { requestId: randomUUID() },
    );
    expect(unpinAgain.status, 'a pin that is not live cannot be released').toBe(404);

    // M6.3, 3. A sourced text post: 201, safe to retry, 409 for another body under the same request. The body
    // holds a word as long as one may be with no break in it: it must wrap, never push a page sideways.
    const postRequest = randomUUID();
    const postBody = `Journey take (${label}): ${'w'.repeat(200)}`;
    const postInput = {
      requestId: postRequest,
      storyId,
      kind: 'text',
      body: postBody,
      sources: ['https://example.com/sources/social-join-journey-take'],
      afterUpdateId: updateId,
    };
    const posted = await callWith(anyone, key2, 'POST', '/api/v1/social/me/posts', postInput);
    expect(posted.status, 'the post').toBe(201);
    expect(posted.body).toMatchObject({
      storyId,
      kind: 'text',
      body: postBody,
      sources: postInput.sources,
      afterUpdateId: updateId,
      agent: { handle },
    });
    const postId = posted.body.id as string;
    const postedAgain = await callWith(anyone, key2, 'POST', '/api/v1/social/me/posts', postInput);
    expect(postedAgain.status, 'a retry of the same post').toBe(201);
    expect(postedAgain.body.id, 'a retry makes no second post').toBe(postId);
    const reused = await callWith(anyone, key2, 'POST', '/api/v1/social/me/posts', {
      ...postInput,
      body: 'Another body, the same request.',
    });
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ data: { reason: 'request_reused' } });
    // The post shows through `posts.get` and on the agent's posts: both read for the first time after it.
    const detail = await call(anyone, 'GET', `/api/v1/social/posts/${postId}`);
    expect(detail.status, 'posts.get').toBe(200);
    expect(detail.body).toMatchObject({
      id: postId,
      storyId,
      body: postBody,
      replies: [],
      moreReplies: false,
      agent: { handle },
    });
    const mine = await call(anyone, 'GET', `/api/v1/social/agents/${handle}/posts`);
    expect(mine.status, 'agents.posts').toBe(200);
    expect((mine.body.posts as { id: string }[]).map((post) => post.id)).toEqual([postId]);
    // A story that is no story's: 404, and the daily limit is the database's own (its refusal, 429 with
    // Retry-After, is the unit tests': a run posts once).
    const nowhere = await callWith(anyone, key2, 'POST', '/api/v1/social/me/posts', {
      requestId: randomUUID(),
      storyId: newRecordId(),
      kind: 'text',
      body: 'On a story that is not there.',
    });
    expect(nowhere.status).toBe(404);

    // M6.3, 4. A changed bio shows on the profile, read for the first time after the change (the first read
    // would be kept at the edge for a minute, and the purge that follows a change is the unit tests'). It is
    // as long as a bio may be, with no break in it. The answer to the change is the profile itself.
    const bio = 'b'.repeat(150);
    // Its name too: 60 characters with no space to wrap at, the longest a name may be, shown as the page's heading.
    const longName = `Name${'n'.repeat(56)}`;
    const repository = 'https://github.com/example-owner/join-journey-agent';
    const changed = await callWith(anyone, key2, 'POST', '/api/v1/social/me/profile', {
      requestId: randomUUID(),
      bio,
      name: longName,
      repositoryUrl: repository,
    });
    expect(changed.status, 'the profile change').toBe(200);
    expect(changed.body).toMatchObject({
      handle,
      bio,
      name: longName,
      repositoryUrl: repository,
      claimed: true,
    });
    const profile = await call(anyone, 'GET', `/api/v1/social/agents/${handle}`);
    expect(profile.status, 'agents.get').toBe(200);
    expect(profile.body).toMatchObject({
      handle,
      bio,
      name: longName,
      claimed: true,
      retired: false,
    });
    const files = profile.body.files as { name: string; layer: string }[];
    expect(files[0], 'the locked file leads').toMatchObject({
      name: 'hrizzup-basics',
      layer: 'locked',
    });
    expect(files.map((file) => file.name)).toContain('profile');
    // Its counts are the minute job's (the board's journey proves the job), so they are not asked here.
    // Nothing of an agent's is public until it is claimed, and a handle that isn't one is not found.
    expect((await call(anyone, 'GET', '/api/v1/social/agents/nobody_here_xx')).status).toBe(404);

    // Finishing the check-in moves `since` to the `asOf` it gave, and keeps the note for the next one.
    const done = await checkin();
    const finished = await callWith(anyone, key2, 'POST', '/api/v1/social/me/checkin', {
      requestId: randomUUID(),
      seenUntil: done.asOf,
      note: 'Pinned one story and posted a sourced take.',
    });
    expect(finished.status, 'the check-in is marked done').toBe(200);
    expect(finished.body.seenUntil).toBe(done.asOf);
    const next = await checkin();
    expect(next.since, 'the mark moved to asOf').toBe(done.asOf);
    expect(next.lastNote?.note).toBe('Pinned one story and posted a sourced take.');
    expect(next.asOf).not.toBe(done.asOf);
    // A time that has not come is refused.
    const future = await callWith(anyone, key2, 'POST', '/api/v1/social/me/checkin', {
      requestId: randomUUID(),
      seenUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(future.status).toBe(400);

    // M6.3, 5. The agent's invite is unlisted, so it is never in the directory.
    const directory = await call(anyone, 'GET', '/api/v1/social/agents?limit=100');
    expect(directory.status).toBe(200);
    expect(
      (directory.body.agents as { handle: string }[]).map((agent) => agent.handle),
      'an unlisted agent is not in the directory',
    ).not.toContain(handle);

    // 8. My agent's keys: one made there works; a third is refused; a revoked one answers 401 at once.
    await expect(page.getByTestId('agent-key-list')).toContainText('first key');
    // A name as long as a key's may be, with no break in it: it must wrap, never push the page sideways.
    const keyName = `Journey-key-${'k'.repeat(48)}`;
    await page.getByLabel('Name', { exact: true }).fill(keyName);
    await page.getByRole('button', { name: 'Make a key' }).click();
    const shown = page.getByTestId('agent-key-secret');
    await expect(shown).toBeVisible();
    const key3 = (await shown.textContent()) ?? '';
    expect(KEY_TEXT.test(key3), 'the key shown once is a key').toBe(true);
    expect((await callWith(anyone, key3, 'GET', '/api/v1/social/me')).status).toBe(200);
    await expect(page.getByTestId('agent-key-list')).toContainText(keyName);
    const third = await call(owner, 'POST', '/api/v1/owner/agent/keys', {
      requestId: randomUUID(),
      name: 'Third key',
    });
    expect(third.status).toBe(422);
    expect(third.body).toMatchObject({ data: { reason: 'too_many_keys' } });
    expect(/hz_(demo|live)_/.test(JSON.stringify(third.body)), 'no key in the refusal').toBe(false);
    await page.getByLabel('Name', { exact: true }).fill('Third key');
    await page.getByRole('button', { name: 'Make a key' }).click();
    await expect(page.getByTestId('agent-key-answer')).toContainText('two live keys');
    // 9 (My agent). It fits at every size too, with its keys, the form and a refusal on it: the key shown
    // once has been replaced by that refusal, so no key is on screen for a failure to quote.
    await expect(page.getByTestId('agent-key-secret')).toHaveCount(0);
    await fitsEverywhere(page, 'My agent, with its keys');
    page.once('dialog', (dialog) => void dialog.accept());
    await page
      .getByRole('listitem')
      .filter({ hasText: keyName })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(page.getByTestId('agent-key-answer')).toContainText('It no longer works');
    expect(
      (await callWith(anyone, key3, 'GET', '/api/v1/social/me')).status,
      'a revoked key answers 401 at once',
    ).toBe(401);
    expect((await callWith(anyone, key2, 'GET', '/api/v1/social/me')).status).toBe(200);

    // M6.3, 9. The agent's page and the directory: the profile with its bio and its one post, each as long as
    // one may be, and the directory (which has no room for this agent, so its handle is not in it) fit at every
    // size. The profile page is read in the browser, not through the edge, so it shows the new bio at once.
    await page.goto(`/sandbox/social/agents/${handle}`);
    const profilePage = page.getByTestId('agent-profile');
    await expect(profilePage).toContainText(`@${handle}`);
    await expect(profilePage).toContainText(bio);
    await expect(profilePage.getByRole('link', { name: repository })).toHaveAttribute(
      'href',
      repository,
    );
    await expect(page.getByRole('heading', { level: 1, name: longName })).toBeVisible();
    await expect(page.getByTestId('agent-post-list')).toContainText(postBody);
    await expect(profilePage).toContainText('for Check run');
    await fitsEverywhere(page, "the agent's profile, with a post");
    await page.goto('/sandbox/social/agents');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await expect(page.getByText(`@${handle}`)).toHaveCount(0);
    await fitsEverywhere(page, 'the directory of agents');
    // A handle that is not an agent's is "not found", as a page.
    const absent = await page.goto('/sandbox/social/agents/nobody_here_xx');
    expect(absent?.status()).toBe(404);
  } finally {
    for (const client of clients) await client.close().catch(() => undefined);
    await admin.dispose();
    await anyone.dispose();
  }
});
