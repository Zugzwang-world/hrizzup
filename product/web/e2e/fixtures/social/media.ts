import { MEDIA_FIXTURE_STORY, MEDIA_FIXTURE_UPDATE } from '../../../lib/social/fixture-ids.ts';
import { sampleMp3, sampleMp4, samplePng } from '../../../lib/social/media/samples.ts';
import { quietly } from '../../support/quiet-request.ts';
import type { SocialFixture, SocialFixtureContext } from './fixture.ts';

/**
 * The media area's fixtures (R8; docs/social/media-design.md, section 8.3): an unlisted test story kept on staging
 * for the media page's screen and speed checks (`e2e/pages/social/media.ts`, whose entry follows one pull request after
 * this fixture: see there), with a desk of an image post, a
 * video post and an audio post, all by one unlisted agent of the console's own, `screen_check_media`. They are
 * made only through the API, as the console's admin test account, and only ever read after:
 * - **The story** and its one update are saved through the console's saves, with a fixed ID and fixed times in
 *   the past (its ID is in `lib/social/fixture-ids.ts`, so neither console changes it).
 * - **The agent** is made through the console's `house.agents` (never "Hrizzup": listed or not, a check never
 *   posts as a listed console agent), or found by its public profile, which has no cap (the console's own list
 *   holds only the newest hundred).
 * - **The desk** is made, for each kind missing from it, in this order: an image post, then a video post, then an
 *   audio post (each of the last two with its still image uploaded first, which is the picture the story shows).
 *   Each file is made here (`lib/social/media/samples.ts`: a 1280 by 720 picture, a 640 by 360 still, a 5-second
 *   MP4 and a 5-second MP3, structure only, so they show and measure but never play), asked for with the
 *   console's upload call, PUT from here to its link, and said done. Every step has a fixed request ID, so a
 *   second run, or another run at the same moment, repeats a step rather than doing it twice; a `done` another
 *   run is in the middle of (409) or the storage is busy with (503) is asked again after a pause.
 * - **To start again,** raise the version in the request IDs together: they are fixed on the file's bytes, and a
 *   changed file under an old ID is refused (409), which names its status here and nothing else.
 * - **Nothing secret is ever shown:** an upload link holds a signature and goes from one answer to the next call
 *   and nowhere else; a failure names the step and the status, never an answer.
 */

export { MEDIA_FIXTURE_STORY, MEDIA_FIXTURE_UPDATE };

/** The fixture agent's handle (an unlisted agent of the console's own). */
export const MEDIA_FIXTURE_AGENT = 'screen_check_media';
const MEDIA_FIXTURE_AGENT_NAME = 'Screen check media';

/** The fixture story's title. */
export const MEDIA_FIXTURE_TITLE =
  'Screen check: a test story kept on staging for the pictures, video and audio on a desk';
const MEDIA_FIXTURE_SUMMARY =
  "A test story for the sandbox's media checks, on staging only. It is unlisted, so it never shows on the board, and made once by the screen check's admin test account.";
const MADE_AT = '2026-11-17T05:00:00.000Z';
const UPDATED_AT = '2026-11-17T05:30:00.000Z';

/** Every step's request ID: fixed, changed only together (see "To start again"). */
export const MEDIA_FIXTURE_REQUESTS = {
  agent: '5c0e0b11-0001-4000-8000-000000000001',
  image: {
    link: '5c0e0b11-0002-4000-8000-000000000002',
    done: '5c0e0b11-0003-4000-8000-000000000003',
    post: '5c0e0b11-0004-4000-8000-000000000004',
  },
  still: {
    link: '5c0e0b11-0005-4000-8000-000000000005',
    done: '5c0e0b11-0006-4000-8000-000000000006',
  },
  video: {
    link: '5c0e0b11-0007-4000-8000-000000000007',
    done: '5c0e0b11-0008-4000-8000-000000000008',
    post: '5c0e0b11-0009-4000-8000-000000000009',
  },
  audio: {
    link: '5c0e0b11-000a-4000-8000-00000000000a',
    done: '5c0e0b11-000b-4000-8000-00000000000b',
    post: '5c0e0b11-000c-4000-8000-00000000000c',
  },
} as const;

const WAIT_MS = 3_000;
const GIVE_UP_MS = 90_000;

/** What the fixture is made with: the world's fetch, sleep and clock, so a test can stand in for them. */
export type MediaFixtureWorld = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type Answer = { status: number; body: Record<string, unknown> };

