import { randomBytes, randomUUID } from 'node:crypto';
import { type BrowserContext, expect, test } from '@playwright/test';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { deviceIdOf, ENDPOINT, isDeviceId } from '../../lib/social/view-rules.ts';
import { type NotedAgent, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { fitsEverywhere } from '../support/fits-everywhere.ts';
import { call, callWith } from '../support/quiet-request.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';
import { newDevice, openAndWaitForNote } from '../support/view-notes.ts';

/**
 * Journey: views are counted, once a device a UTC day, and show on the post, the story and the agent (docs/social/
 * r11-design.md, decision 1 and section 3.11, the first part; R11's M2), on every pull request's preview. The run's
 * own agent A (an unlisted invite, registered, claimed by its own run account), its posts P1 and P2 on the run's own
 * unlisted story S: the admin saves S with one update.
 *
 * 1. Set-up: the admin saves S with one update; A posts P1, then P2. Then a warm-up: a throwaway note and a throwaway
 *    door call, about a post ID that no post has, so the functions and Redis's script cache are warm before any number
 *    is asserted (a note or a take that is late counts nothing, silently).
 * 2. Device D1 (a fresh browser context, signed out) opens P1's thread page. Its note goes out after `load`, not
 *    before, with `items` `[{post, P1}]` and a device of the right shape, and is answered `{counted: 1}`.
 * 3. D1 opens it again: `{counted: 0}`. A device counts once a day.
 * 4. D2 (another fresh context) opens it: `{counted: 1}`.
 * 5. Over the API, with a device ID of the run's own: `[{story: S}, {post: P2}]` counts 2; the same note again, with the
 *    same request ID, answers 200 `{counted: 0}`; the same request ID with `[{post: P1}]` is 409 `request_reused`; 51
 *    items are 400.
 * 6. The counts door, `POST /api/jobs/social?job=counts`, with the run's own IDs and the jobs secret (retried every
 *    5 seconds for 90 while another run holds its lease): it recounts P1, P2, S and A.
 * 7. The reads, each address once and after the writes it checks: P1 has 2 views and 2 unique, P2 1 and 1, S 1 and 1, and
 *    A 3 and 3, with a standing above 0 when staging's views weight gives it a whole point (formula in the step).
 * 8. The door again, then the desk (an address not read before): P1 still 2 and 2, P2 1 and 1: nothing counted twice.
 * 9. What A sees (the second part, M3; docs/social/r11-design.md, section 4, rule 7): A's `GET /social/me/stats` lists
 *    P2 then P1, P1 at views 2 and uniqueViews 2, P2 at 1 and 1; A's check-in (read for the first time here, so no copy
 *    of it is kept yet) holds `stats` of 2 posts, 3 views, no replies and no upvotes, with a standing equal to A's
 *    profile's (step 7's read); and P1's thread page shows "2 views (2 readers)" in `post-views`, read as D1, which is
 *    already counted for P1 that day, so reading it adds no view.
 * 10. Top on the desk: `GET /social/stories/{S}/posts?sort=top` (an address not read before) lists P1 before P2 when
 *    staging's `topWViews` (read in step 7, never written: settings are shared) is above 0, since P1 has more views, and
 *    P2 first when it is 0 (newer, with no signal).
 * 11. The fit: S's desk (the story's tile and both post cards) and P1's thread page fit every width, sideways and at
 *    large text, in both browsers.
 * 12. Clean-up, whatever happened: A's keys are revoked.
 *
 * A device counts once a UTC day, so within three minutes before and two after 00:00 UTC the journey waits until two
 * minutes past before its device steps (a test that passes only on a retry fails its check). The jobs secret and every
 * key are only ever tested as shapes; every request goes through support/quiet-request.ts, so a failure prints only its
 * method and path. It imports only pure modules (`view-rules.ts` and the helpers the other journeys use), so the Screen
 * check's named keys stay what they are plus `SOCIAL_JOBS_SECRET`, which it reads for the door's bearer.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** A story/1 record of the run's: an unlisted test story, made a minute ago. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Signals journey test (${label}): a test story`,
    summary: `A test story of a check run (${label}), made by the signals journey. Unlisted: it never shows on the board.`,
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
    headline: `Signals journey test (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/social-signals-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

const SOURCE = 'https://example.com/sources/social-signals-journey-take';
const WORDS = {
  p1: 'A take on the signals journey’s story: the first, which two devices open.',
  p2: 'A second take on the signals journey’s story: counted over the API.',
};

/** Waits out the minutes around 00:00 UTC, so no "once a day" step of the journey straddles two days. */
async function awayFromMidnight(): Promise<void> {
  const now = new Date();
  const seconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const wait = seconds >= 86_400 - 180 ? 86_400 + 120 - seconds : seconds < 120 ? 120 - seconds : 0;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1_000));
}

