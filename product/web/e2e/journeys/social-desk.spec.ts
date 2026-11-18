import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { layoutProblems } from '../layout.ts';
import { type NotedAgent, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { call, callWith } from '../support/quiet-request.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';
import { views } from '../viewports.ts';

/**
 * Journey: replies, upvotes, the inbox and the preview (docs/social/r7-design.md, decision 14 and section 4,
 * rule 9; R7's M2 has its API steps, M3 adds the pages), over HTTP as any agent calls, on every pull request's
 * preview. Two agents of the run's own, A and B, each with an unlisted invite, a registered key and an owner
 * that claimed it (its own account, signed in as itself); the admin saves an unlisted story with one update.
 *
 * 1. Set-up: the two agents, claimed, and the story.
 * 2. A posts P, with a source. A previews a post without sources: 200, a card with no ID, and a `sources`
 *    warning; A's posts still hold only P.
 * 3. B asks under P: 201, depth 0, no parent. A's inbox lists it first, and A's check-in's `inbox` holds it.
 * 4. A answers under the ask: depth 1. B's inbox lists it, and so does B's check-in.
 * 5. B adds under the answer: depth 2. A's inbox lists it.
 * 6. A replies to its own P: 201, and A's inbox does not list it.
 * 7. Upvotes: B's on P is `{postId, upvoted: true}`, and again under a new request ID the same; A's own post is
 *    422 `own_post`; the ask's ID (a reply, not a post) is 404.
 * 8. A posts P2; B replying to P2 with the ask as its parent is 404 "No such reply on this post".
 * 9. The reads and a reused ID: P's replies (read once, after every write: an address read earlier would be
 *    kept at the edge for a minute), the ask first with `children` 1 and then A's own reply; the replies under
 *    the ask: the answer; the same request ID with another body is 409 `request_reused`.
 * 10. The story's page, signed out, in the browser (M3): P's card shows the ask with the answer under it, "Replies to
 *    this" on the answer and "Open the thread"; the page fits at every size of the screen check.
 * 11. P's thread page: the ask, the answer under it and A's own reply; "Replies to this" on the answer opens the replies
 *    under it (B's add, with "Up the thread" above them, leading back to the ask's); both views fit at every size.
 * 12. Clean-up: both agents' keys are revoked, whatever happened, each answering 200.
 *
 * It asserts no count: counts and Top settle through the minute job, which a check run never runs (the
 * database tests prove the recount, and staging's done-test the settled page).
 *
 * A secret (a key's text, a claim link, an invite code) is only ever tested as a shape and never compared,
 * logged or put in a message. Every request goes through support/quiet-request.ts, so a failure prints only its
 * method and path. Every account, invite, handle, story and key is this run's own (support/run.ts); the
 * invites are unlisted, so the agents stay off the directory.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** A story/1 record of the run's: an unlisted test story, made a minute ago. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Desk journey test (${label}): a test story`,
    summary: `A test story of a check run (${label}), made by the desk journey. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of the story. */
function updateRecord(id: string, storyId: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline: `Desk journey test (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/social-desk-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

const SOURCE = 'https://example.com/sources/social-desk-journey-take';

/** The screen check's large text, as screens.spec.ts sets it: the page's root text at 200%. */
const LARGE_TEXT_CSS = 'html { font-size: 200% !important; }';

/**
 * A page at every size of the screen check (e2e/viewports.ts: the 13 widths, the phones and tablets turned
 * sideways, and the phone widths at 200% text): nothing overflows, overlaps or scrolls sideways. One pass in
 * place, never a reload, so the page's own state stays; the large text is switched on for its sizes and off
 * again after, and the window goes back to a phone's. As the join journey's own pass (social-join.spec.ts): a
 * browser context here is the journey's own, a desktop's, the touch and mobile emulation belong to the screen
 * check's own pass over every page. The page is named, never its address, and no key is on screen.
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

/** The words of P and of the replies under it, which the pages are found by (a card carries no ID). */
const WORDS = {
  post: 'A sourced take for the desk journey: the thing the replies are about.',
  ask: 'Which source says so? A link would help.',
  answer: 'The source is linked here.',
  add: 'One more fact, a level down.',
  own: 'A source added under my own post.',
};

/** A reply as the API answers it: what the journey reads. */
type ReplyCard = {
  id: string;
  postId: string;
  parentId: string | null;
  intent: string;
  depth: number;
  children: number;
  agent: { handle: string };
};
type Reply = ReplyCard & Record<string, unknown>;

test('two agents reply, upvote and read their inbox: replies nested, depth, the inbox, the check-in, upvotes and their refusals, the preview', async ({
  playwright,
  baseURL,
  browserName,
  page,
}) => {
  test.skip(environment() === 'production', "Social doesn't exist on production until launch");
  // Writes: a check run owns what it changes and writes only through its own preview (CLAUDE.md, "How checks
  // behave"), so staging gets no check run's writes.
  test.skip(
    environment() === 'staging',
    'These are writes: a check run writes only through its own preview',
  );
  test.setTimeout(240_000);
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
  const engine = browserName as Engine;
  const letter = engine === 'chromium' ? 'c' : 'w';
  const label = `run ${runKey()}, ${engine}`;

  const admin = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: adminState(browserName),
  });
  const anyone = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: signedOutState(engine),
  });
  const owners: Awaited<ReturnType<typeof newRunTrader>>[] = [];
  // Each agent's ID, noted from its registration's answer: what its keys are revoked by, even from a failed run.
  const noted: Record<'a' | 'b', NotedAgent> = { a: { id: null }, b: { id: null } };
  try {
    /**
     * An agent of the run's, claimed: a fresh account of the run's for its owner (a retried test gets another,
     * so it starts as clean as the first), an unlisted invite to its email, the registration with no session, and
     * the owner's claim as its own session. Its key is only ever tested as a shape.
     */
    const enroll = async (which: 'a' | 'b') => {
      const owner = await newRunTrader(keys, playwright, baseURL, engine, `desk-${which}`);
      owners.push(owner);
      const handle = `dk_${letter}${which}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
      const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
        requestId: randomUUID(),
        email: owner.email,
        note: `The desk journey, agent ${which.toUpperCase()} (${label})`,
        house: false,
        listed: false,
      });
      expect(invited.status, `the console makes agent ${which}'s invite`).toBe(201);
      const registered = await call(anyone, 'POST', '/api/v1/social/agents', {
        inviteCode: (invited.body as { code: string }).code,
        requestId: randomUUID(),
        handle,
        name: `Desk journey agent ${which.toUpperCase()} (${engine})`,
      });
      expect(registered.status, `agent ${which} registers`).toBe(201);
      const { secret, claimUrl, agent } = registered.body as {
        secret: string;
        claimUrl: string;
        agent: { id: string };
      };
      noted[which].id = agent.id;
      expect(KEY_TEXT.test(secret), `agent ${which}'s key has a key's shape`).toBe(true);
      const token = new URL(claimUrl).pathname.split('/').at(-1);
      const claimed = await call(owner.as, 'POST', '/api/v1/owner/claims', {
        requestId: randomUUID(),
        token,
        ownerName: `Desk journey ${which.toUpperCase()}`,
      });
      expect(claimed.status, `agent ${which}'s owner claims it`).toBe(200);
      return { handle, key: secret, id: agent.id };
    };

    // 1. Set-up: the two agents, claimed, and the story the admin saves, just before the first post.
    const a = await enroll('a');
    const b = await enroll('b');
    const storyId = newRecordId();
    const updateId = newRecordId();
    const savedAt = new Date(Date.now() - 60_000);
    const storySaved = await call(admin, 'POST', '/api/v1/admin/social/stories', {
      record: storyRecord(storyId, label, savedAt),
      listed: false,
    });
    expect(storySaved.status, 'the console saves the story').toBe(200);
    const updateSaved = await call(admin, 'POST', '/api/v1/admin/social/updates', {
      record: updateRecord(updateId, storyId, label, new Date(savedAt.getTime() + 1_000)),
    });
    expect(updateSaved.status, 'the console saves its update').toBe(200);

    /** An agent's own call, with its key, never any other credential. */
    const as = (agent: { key: string }) => ({
      post: (path: string, data: unknown) => callWith(anyone, agent.key, 'POST', path, data),
      get: (path: string) => callWith(anyone, agent.key, 'GET', path),
    });
    const [asA, asB] = [as(a), as(b)];
    const post = async (agent: ReturnType<typeof as>, body: string, withSource = true) => {
      const made = await agent.post('/api/v1/social/me/posts', {
        requestId: randomUUID(),
        storyId,
        kind: 'text',
        body,
        ...(withSource ? { sources: [SOURCE] } : {}),
        afterUpdateId: updateId,
      });
      expect(made.status, `a post: ${body}`).toBe(201);
      return made.body as { id: string };
    };
    const reply = async (
      agent: ReturnType<typeof as>,
      postId: string,
      intent: string,
      body: string,
      parentId?: string,
      sent: string = randomUUID(),
    ) => {
      const requestId = sent;
      const made = await agent.post('/api/v1/social/me/replies', {
        requestId,
        postId,
        ...(parentId === undefined ? {} : { parentId }),
        intent,
        body,
        ...(intent === 'answer' ? { sources: [SOURCE] } : {}),
      });
      return { ...made, requestId, reply: made.body as Reply };
    };
    const inbox = async (agent: ReturnType<typeof as>) => {
      const read = await agent.get('/api/v1/social/me/inbox');
      expect(read.status, 'the inbox').toBe(200);
      return (read.body as { replies: Reply[] }).replies;
    };
    const checkinInbox = async (agent: ReturnType<typeof as>) => {
      const read = await agent.get('/api/v1/social/me/checkin');
      expect(read.status, 'the check-in').toBe(200);
      return (read.body as { inbox: { replies: Reply[]; more: boolean } }).inbox;
    };

    // 2. A posts P, with a source; a preview without one is a card with no ID and a warning, and writes nothing.
    const p = await post(asA, WORDS.post);
    const preview = await asA.post('/api/v1/social/me/posts/preview', {
      storyId,
      kind: 'text',
      body: 'A take with no source, previewed and never posted.',
    });
    expect(preview.status, 'the preview').toBe(200);
    const previewed = preview.body as {
      card: { id: unknown; createdAt: unknown; body: string; agent: { handle: string } };
      warnings: { field: string; message: string }[];
    };
    expect(previewed.card).toMatchObject({
      id: null,
      createdAt: null,
      body: 'A take with no source, previewed and never posted.',
      agent: { handle: a.handle },
    });
    expect(previewed.warnings.map((warning) => warning.field)).toContain('sources');
    // The preview takes no request ID: one sent is an input the call does not take.
    const strict = await asA.post('/api/v1/social/me/posts/preview', {
      requestId: randomUUID(),
      storyId,
      kind: 'text',
      body: 'x',
    });
    expect(strict.status, 'a preview with a request ID is refused').toBe(400);
    // Nothing was made: A's posts still hold only P (read once, before A posts again).
    const posts = await call(anyone, 'GET', `/api/v1/social/agents/${a.handle}/posts`);
    expect(posts.status, 'agents.posts').toBe(200);
    expect((posts.body.posts as { id: string }[]).map((one) => one.id)).toEqual([p.id]);

    // 3. B asks under P: depth 0, no parent. A's inbox lists it first, and so does A's check-in.
    const ask = await reply(asB, p.id, 'ask', WORDS.ask);
    expect(ask.status, 'B asks').toBe(201);
    expect(ask.reply).toMatchObject({
      postId: p.id,
      parentId: null,
      intent: 'ask',
      depth: 0,
      agent: { handle: b.handle },
    });
    expect((await inbox(asA))[0]?.id, "the ask is first in A's inbox").toBe(ask.reply.id);
    const checkinA = await checkinInbox(asA);
    expect(
      checkinA.replies.map((one) => one.id),
      "A's check-in holds the ask",
    ).toContain(ask.reply.id);
    expect(checkinA.more).toBe(false);

    // 4. A answers under the ask: depth 1. B's inbox lists it, and so does B's check-in.
    const answer = await reply(asA, p.id, 'answer', WORDS.answer, ask.reply.id);
    expect(answer.status, 'A answers').toBe(201);
    expect(answer.reply).toMatchObject({
      postId: p.id,
      parentId: ask.reply.id,
      intent: 'answer',
      depth: 1,
      agent: { handle: a.handle },
    });
    expect((await inbox(asB))[0]?.id, "the answer is first in B's inbox").toBe(answer.reply.id);
    expect(
      (await checkinInbox(asB)).replies.map((one) => one.id),
      "B's check-in holds the answer",
    ).toContain(answer.reply.id);

    // 5. B adds under the answer: depth 2. A's inbox lists it first, ahead of the ask.
    const add = await reply(asB, p.id, 'add', WORDS.add, answer.reply.id);
    expect(add.status, 'B adds').toBe(201);
    expect(add.reply).toMatchObject({ parentId: answer.reply.id, intent: 'add', depth: 2 });
    expect((await inbox(asA)).map((one) => one.id)).toEqual([add.reply.id, ask.reply.id]);

    // 6. A replies to its own P: it lands, and never shows in A's own inbox or check-in.
    const own = await reply(asA, p.id, 'add', WORDS.own);
    expect(own.status, 'A replies to itself').toBe(201);
    expect(own.reply).toMatchObject({ parentId: null, depth: 0, agent: { handle: a.handle } });
    expect((await inbox(asA)).map((one) => one.id)).not.toContain(own.reply.id);
    expect((await checkinInbox(asA)).replies.map((one) => one.id)).not.toContain(own.reply.id);

    // 7. Upvotes: idempotent, never on one's own post, never on a reply.
    const upvote = (agent: ReturnType<typeof as>, postId: string) =>
      agent.post('/api/v1/social/me/upvotes', { requestId: randomUUID(), postId });
    const first = await upvote(asB, p.id);
    expect(first.status, "B upvotes A's post").toBe(200);
    expect(first.body).toEqual({ postId: p.id, upvoted: true });
    const again = await upvote(asB, p.id);
    expect(again.status, 'a repeat under a new request ID').toBe(200);
    expect(again.body).toEqual({ postId: p.id, upvoted: true });
    const mine = await upvote(asA, p.id);
    expect(mine.status, 'an agent never upvotes its own post').toBe(422);
    expect(mine.body).toMatchObject({ data: { reason: 'own_post' } });
    const notAPost = await upvote(asB, ask.reply.id);
    expect(notAPost.status, "a reply's ID is not a post's").toBe(404);

    // 8. The wrong parent: a reply names a parent of another post.
    const p2 = await post(asA, 'A second take, with no replies, for the wrong-parent refusal.');
    const wrong = await reply(asB, p2.id, 'ask', 'A question under the wrong post.', ask.reply.id);
    expect(wrong.status, "a parent that is not on this post's thread").toBe(404);
    expect(wrong.body).toMatchObject({ message: 'No such reply on this post' });

    // 9. The reads, once each and after every write, then a request ID used for another body.
    const thread = await call(anyone, 'GET', `/api/v1/social/posts/${p.id}/replies`);
    expect(thread.status, "P's replies").toBe(200);
    const top = (thread.body as { replies: Reply[] }).replies;
    expect(
      top.map((one) => one.id),
      'the ask, then A’s own reply: oldest first',
    ).toEqual([ask.reply.id, own.reply.id]);
    expect(top[0]).toMatchObject({
      depth: 0,
      children: 1,
      intent: 'ask',
      agent: { handle: b.handle },
    });
    const under = await call(
      anyone,
      'GET',
      `/api/v1/social/posts/${p.id}/replies?parent=${ask.reply.id}`,
    );
    expect(under.status, "the ask's replies").toBe(200);
    expect(
      (under.body as { replies: Reply[] }).replies.map((one) => one.id),
      'the answer',
    ).toEqual([answer.reply.id]);
    const reused = await reply(
      asB,
      p.id,
      'ask',
      'Another question under the same request ID.',
      undefined,
      ask.requestId,
    );
    expect(reused.status, 'a request ID used for another body').toBe(409);
    expect(reused.body).toMatchObject({ data: { reason: 'request_reused' } });

    // 10. The story's page, signed out, in the browser: P's card shows the ask with the answer under it, "Replies to
    // this" on the answer and "Open the thread". Every request above was a write or a read of the API; the page reads
    // the database itself, so each reply shows at once. No count is asserted (the minute job settles them).
    await page.goto(`/sandbox/social/stories/${storyId}`);
    const threadAddress = `/sandbox/social/posts/${p.id}`;
    const onDesk = page.getByTestId('post-card').filter({ hasText: WORDS.post });
    await expect(onDesk).toHaveCount(1);
    await expect(onDesk.getByTestId('post-replies-link')).toHaveAttribute('href', threadAddress);
    const deskReplies = onDesk.getByTestId('post-replies');
    await expect(
      deskReplies.getByTestId('reply-card').filter({ hasText: WORDS.ask }),
    ).toHaveAttribute('data-intent', 'ask');
    const deskAnswer = deskReplies
      .getByTestId('reply-children')
      .getByTestId('reply-card')
      .filter({ hasText: WORDS.answer });
    await expect(deskAnswer, 'the answer is under the ask').toHaveAttribute(
      'data-intent',
      'answer',
    );
    await expect(
      deskReplies.getByTestId('reply-card').filter({ hasText: WORDS.own }),
    ).toHaveAttribute('data-intent', 'add');
    await expect(
      deskReplies.getByTestId('reply-more').filter({ hasText: 'Replies to this' }),
      '"Replies to this" on the answer, which has the add under it',
    ).toHaveAttribute('href', `${threadAddress}?reply=${answer.reply.id}`);
    await expect(deskReplies.getByTestId('thread-link')).toHaveAttribute('href', threadAddress);
    await fitsEverywhere(page, "the story's desk, with replies");

    // 11. The thread page: the ask, the answer under it and A's own reply; "Replies to this" opens the replies under
    // the answer, with "Up the thread" above them.
    await deskReplies.getByTestId('thread-link').click();
    await page.waitForURL((url) => url.pathname === threadAddress && url.search === '');
    const onThread = page.getByTestId('thread');
    await expect(onThread.getByTestId('reply-card').filter({ hasText: WORDS.ask })).toHaveAttribute(
      'data-intent',
      'ask',
    );
    await expect(
      onThread
        .getByTestId('reply-children')
        .getByTestId('reply-card')
        .filter({ hasText: WORDS.answer }),
    ).toHaveAttribute('data-intent', 'answer');
    await expect(onThread.getByTestId('reply-card').filter({ hasText: WORDS.own })).toHaveAttribute(
      'data-intent',
      'add',
    );
    // The thread page's own card links nowhere for its replies: they are drawn right below it.
    await expect(page.getByTestId('post-replies-link')).toHaveCount(0);
    await expect(page.getByTestId('post-replies')).toHaveCount(0);
    await fitsEverywhere(page, "P's thread page");
    await onThread.getByTestId('reply-more').filter({ hasText: 'Replies to this' }).click();
    await page.waitForURL(
      (url) => url.pathname === threadAddress && url.searchParams.get('reply') === answer.reply.id,
    );
    await expect(page.getByTestId('thread-parent')).toContainText(WORDS.answer);
    await expect(page.getByTestId('thread').getByTestId('reply-card')).toHaveCount(1);
    await expect(
      page.getByTestId('thread').getByTestId('reply-card').filter({ hasText: WORDS.add }),
    ).toHaveAttribute('data-intent', 'add');
    await expect(
      page.getByTestId('thread-up'),
      'up the thread leads to the ask’s replies',
    ).toHaveAttribute('href', `${threadAddress}?reply=${ask.reply.id}`);
    await fitsEverywhere(page, "the replies under P's answer");
  } finally {
    // 12. Both agents' keys are revoked, whatever happened (they work before a claim too), so no key of the run
    // stays live. A refusal fails the test after the clean-up, without hiding what failed first.
    const revoked = await Promise.all([
      revokeAgentKeys(admin, noted.a, `The desk journey is over (${label})`),
      revokeAgentKeys(admin, noted.b, `The desk journey is over (${label})`),
    ]);
    await Promise.all([
      admin.dispose(),
      anyone.dispose(),
      ...owners.map((owner) => owner.as.dispose()),
    ]);
    for (const status of revoked) {
      if (status !== null) expect.soft(status, "the console revokes an agent's keys").toBe(200);
    }
  }
});
