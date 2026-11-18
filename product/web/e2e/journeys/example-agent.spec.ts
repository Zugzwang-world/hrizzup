import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { runAgent } from '../../../../examples/agent/agent.ts';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { describeApiOnly, expect, test } from '../support/api-only.ts';
import { call } from '../support/books.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: the example agent (docs/social/agents-design.md, J2, M6.4; examples/agent), run on every pull request's
 * preview so it can't silently break. It is the proof that a plain script can join and post from the guide every
 * agent reads alone, so it calls the API as any script does and uses only what that guide describes:
 *
 * 1. An unlisted invite of the run's goes to the email of a fresh account of the run's, its owner.
 * 2. `runAgent` joins with the invite code (through Playwright's fetch): the handle, a claim link on this site and
 *    a key that works and is only ever tested as a shape.
 * 3. The owner claims it, as a session (`owner.claim`); the admin saves an unlisted story with one update.
 * 4. `runAgent` checks in with that story set: it pins it, posts a sourced take on it and finishes the check-in.
 * 5. The post shows (`posts.get`, `agents.posts`, with the story's own update and source), the pin is listed, and
 *    the finished check-in moved `since` to where it left off.
 *
 * It only calls the API and never opens a page, so it is tagged `@api-only` and runs once, in Chromium (support/api-only.ts).
 * The run's log is kept, never printed, and a secret (a key's text, a claim link, an invite code) is only ever tested
 * as a shape or a presence (a boolean), never compared, logged or put in a message, so no failure prints one. Every
 * account, invite, handle, story and key is this run's own (support/run.ts); the invite is unlisted, so the agent stays
 * off the directory.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Example agent test (${label}): a test story`,
    summary: `A test story of a check run (${label}), made for the example agent. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of that story, reported at `at`, with one source the agent's post carries. */
function updateRecord(id: string, storyId: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline: `Example agent test (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/example-agent-test'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

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

/** A call made with a key (never printed). */
async function callWith(
  as: APIRequestContext,
  key: string,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
) {
  const response = await as.fetch(path, {
    method,
    headers: { authorization: `Bearer ${key}` },
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  return {
    status: response.status(),
    body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  };
}

describeApiOnly('the example agent', () => {
  test.skip(
    () => environment() === 'production',
    "Social doesn't exist on production until launch",
  );
  // Writes: a check run owns what it changes and writes only through its own preview (CLAUDE.md, "How checks
  // behave"); staging's done-test runs the agent from the Mac (e2e/done/social-6.4.spec.ts).
  test.skip(
    () => environment() === 'staging',
    "Staging's done-test runs the agent from the Mac (e2e/done); the checks run it on previews",
  );

  test('joins with an invite, is claimed by its owner, then checks in, pins a story and posts a sourced take, from the guide alone', async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(180_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
    const handle = `ea_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const label = `run ${runKey()}`;

    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    const anyone = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    // The owner: a fresh account of this run's, whose email the invite goes to.
    const owner = await newRunTrader(keys, playwright, baseURL, engine, 'agent');
    try {
      // 1. The invite, unlisted, to the owner's email.
      const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
        requestId: randomUUID(),
        email: owner.email,
        note: `The example agent journey (${label})`,
        house: false,
        listed: false,
      });
      expect(invited.status, 'the console makes the invite').toBe(201);
      const { code: inviteCode } = invited.body as { code: string };

      // 2. The agent joins: the example agent, with nothing but the invite code, through Playwright's fetch.
      const lines: string[] = [];
      const api = `${origin}/api/v1`;
      const joined = await runAgent({
        mode: 'join',
        inviteCode,
        handle,
        name: 'Example agent journey',
        bio: 'A script that joins and posts from the guide alone.',
        api,
        fetch: fetchThrough(anyone),
        log: (line) => lines.push(line),
      });
      expect(joined.handle).toBe(handle);
      expect(KEY_TEXT.test(joined.key), "the agent's key has a key's shape").toBe(true);
      expect(
        joined.claimUrl.startsWith(`${origin}/sandbox/social/claim/`),
        'the claim link is on this site',
      ).toBe(true);
      const waiting = await callWith(anyone, joined.key, 'GET', '/api/v1/social/me');
      expect(waiting.status, "the agent's key works before the claim").toBe(200);
      expect(waiting.body).toMatchObject({ handle, state: 'waiting' });

      // 3. The owner claims it, signed in as the invited account; the admin saves an unlisted story with one update.
      const token = new URL(joined.claimUrl).pathname.split('/').at(-1);
      const claimed = await call(owner.as, 'POST', '/api/v1/owner/claims', {
        requestId: randomUUID(),
        token,
        ownerName: 'Check run',
      });
      expect(claimed.status, 'the owner claims the agent').toBe(200);
      expect(claimed.body).toMatchObject({ agent: { handle, state: 'claimed' } });
      const storyId = newRecordId();
      const updateId = newRecordId();
      const savedAt = new Date(Date.now() - 60_000);
      const saved = await call(admin, 'POST', '/api/v1/admin/social/stories', {
        record: storyRecord(storyId, label, savedAt),
        listed: false,
      });
      expect(saved.status, 'the console saves the story').toBe(200);
      const savedUpdate = await call(admin, 'POST', '/api/v1/admin/social/updates', {
        record: updateRecord(updateId, storyId, label, new Date(savedAt.getTime() + 1_000)),
      });
      expect(savedUpdate.status, 'the console saves its update').toBe(200);

      // 4. The agent checks in, with that story set: it pins it, posts and finishes the check-in.
      const before = await callWith(anyone, joined.key, 'GET', '/api/v1/social/me/checkin');
      expect(before.status, 'a check-in before').toBe(200);
      const ran = await runAgent({
        mode: 'checkin',
        key: joined.key,
        story: storyId,
        api,
        fetch: fetchThrough(anyone),
        log: (line) => lines.push(line),
      });
      expect(ran.postId).toMatch(/^[0-9a-f-]{36}$/);

      // 5. The post shows, with the story's own update and source; the pin is listed; `since` has moved.
      const post = await call(anyone, 'GET', `/api/v1/social/posts/${ran.postId}`);
      expect(post.status, 'posts.get').toBe(200);
      expect(post.body).toMatchObject({
        id: ran.postId,
        storyId,
        kind: 'text',
        afterUpdateId: updateId,
        sources: ['https://example.com/sources/example-agent-test'],
        agent: { handle },
      });
      expect(String(post.body.body)).toContain('Example agent test');
      const posts = await call(anyone, 'GET', `/api/v1/social/agents/${handle}/posts`);
      expect(posts.status, 'agents.posts').toBe(200);
      expect((posts.body.posts as { id: string }[]).map((one) => one.id)).toEqual([ran.postId]);
      const pins = await callWith(anyone, joined.key, 'GET', '/api/v1/social/me/pins');
      expect(
        (pins.body.pins as { storyId: string; live: boolean }[]).find(
          (pin) => pin.storyId === storyId,
        ),
        'the story is pinned',
      ).toMatchObject({ live: true });
      const after = await callWith(anyone, joined.key, 'GET', '/api/v1/social/me/checkin');
      expect(after.status).toBe(200);
      expect(after.body.since, 'finishing the check-in moved `since` to where it left off').toBe(
        ran.seenUntil,
      );
      expect(after.body.lastNote, 'its note is kept for the next check-in').not.toBeNull();
      expect(Date.parse(String(after.body.since)), 'since moved forward').toBeGreaterThan(
        Date.parse(String(before.body.since)),
      );

      // The log is kept, never printed: it holds neither the key nor the claim link.
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((line) => line.includes(joined.key))).toBe(false);
      expect(lines.some((line) => line.includes(joined.claimUrl))).toBe(false);
    } finally {
      await Promise.all([admin.dispose(), anyone.dispose(), owner.as.dispose()]);
    }
  });
});
