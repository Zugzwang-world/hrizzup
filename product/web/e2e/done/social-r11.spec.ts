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
import { newDevice, openAndWaitForNote } from '../support/view-notes.ts';

/**
 * The founder's done-test of Round 6's R11 (docs/social/r11-design.md, section 4, rule 8: views are counted, and with
 * replies and upvotes move Top): two agents post on one story, two signed-out devices read it, and once staging's own
 * minute job has run, the numbers are on the posts, the story and the agent's own calls, and Top puts the upvoted post
 * first. On staging itself. Run by hand, once, from this Mac, never by the checks (a few minutes: it waits for the job),
 * once M3 is on staging:
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-r11.spec.ts'
 * The path, as R7's (`social-7.3.spec.ts`) and R8's (`social-r8.spec.ts`) go: Doppler `stg` only, no bypass cookie, no
 * real email (each owner and the admin are signed in through staging's admin access), every account, invite, handle and
 * key the run's own:
 * 1. the weights, as the admin test account: Top's view weight is 0.01 and its upvote weight 0.5 (a reply is worth 100
 *    views or two upvotes). The settings are read; unless they are already so, they are posted with their reason ("Views
 *    and upvotes join replies in Top: a view counts 0.01 and an upvote 0.5 of a reply (R11; docs/social/build.md,
 *    7.3)"), and read back: the newest log entry carries that reason. A repeat run changes and logs nothing;
 * 2. one unlisted test story S with one update, made through the console's calls, and left in place at the end;
 * 3. two fresh agents, A and B (unlisted invites, each claimed by its own run account). A posts PA, then B posts PB, so
 *    PB is the newer;
 * 4. signed out, on two devices (two fresh browser contexts, D1 and D2, in a window tall enough for the story's tile and
 *    both posts to be on screen together), each opens S's desk page, `/sandbox/social/stories/<S>`, and keeps PA on screen
 *    until its note has gone out and been answered. D1 then opens the desk again. Before any number is asserted, each
 *    note is checked to be about S, PA and PB and to have been answered in the page itself: D1's first note counts 1 or
 *    more, D2's 1 or more, and D1's second visit 0 (a device counts once a UTC day);
 * 5. B upvotes PA, with B's posting key;
 * 6. the wait: every 10 seconds, for up to 4 minutes, until staging's minute job has applied the views. What is read is
 *    A's `GET /api/v1/social/me/stats`, with A's key: a personal call that no edge and no Redis keeps, and never a view.
 *    Once PA reads views 2, unique views 2 and upvotes 1, 20 more seconds are waited (the minute run applies the counts,
 *    then ranks and rates them in a second statement, and ends within its 18-second deadline), and then every number is
 *    read, each address once and for the first time of the run (the public posts and agents addresses are kept at the
 *    edge, so none is read before this point), or from D1's page, which is dynamic and, with D1 already counted for S,
 *    PA and PB that day, can't add a view:
 *    - PA's counts are views 2 and unique views 2 (D1's second visit counted once, by the design's rule) and upvotes 1;
 *    - PA's card on the desk reads "2 views (2 readers)" and "1 upvote";
 *    - S's tile, heading its desk, reads "2 views (2 readers)";
 *    - S's desk under Top lists PA before PB, while Latest lists PB first;
 *    - A's check-in `stats` is `{posts: 1, views: 2, replies: 0, upvotes: 1, standing}`;
 *    - A's `GET /api/v1/social/me/stats` lists PA with views 2, unique views 2 and upvotes 1;
 *    - A's standing on its profile is its check-in's;
 * 7. at the end, whatever happened, both agents' keys are revoked (each answering 200). The story and the posts stay in
 *    place, unlisted. One line prints the story's desk address and the two agents' profile addresses, for the founder.
 * Within ten minutes before 00:00 UTC, and the two minutes after it, the run waits until two minutes past before its
 * views, so a device counts once on one UTC day and never straddles two (the views, the wait and the reads all fall
 * within the day). Everything it makes is unlisted (the invites, the story), so the agents never show in the directory
 * or on the board. Nothing secret is printed or logged: a key, a claim link or an invite code is only ever checked as
 * a shape or a presence, never compared, logged or put in a message; every request goes through
 * support/quiet-request.ts, which throws a new error naming only the method and the path, because a thrown request's
 * call log holds every header it sent.
 */

const BASE = process.env.BASE_URL ?? '';

/** How long staging's minute job is waited on, and how often it is read. */
const WAIT_MS = 4 * 60_000;
const EVERY_MS = 10_000;
/** After the views show: the minute run's second statement (ranks and standing) is at most one run's deadline behind. */
const SETTLE_MS = 20_000;

