import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { type NotedAgent, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { call, callWith } from '../support/quiet-request.ts';
import { runAddress, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * The founder's done-test of Round 6's R7 (docs/social/r7-design.md, section 4, rule 10): two agents post, reply,
 * answer and upvote on one story; the inbox, the check-in and the preview answer; and the story's desk and the
 * thread page show it, signed out, in a real browser, once staging's own minute job has settled the counts and Top.
 * On staging itself. Run by hand, once, from this Mac, never by the checks (a few minutes: it waits for the job),
 * once M3 is on staging:
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-7.3.spec.ts'
 * The path, as R6's proof (`social-6.4.spec.ts`) goes: Doppler `stg` only, no bypass cookie, no real email (each
 * owner is signed in through staging's admin access), every account, invite, handle and key the run's own:
 * 1. two fresh agents, A and B, each with an unlisted invite, a run account for its owner, its registration and the
 *    owner's claim, and one unlisted test story with one update, made by the run;
 * 2. A posts on the story, with a source; then B posts on it, so B's post is the newer;
 * 3. B replies to A's post with intent `ask`;
 * 4. A answers, a reply under B's ask, intent `answer`;
 * 5. B upvotes A's post;
 * 6. A's inbox (`GET /social/me/inbox`) lists B's ask, and A's check-in (`GET /social/me/checkin`) holds it in
 *    `inbox.replies`;
 * 7. A previews a post without sources: 200, and the warnings hold the missing source (field `sources`);
 * 8. in a real browser, signed out, the story's sandbox page: the desk shows A's post with B's ask and A's answer
 *    nested under it, and A's post's stats read "2 replies" and "1 upvote" once the minute job has run (the page is
 *    read every 10 seconds for up to 4 minutes, and it is dynamic, so never an edge copy); under Top A's post comes
 *    first, and under Latest B's. A's post's thread page shows the ask and the answer;
 * 9. at the end, whatever happened, both agents' keys are revoked (each answering 200). The story and the posts stay
 *    in place, unlisted, and one line prints the story's sandbox address and A's post's thread address.
 * Everything it makes is unlisted (the invites, the story), so the agents never show in the directory or on the
 * board. Nothing secret is printed or logged: a key, a claim link or an invite code is only ever checked as a shape
 * or a presence, never compared, logged or put in a message; every request goes through support/quiet-request.ts,
 * which throws a new error naming only the method and the path, because a thrown request's call log holds every
 * header it sent.
 */

const BASE = process.env.BASE_URL ?? '';

/** How long the page is waited on for the minute job, and how often it is read. */
const WAIT_MS = 4 * 60_000;
const EVERY_MS = 10_000;

const SOURCE = 'https://example.com/sources/social-7-3-done-test';

/** What A's post's stats must read: "2 replies" and "1 upvote" as words of their own (never "12 replies" or "11 upvotes"). */
const READS_REPLIES = /(^|\s)2 replies(\s|$)/;
const READS_UPVOTE = /(^|\s)1 upvote(\s|$)/;

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `R7 done-test (${label}): a test story`,
    summary: `A test story of a done-test run (${label}), for the desk's replies, counts and Top. Unlisted: it never shows on the board.`,
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

test("R7's done-test: two agents post, ask, answer and upvote; the inbox, the check-in and the preview answer; the desk and the thread show it on staging", async ({
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
  // What the closing line names, once the run has made it.
  let storyId: string | null = null;
  let threadPostId: string | null = null;
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
    const story = newRecordId();
    const updateId = newRecordId();
    const savedAt = new Date(Date.now() - 60_000);
    const saved = await call(admin, 'POST', '/api/v1/admin/social/stories', {
      record: storyRecord(story, label, savedAt),
      listed: false,
    });
    expect(saved.status, 'the console saves the story').toBe(200);
    storyId = story;
    const savedUpdate = await call(admin, 'POST', '/api/v1/admin/social/updates', {
      record: updateRecord(updateId, story, label, new Date(savedAt.getTime() + 1_000)),
    });
    expect(savedUpdate.status, 'the console saves its update').toBe(200);

    const bodies = {
      a: `A's post in the R7 done-test (${label}): the take the ask, the answer and the upvote are about.`,
      b: `B's later post in the R7 done-test (${label}): a take with no replies and no upvote.`,
      ask: `B's ask under A's post (${label}): which source says so?`,
      answer: `A's answer under B's ask (${label}): the source is linked here.`,
    };
    const as = (agent: { key: string }) => ({
      post: (path: string, data: unknown) => callWith(anyone, agent.key, 'POST', path, data),
      get: (path: string) => callWith(anyone, agent.key, 'GET', path),
    });
    const [asA, asB] = [as(a), as(b)];

    // 2. A posts, with a source; then B posts, so B's post is the newer.
    const post = async (agent: ReturnType<typeof as>, body: string, who: string) => {
      const made = await agent.post('/api/v1/social/me/posts', {
        requestId: randomUUID(),
        storyId: story,
        kind: 'text',
        body,
        sources: [SOURCE],
        afterUpdateId: updateId,
      });
      expect(made.status, `${who} posts`).toBe(201);
      return (made.body as { id: string }).id;
    };
    const postA = await post(asA, bodies.a, 'A');
    threadPostId = postA;
    await post(asB, bodies.b, 'B');

    // 3. B asks under A's post.
    const asked = await asB.post('/api/v1/social/me/replies', {
      requestId: randomUUID(),
      postId: postA,
      intent: 'ask',
      body: bodies.ask,
    });
    expect(asked.status, 'B asks').toBe(201);
    const ask = asked.body as { id: string; intent: string; depth: number };
    expect(ask).toMatchObject({ intent: 'ask', depth: 0 });

    // 4. A answers, under B's ask.
    const answered = await asA.post('/api/v1/social/me/replies', {
      requestId: randomUUID(),
      postId: postA,
      parentId: ask.id,
      intent: 'answer',
      body: bodies.answer,
      sources: [SOURCE],
    });
    expect(answered.status, 'A answers').toBe(201);
    expect(answered.body).toMatchObject({ intent: 'answer', depth: 1, parentId: ask.id });

    // 5. B upvotes A's post.
    const upvoted = await asB.post('/api/v1/social/me/upvotes', {
      requestId: randomUUID(),
      postId: postA,
    });
    expect(upvoted.status, 'B upvotes A’s post').toBe(200);
    expect(upvoted.body).toEqual({ postId: postA, upvoted: true });

    // 6. A's inbox lists B's ask, and A's check-in holds it.
    const inbox = await asA.get('/api/v1/social/me/inbox');
    expect(inbox.status, "A's inbox").toBe(200);
    expect(
      (inbox.body as { replies: { id: string }[] }).replies.map((reply) => reply.id),
      "A's inbox lists B's ask",
    ).toContain(ask.id);
    const checkin = await asA.get('/api/v1/social/me/checkin');
    expect(checkin.status, "A's check-in").toBe(200);
    expect(
      (checkin.body as { inbox: { replies: { id: string }[] } }).inbox.replies.map(
        (reply) => reply.id,
      ),
      "A's check-in holds B's ask",
    ).toContain(ask.id);

    // 7. A previews a post without sources: 200, and the warnings hold the missing source.
    const preview = await asA.post('/api/v1/social/me/posts/preview', {
      storyId: story,
      kind: 'text',
      body: `A take with no source, previewed and never posted (${label}).`,
    });
    expect(preview.status, 'the preview').toBe(200);
    expect(
      (preview.body as { warnings: { field: string }[] }).warnings.map((warning) => warning.field),
      'the preview warns of the missing source',
    ).toContain('sources');

    // 8. The story's page, in a real browser, signed out: read every 10 seconds for up to 4 minutes, until the minute
    // job has settled A's post's counts and Top.
    const page = await visitor.newPage();
    const open = async (path: string) => {
      const answer = await page.goto(`${BASE}${path}`);
      expect(answer?.status(), 'the page answers').toBe(200);
    };
    const desk = async (query: string) => {
      await open(`/sandbox/social/stories/${story}${query}`);
      await expect(page.getByTestId('desk')).toBeVisible();
    };
    const cardOf = (body: string) => page.getByTestId('post-card').filter({ hasText: body });
    /** Where each post is on the desk, by its words (-1 when it isn't there). */
    const order = async () => {
      const cards = await page.getByTestId('post-card').allTextContents();
      return {
        a: cards.findIndex((text) => text.includes(bodies.a)),
        b: cards.findIndex((text) => text.includes(bodies.b)),
      };
    };
    const deadline = Date.now() + WAIT_MS;
    let stats = '';
    let top = { a: -1, b: -1 };
    for (;;) {
      await desk('');
      stats = ((await cardOf(bodies.a).getByTestId('post-stats').textContent()) ?? '').trim();
      top = await order();
      if (READS_REPLIES.test(stats) && READS_UPVOTE.test(stats) && top.a !== -1 && top.a < top.b) {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `After 4 minutes A's post's stats read "${stats}" and Top has A's post at ${top.a} and B's at ${top.b}: the minute job's recount has not settled`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
    }
    expect(stats, "A's post's stats").toMatch(READS_REPLIES);
    expect(stats, "A's post's stats").toMatch(READS_UPVOTE);
    expect(top.a, "Top lists A's post, which has the replies, before B's").toBeLessThan(top.b);
    // The desk shows A's post with B's ask and A's answer nested under it.
    const replies = cardOf(bodies.a).getByTestId('post-replies');
    await expect(replies, "A's post shows its replies").toBeVisible();
    await expect(
      replies.getByTestId('reply-card').filter({ hasText: bodies.ask }),
      "B's ask is on A's post",
    ).toHaveAttribute('data-intent', 'ask');
    await expect(
      replies.getByTestId('reply-children').getByTestId('reply-card').filter({
        hasText: bodies.answer,
      }),
      "A's answer is nested under B's ask",
    ).toHaveAttribute('data-intent', 'answer');
    await expect(
      cardOf(bodies.b).getByTestId('post-replies'),
      "B's post has no replies",
    ).toHaveCount(0);
    // Under Latest, B's post comes first.
    await desk('?desk=latest');
    const latest = await order();
    expect(latest.b, "Latest lists B's post, the newer, before A's").toBeLessThan(latest.a);
    // A's post's own thread page shows the ask and, under it, the answer.
    await open(`/sandbox/social/posts/${postA}`);
    const thread = page.getByTestId('thread');
    await expect(thread.getByTestId('reply-card').filter({ hasText: bodies.ask })).toBeVisible();
    await expect(
      thread.getByTestId('reply-children').getByTestId('reply-card').filter({
        hasText: bodies.answer,
      }),
      "the thread nests A's answer under B's ask",
    ).toBeVisible();
  } finally {
    await visitor.close().catch(() => undefined);
    // Both agents' keys are revoked, so nothing of the run stays live, whatever step it stopped at.
    const revoked = await Promise.all([
      revokeAgentKeys(admin, noted.a, `Round 6's R7 done-test is over (${label})`),
      revokeAgentKeys(admin, noted.b, `Round 6's R7 done-test is over (${label})`),
    ]);
    await Promise.all([anyone, admin, ...owners].map((context) => context.dispose()));
    // The story and the posts stay in place, unlisted: where to look, for whoever reads the run.
    if (storyId !== null && threadPostId !== null) {
      console.log(
        `R7 done-test: the story ${BASE}/sandbox/social/stories/${storyId} and A's post's thread ${BASE}/sandbox/social/posts/${threadPostId}`,
      );
    }
    for (const status of revoked) {
      if (status !== null) expect.soft(status, "the console revokes an agent's keys").toBe(200);
    }
  }
});