test('views are counted once a device a day, applied by the counts door, and show on the post, the story and the agent', async ({
  playwright,
  baseURL,
  browser,
  browserName,
}) => {
  test.skip(environment() === 'production', "Social doesn't exist on production until launch");
  // Writes: a check run owns what it changes and writes only through its own preview (CLAUDE.md, "How checks
  // behave"), so staging gets no check run's writes.
  test.skip(
    environment() === 'staging',
    'These are writes: a check run writes only through its own preview',
  );
  // The worst case, added up: the set-up (30 s), a wait around midnight UTC (301 s at most), the warm-up (10 s and a
  // door call), three pages that each send their note about 12 s after their load (3 x 30 s with the page and its
  // answer), the API steps (15 s), three door calls that may each wait 90 s on a busy lease (the warm-up's, the
  // counting one and the repeat), the reads (40 s), and the second part (A's two reads, then two pages with a fit pass
  // each at all 13 widths and sideways, about 45 s apiece in WebKit): about 850 s.
  test.setTimeout(960_000);
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
  const jobsSecret = process.env.SOCIAL_JOBS_SECRET;
  if (!jobsSecret)
    throw new Error("Social's jobs secret is missing, so the counts door can't be reached");
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
  let owner: Awaited<ReturnType<typeof newRunTrader>> | null = null;
  const noted: NotedAgent = { id: null };
  const devices: BrowserContext[] = [];
  try {
    // 1. Set-up: A (an unlisted invite, registered, claimed by its own run account), the story and its update.
    owner = await newRunTrader(keys, playwright, baseURL, engine, 'signals');
    const handle = `sg_${letter}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
      requestId: randomUUID(),
      email: owner.email,
      note: `The signals journey, agent A (${label})`,
      house: false,
      listed: false,
    });
    expect(invited.status, "the console makes agent A's invite").toBe(201);
    const registered = await call(anyone, 'POST', '/api/v1/social/agents', {
      inviteCode: (invited.body as { code: string }).code,
      requestId: randomUUID(),
      handle,
      name: `Signals journey agent A (${engine})`,
    });
    expect(registered.status, 'agent A registers').toBe(201);
    const { secret, claimUrl, agent } = registered.body as {
      secret: string;
      claimUrl: string;
      agent: { id: string };
    };
    noted.id = agent.id;
    expect(KEY_TEXT.test(secret), "agent A's key has a key's shape").toBe(true);
    const claimed = await call(owner.as, 'POST', '/api/v1/owner/claims', {
      requestId: randomUUID(),
      token: new URL(claimUrl).pathname.split('/').at(-1),
      ownerName: 'Signals journey A',
    });
    expect(claimed.status, "agent A's owner claims it").toBe(200);

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
    const post = async (body: string) => {
      const made = await callWith(anyone, secret, 'POST', '/api/v1/social/me/posts', {
        requestId: randomUUID(),
        storyId,
        kind: 'text',
        body,
        sources: [SOURCE],
        afterUpdateId: updateId,
      });
      expect(made.status, `a post: ${body}`).toBe(201);
      return (made.body as { id: string }).id;
    };
    const p1 = await post(WORDS.p1);
    const p2 = await post(WORDS.p2);

    // Every device step below is within one UTC day.
    await awayFromMidnight();

    /**
     * The counts door for the run's own IDs. Another run (of any pull request) may hold its lease, so a busy answer is
     * asked again every 5 seconds, for 90: polling for a lease, never a retry of a test.
     */
    const door = async (wanted: { posts: string[]; stories: string[]; files: string[] }) => {
      for (let tried = 0; ; tried++) {
        const answered = await callWith(
          anyone,
          jobsSecret,
          'POST',
          '/api/jobs/social?job=counts',
          wanted,
        );
        if (answered.status === 200 && answered.body.busy === true && tried < 18) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          continue;
        }
        return answered;
      }
    };

    // Warm-up: a note counts only if Redis answers within 500 ms (a late answer is a wrong number, never an error), and
    // the counts door's take and uniques wait 750 ms each. A cold function, a script not yet in Redis's cache (EVALSHA
    // then EVAL) or a first connection could eat that, so the first note and the first door call are throwaways, about a
    // post ID that is the run's own and that no post has: the note's function, its script, the door's function and its
    // take script and uniques transaction are warm before any number is asserted.
    const warm = newRecordId();
    const warmed = await call(anyone, 'POST', ENDPOINT, {
      requestId: randomUUID(),
      device: deviceIdOf(new Uint8Array(randomBytes(16))),
      items: [{ kind: 'post', id: warm }],
    });
    expect(warmed.status, 'a throwaway note over the API').toBe(200);
    const warmDoor = await door({ posts: [warm], stories: [], files: [] });
    expect(warmDoor.status, 'a throwaway call of the counts door').toBe(200);
    expect(warmDoor.body).toMatchObject({ ran: true, ok: true });

    // 2. D1 opens P1's thread page: its note goes out after `load`, never before, for the one post on the page.
    const threadAddress = `/sandbox/social/posts/${p1}`;
    const d1 = await newDevice(browser, {
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    devices.push(d1);
    const first = await openAndWaitForNote(d1, threadAddress);
    await first.page.close();
    expect(first.status, "D1's note").toBe(200);
    expect(first.answered, "D1's note, as the page saw its answer").toBe(200);
    expect(first.beforeLoad, 'no note went out before the page loaded').toBe(0);
    expect(first.body.items, "D1's note is about the post on the page").toEqual([
      { kind: 'post', id: p1 },
    ]);
    expect(isDeviceId(first.body.device), "D1's device has a device ID's shape").toBe(true);
    expect(first.answer, 'the first view of the day counts').toEqual({ counted: 1 });

    // 3. D1 again: the same device, the same day: nothing counts (the device is kept by the browser).
    const again = await openAndWaitForNote(d1, threadAddress);
    await again.page.close();
    expect(again.body.device, 'the browser keeps its device').toBe(first.body.device);
    expect(again.body.requestId, 'each note has a request ID of its own').not.toBe(
      first.body.requestId,
    );
    expect(again.answer, 'a device counts once a day').toEqual({ counted: 0 });

    // 4. D2, another device: it counts.
    const d2 = await newDevice(browser, {
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    devices.push(d2);
    const second = await openAndWaitForNote(d2, threadAddress);
    await second.page.close();
    expect(second.body.device, 'another browser, another device').not.toBe(first.body.device);
    expect(second.answer, "a second device's view counts").toEqual({ counted: 1 });

    // 5. Over the API, with a device of the run's own.
    const device = deviceIdOf(new Uint8Array(randomBytes(16)));
    const requestId = randomUUID();
    const note = {
      requestId,
      device,
      items: [
        { kind: 'story', id: storyId },
        { kind: 'post', id: p2 },
      ],
    };
    const viaApi = await call(anyone, 'POST', ENDPOINT, note);
    expect(viaApi.status, 'a note over the API').toBe(200);
    expect(viaApi.body, 'a story and a post count').toEqual({ counted: 2 });
    const retried = await call(anyone, 'POST', ENDPOINT, note);
    expect(retried.status, 'a retry with the same request ID').toBe(200);
    expect(retried.body, 'a retry counts nothing').toEqual({ counted: 0 });
    const reused = await call(anyone, 'POST', ENDPOINT, {
      requestId,
      device,
      items: [{ kind: 'post', id: p1 }],
    });
    expect(reused.status, 'the same request ID with another note').toBe(409);
    expect(reused.body).toMatchObject({ data: { reason: 'request_reused' } });
    const tooMany = await call(anyone, 'POST', ENDPOINT, {
      requestId: randomUUID(),
      device,
      items: Array.from({ length: 51 }, () => ({ kind: 'post', id: randomUUID() })),
    });
    expect(tooMany.status, '51 items are more than a note holds').toBe(400);

    // 6. The counts door, for the run's own IDs.
    const counted = await door({ posts: [p1, p2], stories: [storyId], files: [] });
    expect(counted.status, 'the counts door').toBe(200);
    expect(counted.body).toMatchObject({ ran: true, ok: true });
    const recounted = counted.body.ids as { stories: string[]; posts: string[]; agents: string[] };
    expect(recounted.posts).toEqual(expect.arrayContaining([p1, p2]));
    expect(recounted.stories).toContain(storyId);
    expect(recounted.agents).toContain(agent.id);

    // 7. The reads, each address once, after the writes it checks: the run's own IDs, so no edge copy of any exists yet.
    const postOne = await call(anyone, 'GET', `/api/v1/social/posts/${p1}`);
    expect(postOne.status, 'P1').toBe(200);
    expect(postOne.body.counts, 'P1: two devices').toMatchObject({ views: 2, uniqueViews: 2 });
    const postTwo = await call(anyone, 'GET', `/api/v1/social/posts/${p2}`);
    expect(postTwo.status, 'P2').toBe(200);
    expect(postTwo.body.counts, 'P2: one device').toMatchObject({ views: 1, uniqueViews: 1 });
    const story = await call(anyone, 'GET', `/api/v1/social/stories/${storyId}`);
    expect(story.status, 'S').toBe(200);
    expect(story.body.counts, 'S: its own page, one device').toMatchObject({
      views: 1,
      uniqueViews: 1,
    });
    const settings = await call(admin, 'GET', '/api/v1/admin/social/settings');
    expect(
      settings.status,
      "the console reads staging's settings (never writes them: they are shared)",
    ).toBe(200);
    const profile = await call(anyone, 'GET', `/api/v1/social/agents/${handle}`);
    expect(profile.status, 'A').toBe(200);
    expect(profile.body.counts, "A: its posts' views, three devices in all").toMatchObject({
      views: 3,
      uniqueViews: 3,
    });
    const standing = profile.body.standing as number;
    // A's standing is its views alone (no replies or upvotes from others, no file reads): in whole points,
    // floor(round(10^6 x ln(1 + w x views)) / 10^4) for staging's views weight w (docs/social/build.md, 7.3).
    const weight = settings.body.standingWViews as number;
    const points = Math.floor(Math.round(1e6 * Math.log(1 + weight * 3)) / 1e4);
    if (points >= 1) {
      expect(standing, "A's standing moves with its three views").toBeGreaterThan(0);
    } else {
      expect(standing, "A's standing, with views worth less than a point").toBe(0);
    }

    // 8. Nothing counts twice: the door again, then the desk (an address not read before).
    const repeated = await door({ posts: [p1, p2], stories: [storyId], files: [] });
    expect(repeated.status, 'the counts door again').toBe(200);
    expect(repeated.body).toMatchObject({ ran: true, ok: true });
    const desk = await call(anyone, 'GET', `/api/v1/social/stories/${storyId}/posts?sort=latest`);
    expect(desk.status, "the story's desk").toBe(200);
    const cards = (desk.body.posts as { id: string; counts: Record<string, number> }[]).map(
      (card) => [card.id, card.counts.views, card.counts.uniqueViews] as const,
    );
    expect(cards, 'the desk shows each post once, with the same numbers').toEqual(
      expect.arrayContaining([
        [p1, 2, 2],
        [p2, 1, 1],
      ]),
    );
    // 9. What A sees. A's stats and check-in are A's own (its key), never kept at the edge and never a view; each is read
    // here for the first time, after the writes it checks. P1 and P2 are A's only posts.
    const stats = await callWith(anyone, secret, 'GET', '/api/v1/social/me/stats');
    expect(stats.status, "A's stats").toBe(200);
    const listed = stats.body.posts as {
      postId: string;
      storyId: string;
      views: number;
      uniqueViews: number;
      replies: number;
      upvotes: number;
    }[];
    expect(
      listed.map((item) => item.postId),
      "A's stats list its posts, newest first",
    ).toEqual([p2, p1]);
    expect(listed[0], 'P2 in A’s stats').toMatchObject({
      storyId,
      views: 1,
      uniqueViews: 1,
      replies: 0,
      upvotes: 0,
    });
    expect(listed[1], 'P1 in A’s stats').toMatchObject({
      storyId,
      views: 2,
      uniqueViews: 2,
      replies: 0,
      upvotes: 0,
    });
    expect(stats.body.next, 'two posts are one page').toBeNull();
    const checkin = await callWith(anyone, secret, 'GET', '/api/v1/social/me/checkin');
    expect(checkin.status, "A's check-in").toBe(200);
    expect(checkin.body.stats, "A's check-in totals: two posts, three views").toEqual({
      posts: 2,
      views: 3,
      replies: 0,
      upvotes: 0,
      standing: expect.any(Number),
    });
    expect(
      (checkin.body.stats as { standing: number }).standing,
      "A's standing in its check-in is the one on its profile",
    ).toBe(standing);
    // P1's thread page, as D1 (already counted for P1 today, so this read adds no view).
    const thread = await d1.newPage();
    try {
      await thread.goto(threadAddress);
      await expect(thread.getByTestId('post-views'), "P1's views, on its thread page").toHaveText(
        '2 views (2 readers)',
      );
      // 11. The fit, on P1's thread page.
      await fitsEverywhere(thread, "P1's thread page, with its views");
    } finally {
      await thread.close();
    }

    // 10. Top on the desk: with views worth something P1 (2 views) is above P2 (1); with none, the newer P2 is first.
    const top = await call(anyone, 'GET', `/api/v1/social/stories/${storyId}/posts?sort=top`);
    expect(top.status, "the story's desk, Top").toBe(200);
    const topOrder = (top.body.posts as { id: string }[]).map((card) => card.id);
    const viewsWeight = Number(settings.body.topWViews);
    expect(topOrder, 'both posts are on the desk').toEqual(expect.arrayContaining([p1, p2]));
    if (viewsWeight > 0) {
      expect(topOrder.indexOf(p1), "Top: P1's two views lift it above P2's one").toBeLessThan(
        topOrder.indexOf(p2),
      );
    } else {
      expect(
        topOrder.indexOf(p2),
        'Top with no weight on views: the newer P2 is first',
      ).toBeLessThan(topOrder.indexOf(p1));
    }

    // 11. The fit, on S's desk: the story's tile, with its views, and both posts' cards (D1 is counted for S and P1
    // today; P2's view from this page is of no consequence, nothing is asserted after it).
    const deskPage = await d1.newPage();
    try {
      await deskPage.goto(`/sandbox/social/stories/${storyId}`);
      await expect(deskPage.getByTestId('story-tile'), "S's tile shows its views").toContainText(
        '1 view (1 reader)',
      );
      await expect(
        deskPage.getByTestId('post-card').filter({ hasText: WORDS.p1 }).getByTestId('post-views'),
        "P1's card on the desk",
      ).toHaveText('2 views (2 readers)');
      await fitsEverywhere(deskPage, "S's desk, with the tile's and the cards' views");
    } finally {
      await deskPage.close();
    }
  } finally {
    // 12. A's keys are revoked, whatever happened, so no key of the run stays live. A refusal fails the test after the
    // clean-up, without hiding what failed first.
    const revoked = await revokeAgentKeys(admin, noted, `The signals journey is over (${label})`);
    await Promise.all([
      admin.dispose(),
      anyone.dispose(),
      ...(owner ? [owner.as.dispose()] : []),
      ...devices.map((context) => context.close()),
    ]);
    if (revoked !== null) expect.soft(revoked, "the console revokes an agent's keys").toBe(200);
  }
});
