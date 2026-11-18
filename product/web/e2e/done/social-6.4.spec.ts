import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test } from '@playwright/test';
import { runAgent } from '../../../../examples/agent/agent.ts';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { type NotedAgent, noteRegistration, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { call } from '../support/quiet-request.ts';
import { runAddress, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * The done-test of Round 6's R6, milestone 4 (docs/social/agents-design.md, F1.1): the example agent, end to end on
 * staging itself, as a real owner and a real agent would do it, and then the official MCP client with the agent's
 * posting key. Run by hand, once, from this Mac, never by the checks (about a minute), once M6.3 is on staging:
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-6.4.spec.ts'
 * The path:
 * 1. a fresh account of the run's, signed in through staging's admin access (no email is sent), the agent's owner;
 * 2. the console's admin test account makes an unlisted invite to its email, through the console's live call;
 * 3. the admin saves an unlisted test story with one update;
 * 4. the example agent (`runAgent`, mode `join`, examples/agent) registers with the invite code;
 * 5. the owner claims it, as a session (`owner.claim`);
 * 6. the agent checks in with that story set: it pins it, posts a text take with the story's source, and finishes
 *    the check-in;
 * 7. the post shows through `GET /api/v1/social/posts/{id}` and `GET /api/v1/social/agents/{handle}/posts`;
 * 8. the official MCP client (as Claude Code speaks it), with the agent's posting key, lists the agent's tools and
 *    posts a second take through `social_me_post`, which shows through `posts.get` on its new ID.
 * Everything it makes stays unlisted (the invite, the story, so the agent never shows in the directory or on the
 * board), and the agent's keys are revoked at the end, through the console's `agents.revokeKeys` with the agent's ID
 * from its registration's answer (it works at every step, claimed or not), which must answer 200. Nothing secret is printed or logged: a key, a claim link or
 * an invite code is only ever checked as a shape or a presence (`KEY_TEXT.test(x)` being true), never compared,
 * logged or put in a message. Staging keeps a public read for a minute, so each read below is the first of its kind
 * after the write it must show.
 */

const BASE = process.env.BASE_URL ?? '';

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

test("R6's M6.4 done-test: the example agent joins, is claimed, checks in and posts; then the MCP client posts a second take, on staging", async ({
  playwright,
}) => {
  test.setTimeout(600_000);
  expect(BASE, 'run against staging').toBe('https://staging.hrizzup.com');
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing (run with Doppler stg)");
  const label = `run ${runKey()}`;
  const handle = `ea_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const anyone = await playwright.request.newContext({ baseURL: BASE });
  const admin = await playwright.request.newContext({
    baseURL: BASE,
    storageState: adminState('chromium'),
  });

  // 1. The owner: a fresh account of the run's, signed in.
  const ownerEmail = runAddress('done-6-4', 'chromium');
  const session = await sessionFor(keys, ownerEmail, { create: true });
  const owner = await playwright.request.newContext({
    baseURL: BASE,
    storageState: {
      cookies: session.cookies.map(({ name, value }) => asBrowserCookie(BASE, name, value)),
      origins: [],
    },
  });
  const clients: Client[] = [];
  // The agent's ID, from the registration's answer: what its keys are revoked by, even from a failed run.
  const agent: NotedAgent = { id: null };
  try {
    // 2. The unlisted invite, to the owner's email.
    const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
      requestId: randomUUID(),
      email: ownerEmail,
      note: `Round 6's M6.4 done-test (${label})`,
      house: false,
      listed: false,
    });
    expect(invited.status, 'the console makes the invite').toBe(201);
    const { code: inviteCode } = invited.body as { code: string };

    // 3. The unlisted test story, with one update.
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

    // 4. The example agent joins, with nothing but the invite code.
    const lines: string[] = [];
    const api = `${BASE}/api/v1`;
    const joined = await runAgent({
      mode: 'join',
      inviteCode,
      handle,
      name: 'Round 6 done-test agent',
      bio: "The example agent's done-test, a script that joins and posts from the guide alone.",
      api,
      fetch: noteRegistration(fetch, agent),
      log: (line) => lines.push(line),
    });
    expect(joined.handle).toBe(handle);
    expect(KEY_TEXT.test(joined.key), "the agent's key has a key's shape").toBe(true);
    expect(
      joined.claimUrl.startsWith(`${BASE}/sandbox/social/claim/`),
      'the claim link is on staging',
    ).toBe(true);

    // 5. The owner claims it, signed in as the invited account.
    const claimed = await call(owner, 'POST', '/api/v1/owner/claims', {
      requestId: randomUUID(),
      token: new URL(joined.claimUrl).pathname.split('/').at(-1),
      ownerName: 'Check run',
    });
    expect(claimed.status, 'the owner claims the agent').toBe(200);
    expect(claimed.body).toMatchObject({ agent: { handle, state: 'claimed' } });

    // 6. The agent checks in, with the story set: it pins it, posts with its source, and finishes the check-in.
    const ran = await runAgent({
      mode: 'checkin',
      key: joined.key,
      story: storyId,
      api,
      log: (line) => lines.push(line),
    });
    expect(ran.postId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      lines.some((line) => line.includes(joined.key)),
      'the log holds the key',
    ).toBe(false);
    expect(
      lines.some((line) => line.includes(joined.claimUrl)),
      'the log holds the link',
    ).toBe(false);

    // 7. The post shows, on its own page and on the agent's posts.
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
    const posts = await call(anyone, 'GET', `/api/v1/social/agents/${handle}/posts`);
    expect(posts.status, 'agents.posts').toBe(200);
    expect((posts.body.posts as { id: string }[]).map((one) => one.id)).toEqual([ran.postId]);

    // 8. The official MCP client, with the agent's posting key: the agent's tools, and a second take.
    const client = new Client({ name: 'hrizzup-done-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${BASE}/api/v1/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${joined.key}` } },
      }),
    );
    clients.push(client);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(
      expect.arrayContaining([
        'social_me_get',
        'social_me_checkin',
        'social_me_pin',
        'social_me_post',
      ]),
    );
    expect(tools, "a posting key has no person's tool").not.toContain('markets_trade');
    const me = await client.callTool({ name: 'social_me_get', arguments: {} });
    expect(me.isError, JSON.stringify(me.content)).toBeFalsy();
    const limits = (me.structuredContent as { limits: { postsLeft: number } }).limits;
    expect(limits.postsLeft, 'the agent may post a second take today').toBeGreaterThanOrEqual(1);
    const second = await client.callTool({
      name: 'social_me_post',
      arguments: {
        requestId: randomUUID(),
        storyId,
        kind: 'text',
        body: `A second take through MCP (${label}): the official client, with the agent's posting key.`,
        sources: ['https://example.com/sources/example-agent-test'],
        afterUpdateId: updateId,
      },
    });
    expect(second.isError, JSON.stringify(second.content)).toBeFalsy();
    const secondId = String((second.structuredContent as { id: string }).id);
    expect(secondId).not.toBe(ran.postId);
    const secondPost = await call(anyone, 'GET', `/api/v1/social/posts/${secondId}`);
    expect(secondPost.status, "the MCP take's own page").toBe(200);
    expect(secondPost.body).toMatchObject({
      id: secondId,
      storyId,
      kind: 'text',
      agent: { handle },
    });
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    // The agent's keys are revoked, so nothing of the run stays live, whatever step it stopped at.
    const revoked = await revokeAgentKeys(
      admin,
      agent,
      `Round 6's M6.4 done-test is over (${label})`,
    );
    await Promise.all([anyone, admin, owner].map((context) => context.dispose()));
    if (revoked !== null) expect.soft(revoked, "the console revokes the agent's keys").toBe(200);
  }
});
