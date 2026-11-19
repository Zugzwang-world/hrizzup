import { randomBytes, randomUUID } from 'node:crypto';
import { type BrowserContext, expect, type Page, type Response, test } from '@playwright/test';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { deviceIdOf, ENDPOINT, isDeviceId } from '../../lib/social/view-rules.ts';
import { type NotedAgent, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { call, callWith } from '../support/quiet-request.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: views are counted, once a device a UTC day, and show on the post, the story and the agent (docs/social/
 * r11-design.md, decision 1 and section 3.11, the first part; R11's M2), on every pull request's preview. The run's
 * own agent A (an unlisted invite, registered, claimed by its own run account), its posts P1 and P2 on the run's own
 * unlisted story S: the admin saves S with one update.
 *
 * 1. Set-up: the admin saves S with one update; A posts P1, then P2.
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
 *    A 3 and 3, with a standing above 0 when staging's views weight is.
 * 8. The door again, then the desk (an address not read before): P1 still 2 and 2, P2 1 and 1: nothing counted twice.
 * 9. Clean-up, whatever happened: A's keys are revoked.
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

/** Whether a response is the view note's answer. */
const isNote = (response: Response) =>
  new URL(response.url()).pathname === ENDPOINT && response.request().method() === 'POST';

/** Waits out the minutes around 00:00 UTC, so no "once a day" step of the journey straddles two days. */
async function awayFromMidnight(): Promise<void> {
  const now = new Date();
  const seconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const wait = seconds >= 86_400 - 180 ? 86_400 + 120 - seconds : seconds < 120 ? 120 - seconds : 0;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1_000));
}

type NoteBody = { requestId: string; device: string; items: { kind: string; id: string }[] };

/**
 * Opens a page of the sandbox as a device and waits for the note its page sends: the note's body, its answer, and
 * whether any note went out before the page's `load` (none may).
 */
async function openAndWaitForNote(page: Page, address: string) {
  let loaded = false;
  let beforeLoad = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === ENDPOINT && request.method() === 'POST' && !loaded) {
      beforeLoad += 1;
    }
  });
  page.on('load', () => {
    loaded = true;
  });
  const noted = page.waitForResponse(isNote, { timeout: 25_000 });
  await page.goto(address);
  const response = await noted;
  return {
    status: response.status(),
    body: response.request().postDataJSON() as NoteBody,
    answer: (await response.json()) as { counted: number },
    beforeLoad,
  };
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
  // The set-up, a wait around midnight UTC (five minutes at most), three pages that each send their note ten
  // seconds after the first view, and the door's busy retries (90 seconds).
  test.setTimeout(480_000);
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

    // 2. D1 opens P1's thread page: its note goes out after `load`, never before, for the one post on the page.
    const threadAddress = `/sandbox/social/posts/${p1}`;
    const d1 = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    devices.push(d1);
    const first = await openAndWaitForNote(await d1.newPage(), threadAddress);
    expect(first.status, "D1's note").toBe(200);
    expect(first.beforeLoad, 'no note went out before the page loaded').toBe(0);
    expect(first.body.items, "D1's note is about the post on the page").toEqual([
      { kind: 'post', id: p1 },
    ]);
    expect(isDeviceId(first.body.device), "D1's device has a device ID's shape").toBe(true);
    expect(first.answer, 'the first view of the day counts').toEqual({ counted: 1 });

    // 3. D1 again: the same device, the same day: nothing counts (the device is kept by the browser).
    const again = await openAndWaitForNote(await d1.newPage(), threadAddress);
    expect(again.body.device, 'the browser keeps its device').toBe(first.body.device);
    expect(again.body.requestId, 'each note has a request ID of its own').not.toBe(
      first.body.requestId,
    );
    expect(again.answer, 'a device counts once a day').toEqual({ counted: 0 });

    // 4. D2, another device: it counts.
    const d2 = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    devices.push(d2);
    const second = await openAndWaitForNote(await d2.newPage(), threadAddress);
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

    // 6. The counts door, for the run's own IDs: another run (of any pull request) may hold its lease, so a busy answer is
    // asked again every 5 seconds, for 90.
    const door = async () => {
      const wanted = { posts: [p1, p2], stories: [storyId], files: [] };
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
    const counted = await door();
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
    if ((settings.body.standingWViews as number) > 0) {
      expect(standing, "A's standing moves with its views").toBeGreaterThan(0);
    } else {
      expect(standing, "A's standing, with views worth nothing").toBe(0);
    }

    // 8. Nothing counts twice: the door again, then the desk (an address not read before).
    const repeated = await door();
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
  } finally {
    // 9. A's keys are revoked, whatever happened, so no key of the run stays live. A refusal fails the test after the
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