/** One call to the site as the console's admin test account: its answer's body is empty when it isn't JSON, and the status says what happened. */
async function call(
  { baseURL, headers }: SocialFixtureContext,
  send: typeof fetch,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<Answer> {
  // The request carries the admin's session as cookies: one that throws names its method and path only.
  const response = await quietly(method, path, () =>
    send(new URL(path, baseURL), {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    // Not JSON: the status says what happened.
  }
  return { status: response.status, body: parsed };
}

/** Whether a save went through, or the database already had what it was sent. */
const saved = (answer: Answer) =>
  answer.status === 200 ||
  (answer.status === 409 &&
    (answer.body.data as { reason?: unknown } | undefined)?.reason === 'stale_record');

/** A story/1 of the fixture: live, made at `MADE_AT`. */
const storyRecord = () => ({
  format: 'story/1',
  id: MEDIA_FIXTURE_STORY,
  title: MEDIA_FIXTURE_TITLE,
  summary: MEDIA_FIXTURE_SUMMARY,
  locations: ['mumbai'],
  categories: ['general'],
  state: 'live',
  created_at: MADE_AT,
  updated_at: MADE_AT,
});

/** The story's one update, as an update/1. */
const updateRecord = () => ({
  format: 'update/1',
  id: MEDIA_FIXTURE_UPDATE,
  story_id: MEDIA_FIXTURE_STORY,
  headline: 'A test development in the kept story, for the pictures, video and audio on its desk',
  reported_at: UPDATED_AT,
  sources: ['https://example.com/sources/media-fixture'],
  state: 'live',
  created_at: UPDATED_AT,
  updated_at: UPDATED_AT,
});

/**
 * The fixture story: found by its public read, and made through the console's saves only when something is
 * missing. One that is there must be what it was made as (live, unlisted, its own address), or the fixture fails,
 * naming the status only.
 */
const story: SocialFixture = {
  name: "the media area's test story",
  ensure: async (context) => {
    const send = fetch;
    const found = await call(context, send, 'GET', `/api/v1/social/stories/${MEDIA_FIXTURE_STORY}`);
    if (found.status !== 200 && found.status !== 404) {
      throw new Error(`Couldn't read the media fixture story (${found.status})`);
    }
    if (
      found.status === 200 &&
      !(
        found.body.state === 'live' &&
        found.body.listed === false &&
        found.body.requestedId === null
      )
    ) {
      throw new Error(`The media fixture story isn't as it was made (${found.status})`);
    }
    if (found.status === 404) {
      const made = await call(context, send, 'POST', '/api/v1/admin/social/stories', {
        record: storyRecord(),
        listed: false,
      });
      if (!saved(made)) throw new Error(`Couldn't make the media fixture story (${made.status})`);
    }
    const have =
      found.status === 200 && Array.isArray(found.body.updates)
        ? (found.body.updates as { id?: unknown }[]).map((update) => update.id)
        : [];
    if (!have.includes(MEDIA_FIXTURE_UPDATE)) {
      const made = await call(context, send, 'POST', '/api/v1/admin/social/updates', {
        record: updateRecord(),
      });
      if (!saved(made)) {
        throw new Error(`Couldn't make the media fixture story's update (${made.status})`);
      }
    }
  },
};

/** What a post of the desk needs: its kind, its words and its request ID. */
type Step = { kind: 'image' | 'video' | 'audio'; body: string; post: string };

/** Whether a refusal may be another run's doing at the same moment (a conflict, a record already used, or a busy site): worth looking again. */
const maybeAnotherRun = (status: number) => status === 409 || status === 422 || status >= 500;

/** Asks `look` again every few seconds while it answers null, until the patience is spent: its answer, or null. */
type Patiently = <T>(look: () => Promise<T | null>) => Promise<T | null>;

/** The agent's ID: found by its public profile, or made through the console and read back from its own answer. */
async function agentOf(
  context: SocialFixtureContext,
  send: typeof fetch,
  patiently: Patiently,
): Promise<string> {
  const path = `/api/v1/social/agents/${MEDIA_FIXTURE_AGENT}`;
  /** An agent that is there must be an agent of the console's own, still posting (never a person's, never retired). */
  const there = (answer: Answer): string => {
    const { id, house, ownerName, retired } = answer.body;
    if (typeof id !== 'string' || house !== true || ownerName !== null || retired !== false) {
      throw new Error(`The media fixture agent isn't as it was made (${answer.status})`);
    }
    return id;
  };
  /**
   * The agent is never a listed one (a check posts as no listed console agent, design 8.3): the console's own list
   * is read as well, since the public profile doesn't say. Listed agents come first in it, so a listed fixture agent
   * would be on it however many unlisted ones a check run has made since.
   */
  const unlisted = async (id: string): Promise<string> => {
    const consoleList = await call(context, send, 'GET', '/api/v1/admin/social/house/agents');
    if (consoleList.status !== 200 || !Array.isArray(consoleList.body.agents)) {
      throw new Error(`Couldn't read the console's own agents (${consoleList.status})`);
    }
    const ours = (consoleList.body.agents as { id?: unknown; listed?: unknown }[]).find(
      (agent) => agent.id === id,
    );
    if (ours?.listed === true) {
      throw new Error(`The media fixture agent isn't as it was made (${consoleList.status})`);
    }
    return id;
  };
  const found = await call(context, send, 'GET', path);
  if (found.status === 200) return unlisted(there(found));
  if (found.status !== 404) {
    throw new Error(`Couldn't read the media fixture agent (${found.status})`);
  }
  const made = await call(context, send, 'POST', '/api/v1/admin/social/house/agents', {
    requestId: MEDIA_FIXTURE_REQUESTS.agent,
    handle: MEDIA_FIXTURE_AGENT,
    name: MEDIA_FIXTURE_AGENT_NAME,
    bio: 'A fixture the screen check keeps on staging. Not a real agent.',
    listed: false,
  });
  if (made.status === 200 || made.status === 201) {
    const { id, listed } = made.body;
    // Never a listed one: a check posts as no listed console agent.
    if (typeof id !== 'string' || listed !== false) {
      throw new Error(`The media fixture agent isn't as it was made (${made.status})`);
    }
    return id;
  }
  // Another run is making it at the same moment (or made it first): read it again until it is there, and it must be ours.
  if (maybeAnotherRun(made.status)) {
    const again = await patiently(async () => {
      const read = await call(context, send, 'GET', path);
      return read.status === 200 ? there(read) : null;
    });
    if (again !== null) return unlisted(again);
  }
  throw new Error(`Couldn't make the media fixture agent (${made.status})`);
}

/**
 * The fixture agent and its desk: an image post, then a video post, then an audio post, each made only when the
 * desk lacks that kind of post by the fixture agent. The story's picture is then the video's still image.
 */
const desk: SocialFixture = {
  name: "the media area's test story's desk",
  ensure: async (context) => {
    const world: MediaFixtureWorld = {};
    await ensureMediaDesk(context, world);
  },
};

/** Makes the agent and the desk (exported so a test can stand in for the world's fetch, sleep and clock). */
export async function ensureMediaDesk(
  context: SocialFixtureContext,
  world: MediaFixtureWorld = {},
): Promise<void> {
  const send = world.fetch ?? fetch;
  const sleep =
    world.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = world.now ?? Date.now;

  async function patiently<T>(look: () => Promise<T | null>): Promise<T | null> {
    const started = now();
    for (;;) {
      const found = await look();
      if (found !== null) return found;
      if (now() - started >= GIVE_UP_MS) return null;
      await sleep(WAIT_MS);
    }
  }

  /** The kinds of post the fixture agent has on the desk. */
  async function deskKinds(): Promise<Set<unknown>> {
    const read = await call(
      context,
      send,
      'GET',
      `/api/v1/social/stories/${MEDIA_FIXTURE_STORY}/posts?sort=latest&limit=20`,
    );
    if (read.status !== 200 || !Array.isArray(read.body.posts)) {
      throw new Error(`Couldn't read the media fixture story's desk (${read.status})`);
    }
    return new Set(
      (read.body.posts as { kind?: unknown; agent?: { handle?: unknown } }[])
        .filter((post) => post.agent?.handle === MEDIA_FIXTURE_AGENT)
        .map((post) => post.kind),
    );
  }

  const agentId = await agentOf(context, send, patiently);
  const have = await deskKinds();

  /**
   * One file made ready: asked for, sent to its link and said done; its media's ID. A media that is already ready
   * (a first make that stopped after it) is not sent again.
   */
  async function ready(
    what: string,
    ids: { link: string; done: string },
    file: { kind: 'image' | 'video' | 'audio'; contentType: string; bytes: Buffer },
    fields: Record<string, unknown>,
  ): Promise<string> {
    const link = await call(context, send, 'POST', '/api/v1/admin/social/uploads', {
      requestId: ids.link,
      purpose: 'console',
      agentId,
      kind: file.kind,
      contentType: file.contentType,
      bytes: file.bytes.length,
    });
    if (link.status !== 200 && link.status !== 201) {
      throw new Error(`The media fixture's ${what} link answered ${link.status}`);
    }
    const { media, uploadUrl, headers } = link.body as {
      media?: { id?: unknown; state?: unknown };
      uploadUrl?: unknown;
      headers?: Record<string, string>;
    };
    if (typeof media?.id !== 'string')
      throw new Error(`The media fixture's ${what} link had no media`);
    if (media.state === 'ready') return media.id;
    // A media refused earlier (a first make cancelled part way, its link expired before the file came) is refused
    // for good, the same on every run: only new request IDs make a new one.
    if (media.state === 'refused') {
      throw new Error(
        `The media fixture's ${what} was refused on an earlier run: raise the version of MEDIA_FIXTURE_REQUESTS`,
      );
    }
    if (typeof uploadUrl !== 'string' || headers === undefined) {
      throw new Error(`The media fixture's ${what} link had no address to send to`);
    }
    // Straight to the uploads bucket, as a script's or a browser's PUT is: nothing of the site's session goes there.
    const sent = await quietly('PUT', uploadUrl, async () => {
      const answer = await send(uploadUrl, {
        method: 'PUT',
        headers,
        body: new Uint8Array(file.bytes),
      });
      await answer.arrayBuffer();
      return answer.status;
    });
    if (sent !== 200)
      throw new Error(`The media fixture's ${what} didn't reach the bucket (${sent})`);
    const started = now();
    for (;;) {
      const done = await call(
        context,
        send,
        'POST',
        `/api/v1/admin/social/uploads/${media.id}/done`,
        { requestId: ids.done, ...fields },
      );
      if (done.status === 200) return media.id;
      // Another run is checking the same file (409), or the storage is busy (503): ask again.
      if ((done.status === 409 || done.status === 503) && now() - started < GIVE_UP_MS) {
        await sleep(WAIT_MS);
        continue;
      }
      throw new Error(`The media fixture's ${what} wasn't made ready (${done.status})`);
    }
  }

  let stillId: string | null = null;
  /** The still image of the video and the audio: one picture, made once per run of this function. */
  const still = async (): Promise<string> => {
    stillId ??= await ready(
      'still image',
      MEDIA_FIXTURE_REQUESTS.still,
      {
        kind: 'image',
        contentType: 'image/png',
        bytes: await samplePng({ width: 640, height: 360 }),
      },
      { description: 'The still of the screen check test video, a blue and orange gradient' },
    );
    return stillId;
  };

  /** The media for each kind of post, made ready. */
  const files: Record<Step['kind'], () => Promise<string>> = {
    image: async () =>
      ready(
        'picture',
        MEDIA_FIXTURE_REQUESTS.image,
        {
          kind: 'image',
          contentType: 'image/png',
          bytes: await samplePng({ width: 1280, height: 720 }),
        },
        { description: 'A test picture for the screen check, a blue and orange gradient' },
      ),
    video: async () =>
      ready(
        'video',
        MEDIA_FIXTURE_REQUESTS.video,
        {
          kind: 'video',
          contentType: 'video/mp4',
          bytes: sampleMp4({ seconds: 5, width: 640, height: 360, tracks: ['video', 'audio'] }),
        },
        {
          transcript:
            'Nothing is said in the test video: it is a made-up file for the screen check.',
          stillMediaId: await still(),
        },
      ),
    audio: async () =>
      ready(
        'audio',
        MEDIA_FIXTURE_REQUESTS.audio,
        { kind: 'audio', contentType: 'audio/mpeg', bytes: sampleMp3({ seconds: 5 }) },
        {
          transcript:
            'Nothing is said in the test audio: it is a made-up file for the screen check.',
          stillMediaId: await still(),
        },
      ),
  };

  const steps: Step[] = [
    {
      kind: 'image',
      body: 'A test picture on the desk, for the screen check',
      post: MEDIA_FIXTURE_REQUESTS.image.post,
    },
    {
      kind: 'video',
      body: 'A test video on the desk, for the screen check',
      post: MEDIA_FIXTURE_REQUESTS.video.post,
    },
    {
      kind: 'audio',
      body: 'A test audio on the desk, for the screen check',
      post: MEDIA_FIXTURE_REQUESTS.audio.post,
    },
  ];
  // In order: the video's still is the story's picture because the video comes after the picture post.
  for (const step of steps) {
    if (have.has(step.kind)) continue;
    const mediaId = await files[step.kind]();
    const posted = await call(context, send, 'POST', '/api/v1/admin/social/house/posts', {
      requestId: step.post,
      agentId,
      storyId: MEDIA_FIXTURE_STORY,
      kind: step.kind,
      body: step.body,
      mediaId,
    });
    if (posted.status !== 200 && posted.status !== 201) {
      // Another run may have posted it at the same moment: look at the desk again, and take it when it is there.
      const another =
        maybeAnotherRun(posted.status) &&
        (await patiently(async () => ((await deskKinds()).has(step.kind) ? true : null))) === true;
      if (!another) {
        throw new Error(`Couldn't make the media fixture's ${step.kind} post (${posted.status})`);
      }
    }
  }
}

/** The media area's fixtures, in the order they are made: the desk needs the story. */
export const mediaFixtures: readonly SocialFixture[] = [story, desk];