/** A window tall enough for the story's tile and both posts to be on screen at once, so one note holds all three. */
const WINDOW = { width: 1280, height: 1800 };

const SOURCE = 'https://example.com/sources/social-r11-done-test';

/** The weights' reason, in the log. */
const REASON =
  'Views and upvotes join replies in Top: a view counts 0.01 and an upvote 0.5 of a reply (R11; docs/social/build.md, 7.3)';
const VIEW_WEIGHT = 0.01;
const UPVOTE_WEIGHT = 0.5;

/** What the stats must read: "1 upvote" as words of their own (never "11 upvotes"). */
const READS_UPVOTE = /(^|\s)1 upvote(\s|$)/;
const TWO_VIEWS = '2 views (2 readers)';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits out the minutes around 00:00 UTC, so no step of the run straddles two UTC days. */
async function awayFromMidnight(): Promise<void> {
  const now = new Date();
  const seconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const wait = seconds >= 86_400 - 600 ? 86_400 + 120 - seconds : seconds < 120 ? 120 - seconds : 0;
  if (wait > 0) await sleep((wait + 1) * 1_000);
}

/** The settings, as far as this run reads them. */
type Settings = {
  topWViews: number | string;
  topWUpvotes: number | string;
  ranksVersion: number;
  log: { changedAt: string; reason: string }[];
};

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `R11 done-test (${label}): a test story`,
    summary: `A test story of a done-test run (${label}), for views, Top and the agents' numbers. Unlisted: it never shows on the board.`,
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
    headline: `R11 done-test (${label}): the first update of the test story`,
    reported_at: now,
    sources: [SOURCE],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

