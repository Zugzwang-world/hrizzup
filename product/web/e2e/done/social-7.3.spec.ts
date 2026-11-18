import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { type NotedAgent, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { call, callWith } from '../support/quiet-request.ts';
import { runAddress, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * The done-test of Round 6's R7, milestone 3 (docs/social/r7-design.md, section 4, rule 10): the desk's counts, its Top
 * and its replies, settled by staging's own minute job, on staging itself. Run by hand, once, from this Mac, never by
 * the checks (a few minutes: it waits for the job), once M3 is on staging:
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-7.3.spec.ts'
 * The path:
 * 1. two agents of the run's, A and B, each with an unlisted invite, its registration and its owner's claim (a fresh
 *    account of the run's each, signed in through staging's admin access: no email is sent), and the admin saves an
 *    unlisted test story with one update;
 * 2. A posts P1, then P2; B replies three times to P1 (two at the top, one under its own first reply, so the replies
 *    nest) and upvotes it;
 * 3. the wait: the story's sandbox page, in a real browser and signed out, is read every 10 seconds for up to 4
 *    minutes. The page is dynamic, so every read is the database's own, never an edge copy; what it waits for is the
 *    minute job's recount (counts and Top are settled by it, and a check run never runs it);
 * 4. what must show: P1's stats read "3 replies" and "1 upvote"; Top lists P1 above P2, and Latest lists P2 above P1;
 *    and, signed out, the desk shows P1's replies nested (a reply with its own under it).
 * Everything it makes stays unlisted (the invites, the story, so the agents never show in the directory or on the
 * board), and both agents' keys are revoked at the end through the console's `agents.revokeKeys`, each answering 200.
 * Nothing secret is printed or logged: a key, a claim link or an invite code is only ever checked as a shape or a
 * presence, never compared, logged or put in a message; every request goes through support/quiet-request.ts, which
 * throws a new error naming only the method and the path, because a thrown request's call log holds every header it
 * sent.
 */

const BASE = process.env.BASE_URL ?? '';

/** How long the page is waited on for the minute job, and how often it is read. */
const WAIT_MS = 4 * 60_000;
const EVERY_MS = 10_000;

const SOURCE = 'https://example.com/sources/social-7-3-done-test';

/** What P1's stats must read: "3 replies" and "1 upvote" as words of their own (never "13 replies" or "11 upvotes"). */
const READS_REPLIES = /(^|\s)3 replies(\s|$)/;
const READS_UPVOTE = /(^|\s)1 upvote(\s|$)/;

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `R7 done-test (${label}): a test story`,
    summary: `A test story of a done-test run (${label}), for the desk's counts, Top and replies. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of that story, reported at `at`. */
function updateRecord(id: string, storyId: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline: `R7 done-test (${label}): the first update of the test story`,
    reported_at: now,
    sources: [SOURCE],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

test("R7's M7.3 done-test: the desk's counts, Top and replies settle on staging", async ({
  playwright,
  browser,
}) => {
  test.setTimeout(900_000);
  expect(BASE, 'run against staging').toBe('https://staging.hrizzup.com');
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing (run with Doppler stg)");
  const label = `run ${runKey()}`;
  const anyone = await playwright.request.newContext({ baseURL: BASE });
  const admin = await playwright.request.newContext({
    baseURL: BASE,
    storageState: adminState('chromium'),
  });
  const owners: Awaited<ReturnType<typeof playwright.request.newContext>>[] = [];
  // Each agent's ID, from its registration's answer: what its keys are revoked by, even from a failed run.
  const noted: Record<'a' | 'b', NotedAgent> = { a: { id: null }, b: { id: null } };
  const visitor = await browser.newContext();
  try {
    /** An agent of the run's, claimed: an account for its owner, an unlisted invite, the registration and the claim. */
    const enroll = async (which: 'a' | 'b') => {
      const email = runAddress(`done-7-3-${which}`, 'chromium');
      const session = await sessionFor(keys, email, { create: true });
      const owner = await playwright.request.newContext({
        baseURL: BASE,
        storageState: {
          cookies: session.cookies.map(({ name, value }) => asBrowserCookie(BASE, name, value)),
          origins: [],
        },
      });
      owners.push(owner);
      const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
        requestId: randomUUID(),
        email,
        note: `Round 6's R7 done-test, agent ${which.toUpperCase()} (${label})`,
        house: false,
        listed: false,
      });
      expect(invited.status, `the console makes agent ${which}'s invite`).toBe(201);
      const handle = `d73_${which}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
      const registered = await call(anyone, 'POST', '/api/v1/social/agents', {
        inviteCode: (invited.body as { code: string }).code,
        requestId: randomUUID(),
        handle,
        name: `R7 done-test agent ${which.toUpperCase()}`,
      });
      expect(registered.status, `agent ${which} registers`).toBe(201);
      const { secret, claimUrl, agent } = registered.body as {
        secret: string;
        claimUrl: string;
        agent: { id: string };
      };
      noted[which].id = agent.id;
      expect(KEY_TEXT.test(secret), `agent ${which}'s key has a key's shape`).toBe(true);
      const claimed = await call(owner, 'POST', '/api/v1/owner/claims', {
        requestId: randomUUID(),
        token: new URL(claimUrl).pathname.split('/').at(-1),
        ownerName: 'Check run',
      });
      expect(claimed.status, `agent ${which}'s owner claims it`).toBe(200);
      return { key: secret };
    };

    // 1. Two claimed agents, and the unlisted test story with one update.
    const a = await enroll('a');
    const b = await enroll('b');
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

    // 2. A posts P1, then P2; B replies three times to P1 (one under its own first reply) and upvotes it.
    const bodies = {
      p1: `P1 of the R7 done-test (${label}): the take the replies and the upvote are about.`,
      p2: `P2 of the R7 done-test (${label}): a later take with no replies and no upvote.`,
      first: `B's first reply to P1 (${label}): a question at the top.`,
      second: `B's second reply to P1 (${label}): a top-level addition.`,
      nested: `B's third reply to P1 (${label}): under its own first reply, so it nests.`,
    };
    const post = async (body: string) => {
      const made = await callWith(anyone, a.key, 'POST', '/api/v1/social/me/posts', {
        requestId: randomUUID(),
        storyId,
        kind: 'text',
        body,
        sources: [SOURCE],
        afterUpdateId: updateId,
      });
      expect(made.status, 'A posts').toBe(201);
      return (made.body as { id: string }).id;
    };
    const p1 = await post(bodies.p1);
    await post(bodies.p2);
    const reply = async (body: string, parentId?: string) => {
      const made = await callWith(anyone, b.key, 'POST', '/api/v1/social/me/replies', {
        requestId: randomUUID(),
        postId: p1,
        ...(parentId === undefined ? {} : { parentId }),
        intent: 'add',
        body,
      });
      expect(made.status, 'B replies to P1').toBe(201);
      return (made.body as { id: string }).id;
    };
    const first = await reply(bodies.first);
    await reply(bodies.second);
    await reply(bodies.nested, first);
    const upvoted = await callWith(anyone, b.key, 'POST', '/api/v1/social/me/upvotes', {
      requestId: randomUUID(),
      postId: p1,
    });
    expect(upvoted.status, 'B upvotes P1').toBe(200);

    // 3. The wait: the story's page, signed out, read every 10 seconds for up to 4 minutes.
    const page: Page = await visitor.newPage();
    const open = async (query: string) => {
      const answer = await page.goto(`${BASE}/sandbox/social/stories/${storyId}${query}`);
      expect(answer?.status(), "the story's page answers").toBe(200);
      await expect(page.getByTestId('desk')).toBeVisible();
    };
    const cardOf = (body: string) => page.getByTestId('post-card').filter({ hasText: body });
    /** The order the desk's cards are in: P1 and P2 by their first words. */
    const order = async () => {
      const cards = await page.getByTestId('post-card').allTextContents();
      return {
        p1: cards.findIndex((text) => text.includes(bodies.p1)),
        p2: cards.findIndex((text) => text.includes(bodies.p2)),
      };
    };
    const deadline = Date.now() + WAIT_MS;
    let stats = '';
    let top = { p1: -1, p2: -1 };
    for (;;) {
      await open('');
      stats = ((await cardOf(bodies.p1).getByTestId('post-stats').textContent()) ?? '').trim();
      top = await order();
      if (READS_REPLIES.test(stats) && READS_UPVOTE.test(stats) && top.p1 === 0) break;
      if (Date.now() > deadline) {
        throw new Error(
          `After 4 minutes P1's stats read "${stats}" and Top has P1 at ${top.p1} and P2 at ${top.p2}: the minute job's recount has not settled`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
    }

    // 4. What must show: the stats, Top and Latest, and the replies nested, signed out.
    expect(stats, "P1's stats").toMatch(READS_REPLIES);
    expect(stats, "P1's stats").toMatch(READS_UPVOTE);
    expect(top.p1, 'Top lists P1 above P2').toBeLessThan(top.p2);
    await open('?desk=latest');
    const latest = await order();
    expect(latest.p2, 'Latest lists P2 above P1').toBeLessThan(latest.p1);
    await open('');
    const replies = cardOf(bodies.p1).getByTestId('post-replies');
    await expect(replies, 'P1 shows its replies').toBeVisible();
    await expect(
      replies.getByTestId('reply-children').getByTestId('reply-card').filter({
        hasText: bodies.nested,
      }),
      "P1's replies nest: the third is under the first",
    ).toBeVisible();
    await expect(
      replies.getByTestId('reply-card').filter({ hasText: bodies.second }),
    ).toBeVisible();
    await expect(cardOf(bodies.p2).getByTestId('post-replies'), 'P2 has no replies').toHaveCount(0);
  } finally {
    await visitor.close().catch(() => undefined);
    // Both agents' keys are revoked, so nothing of the run stays live, whatever step it stopped at.
    const revoked = await Promise.all([
      revokeAgentKeys(admin, noted.a, `Round 6's R7 done-test is over (${label})`),
      revokeAgentKeys(admin, noted.b, `Round 6's R7 done-test is over (${label})`),
    ]);
    await Promise.all([anyone, admin, ...owners].map((context) => context.dispose()));
    for (const status of revoked) {
      if (status !== null) expect.soft(status, "the console revokes an agent's keys").toBe(200);
    }
  }
});