test("R11's done-test: two agents post, two devices read, and once staging's minute job has run the views are on the posts, the story and the agent's own calls, and Top puts the upvoted post first", async ({
  playwright,
  browser,
}) => {
  // The set-up (2 min), a wait around midnight UTC (12 min at most), the views (1 min), the wait for the job (4 min and
  // 20 s) and the reads (1 min): 20 minutes in the worst case.
  test.setTimeout(1_500_000);
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
  const handles: Partial<Record<'a' | 'b', string>> = {};
  const devices: Awaited<ReturnType<typeof newDevice>>[] = [];
  try {
    // 1. The weights, as the admin test account.
    const read = await call(admin, 'GET', '/api/v1/admin/social/settings');
    expect(read.status, "the console reads staging's settings").toBe(200);
    const before = read.body as unknown as Settings;
    const alreadySo =
      Number(before.topWViews) === VIEW_WEIGHT && Number(before.topWUpvotes) === UPVOTE_WEIGHT;
    if (!alreadySo) {
      const set = await call(admin, 'POST', '/api/v1/admin/social/settings', {
        changes: { topWViews: VIEW_WEIGHT, topWUpvotes: UPVOTE_WEIGHT },
        reason: REASON,
      });
      expect(set.status, "the console changes Top's weights").toBe(200);
    }
    const readBack = await call(admin, 'GET', '/api/v1/admin/social/settings');
    expect(readBack.status, 'the console reads the settings back').toBe(200);
    const after = readBack.body as unknown as Settings;
    expect(Number(after.topWViews), "Top's view weight").toBe(VIEW_WEIGHT);
    expect(Number(after.topWUpvotes), "Top's upvote weight").toBe(UPVOTE_WEIGHT);
    if (alreadySo) {
      expect(after.log, 'a repeat run changes and logs nothing').toEqual(before.log);
      expect(after.ranksVersion, 'a repeat run re-ranks nothing').toBe(before.ranksVersion);
    } else {
      expect(after.log[0]?.reason, 'the newest log entry carries the weights’ reason').toBe(REASON);
      expect(after.ranksVersion, 'the change re-ranks everything').toBeGreaterThan(
        before.ranksVersion,
      );
    }

    /** An agent of the run's, claimed: an account for its owner, an unlisted invite, the registration and the claim. */
    const enroll = async (which: 'a' | 'b') => {
      const email = runAddress(`done-r11-${which}`, 'chromium');
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
        note: `Round 6's R11 done-test, agent ${which.toUpperCase()} (${label})`,
        house: false,
        listed: false,
      });
      expect(invited.status, `the console makes agent ${which}'s invite`).toBe(201);
      const handle = `d11_${which}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
      const registered = await call(anyone, 'POST', '/api/v1/social/agents', {
        inviteCode: (invited.body as { code: string }).code,
        requestId: randomUUID(),
        handle,
        name: `R11 done-test agent ${which.toUpperCase()}`,
      });
      expect(registered.status, `agent ${which} registers`).toBe(201);
      const { secret, claimUrl, agent } = registered.body as {
        secret: string;
        claimUrl: string;
        agent: { id: string };
      };
      noted[which].id = agent.id;
      handles[which] = handle;
      expect(KEY_TEXT.test(secret), `agent ${which}'s key has a key's shape`).toBe(true);
      const claimed = await call(owner, 'POST', '/api/v1/owner/claims', {
        requestId: randomUUID(),
        token: new URL(claimUrl).pathname.split('/').at(-1),
        ownerName: 'Check run',
      });
      expect(claimed.status, `agent ${which}'s owner claims it`).toBe(200);
      return { key: secret, handle };
    };

    // 2 and 3. The unlisted test story with one update, and two claimed agents.
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
      a: `A's post in the R11 done-test (${label}): the take two devices read and an agent upvotes.`,
      b: `B's later post in the R11 done-test (${label}): a take that is read and never upvoted.`,
    };
    const as = (agent: { key: string }) => ({
      post: (path: string, data: unknown) => callWith(anyone, agent.key, 'POST', path, data),
      get: (path: string) => callWith(anyone, agent.key, 'GET', path),
    });
    const [asA, asB] = [as(a), as(b)];
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
    // A posts PA, then B posts PB, so PB is the newer.
    const postA = await post(asA, bodies.a, 'A');
    const postB = await post(asB, bodies.b, 'B');

    // 4. Signed out, on two devices. A device counts once a UTC day, so every device step is within one.
    await awayFromMidnight();
    const deskAddress = `/sandbox/social/stories/${story}`;
    const wanted = [
      { kind: 'story', id: story },
      { kind: 'post', id: postA },
      { kind: 'post', id: postB },
    ];
    const d1 = await newDevice(browser, { baseURL: BASE, viewport: WINDOW });
    devices.push(d1);
    const d2 = await newDevice(browser, { baseURL: BASE, viewport: WINDOW });
    devices.push(d2);
    const first = await openAndWaitForNote(d1, deskAddress);
    await first.page.close();
    expect(first.status, "D1's note").toBe(200);
    expect(first.answered, "D1's note, as the page saw its answer").toBe(200);
    expect(first.body.items, "D1's note is about the story and both posts").toEqual(
      expect.arrayContaining(wanted),
    );
    expect(first.answer.counted, "D1's first views count").toBeGreaterThanOrEqual(1);
    const second = await openAndWaitForNote(d2, deskAddress);
    await second.page.close();
    expect(second.status, "D2's note").toBe(200);
    expect(second.answered, "D2's note, as the page saw its answer").toBe(200);
    expect(second.body.device, 'another browser, another device').not.toBe(first.body.device);
    expect(second.body.items, "D2's note is about the story and both posts").toEqual(
      expect.arrayContaining(wanted),
    );
    expect(second.answer.counted, "D2's views count").toBeGreaterThanOrEqual(1);
    const again = await openAndWaitForNote(d1, deskAddress);
    await again.page.close();
    expect(again.status, "D1's second note").toBe(200);
    expect(again.answered, "D1's second note, as the page saw its answer").toBe(200);
    expect(again.body.device, 'the browser keeps its device').toBe(first.body.device);
    expect(
      again.body.items,
      "D1's second note is about the story and both posts, PA among them",
    ).toEqual(expect.arrayContaining(wanted));
    expect(again.answer, 'a device counts once a day: nothing, PA included').toEqual({
      counted: 0,
    });

    // 5. B upvotes PA.
    const upvoted = await asB.post('/api/v1/social/me/upvotes', {
      requestId: randomUUID(),
      postId: postA,
    });
    expect(upvoted.status, 'B upvotes PA').toBe(200);
    expect(upvoted.body).toEqual({ postId: postA, upvoted: true });

    // 6. The wait, read every 10 seconds for up to 4 minutes through A's own stats: a personal call that no edge and no
    // Redis keeps, and that is never a view.
    const deadline = Date.now() + WAIT_MS;
    let reads = 'PA is not in A’s stats';
    for (;;) {
      const stats = await asA.get('/api/v1/social/me/stats');
      expect(stats.status, "A's stats").toBe(200);
      const mine = (
        stats.body.posts as {
          postId: string;
          views: number;
          uniqueViews: number;
          upvotes: number;
        }[]
      ).find((item) => item.postId === postA);
      if (mine) {
        reads = `views ${mine.views}, unique ${mine.uniqueViews}, upvotes ${mine.upvotes}`;
        if (mine.views === 2 && mine.uniqueViews === 2 && mine.upvotes === 1) break;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `After 4 minutes PA reads ${reads} in A's stats: staging's minute job has not applied the views and the upvote (wanted views 2, unique 2, upvotes 1)`,
        );
      }
      await sleep(EVERY_MS);
    }
    // The views show: the minute run's ranks and ratings follow in its next statement, within its deadline.
    await sleep(SETTLE_MS);

    // Every number from here is read once, for the first time of the run.
    // PA's counts, over the API (the post's own address: kept at the edge, and not read before).
    const postRead = await call(anyone, 'GET', `/api/v1/social/posts/${postA}`);
    expect(postRead.status, 'PA').toBe(200);
    expect(postRead.body.counts, "PA's counts: two devices, D1's second visit once").toMatchObject({
      views: 2,
      uniqueViews: 2,
      upvotes: 1,
    });

    // The desk and the tile, in D1's page: dynamic, never an edge copy, and D1 is counted for all three that day.
    const page = await d1.newPage();
    const open = async (query: string) => {
      const answered = await page.goto(`${BASE}${deskAddress}${query}`);
      expect(answered?.status(), 'the desk answers').toBe(200);
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
    await open('');
    await expect(cardOf(bodies.a).getByTestId('post-views'), "PA's views on the desk").toHaveText(
      TWO_VIEWS,
    );
    const stats = ((await cardOf(bodies.a).getByTestId('post-stats').textContent()) ?? '').trim();
    expect(stats, "PA's stats on the desk").toContain(TWO_VIEWS);
    expect(stats, "PA's stats on the desk").toMatch(READS_UPVOTE);
    await expect(page.getByTestId('story-tile'), "S's tile, heading its desk").toContainText(
      TWO_VIEWS,
    );
    const top = await order();
    expect(top.a, 'Top has PA on the desk').not.toBe(-1);
    expect(top.a, "Top lists PA, upvoted and viewed, before PB's views alone").toBeLessThan(top.b);
    await open('?desk=latest');
    const latest = await order();
    expect(latest.b, 'Latest lists PB, the newer, before PA').toBeLessThan(latest.a);
    await page.close();

    // A's own calls: its check-in (read here for the first time, so no copy of it is kept yet) and its stats.
    const checkin = await asA.get('/api/v1/social/me/checkin');
    expect(checkin.status, "A's check-in").toBe(200);
    expect(checkin.body.stats, "A's check-in totals").toEqual({
      posts: 1,
      views: 2,
      replies: 0,
      upvotes: 1,
      standing: expect.any(Number),
    });
    const finalStats = await asA.get('/api/v1/social/me/stats');
    expect(finalStats.status, "A's stats, again").toBe(200);
    expect(finalStats.body.posts, "A's stats list PA with its numbers").toEqual([
      expect.objectContaining({
        postId: postA,
        storyId: story,
        views: 2,
        uniqueViews: 2,
        replies: 0,
        upvotes: 1,
      }),
    ]);
    // A's standing on its profile (the agent's own address: kept at the edge, and not read before) is its check-in's.
    const profile = await call(anyone, 'GET', `/api/v1/social/agents/${a.handle}`);
    expect(profile.status, "A's profile").toBe(200);
    expect(profile.body.standing, "A's standing on its profile is its check-in's").toBe(
      (checkin.body.stats as { standing: number }).standing,
    );
  } finally {
    await Promise.all(devices.map((context) => context.close().catch(() => undefined)));
    // Both agents' keys are revoked, so nothing of the run stays live, whatever step it stopped at.
    const revoked = await Promise.all([
      revokeAgentKeys(admin, noted.a, `Round 6's R11 done-test is over (${label})`),
      revokeAgentKeys(admin, noted.b, `Round 6's R11 done-test is over (${label})`),
    ]);
    await Promise.all([anyone, admin, ...owners].map((context) => context.dispose()));
    // The story stays in place, unlisted: where to look, for whoever reads the run.
    if (storyId !== null && handles.a !== undefined && handles.b !== undefined) {
      console.log(
        `R11 done-test: the story's desk ${BASE}/sandbox/social/stories/${storyId}, agent A ${BASE}/sandbox/social/agents/${handles.a}, agent B ${BASE}/sandbox/social/agents/${handles.b}`,
      );
    }
    for (const status of revoked) {
      if (status !== null) expect.soft(status, "the console revokes an agent's keys").toBe(200);
    }
  }
});
