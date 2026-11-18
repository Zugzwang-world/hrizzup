import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT_STORY_IDS, KEPT_UPDATE_IDS } from '../../../lib/social/fixture-ids.ts';
import {
  ensureMediaDesk,
  MEDIA_FIXTURE_AGENT,
  MEDIA_FIXTURE_REQUESTS,
  MEDIA_FIXTURE_STORY,
  MEDIA_FIXTURE_UPDATE,
  mediaFixtures,
} from './media.ts';

/**
 * The media fixture (docs/social/media-design.md, section 8.3): an unlisted story with one update, an unlisted
 * agent of the console's own, and a desk of an image post, a video post and an audio post, made only through the
 * API, only where something is missing, with fixed request IDs, and a failure names a status and never an answer.
 * The site and the storage are stood in for; the files are the real samples.
 */

const CONTEXT = {
  baseURL: 'https://preview.example.test',
  headers: { 'x-vercel-protection-bypass': 'bypass-value', cookie: 'session=admin' },
};
const [story] = mediaFixtures;
const AGENT_ID = '5c0e0b11-0f00-4000-8000-0000000000a0';
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A made-up link: a real one holds a signature, which a test never needs.
const BUCKET = 'https://uploads.example.test/bucket';

type Sent = {
  method: string;
  where: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};
type Reply = [number, unknown?];

/**
 * A fake site and bucket. Each call is answered by the first of `queued` for its `METHOD path` (taken off the
 * list), else by what a working site answers: the story is not there, nor is the agent, the desk is empty, every
 * save and post goes through, every upload gets its link and its file is taken, every `done` is ready.
 */
function site(queued: Record<string, Reply[]> = {}) {
  const sent: Sent[] = [];
  let links = 0;
  const fake = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const url = new URL(String(input));
    const where =
      url.origin === new URL(CONTEXT.baseURL).origin
        ? url.pathname + url.search
        : url.origin + url.pathname;
    sent.push({
      method,
      where,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body:
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    const next = queued[`${method} ${url.pathname}`]?.shift();
    const [status, body] = next ?? defaults(method, url.pathname);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  function defaults(method: string, path: string): Reply {
    if (method === 'PUT') return [200];
    if (method === 'GET' && path.endsWith('/posts')) return [200, { posts: [] }];
    if (method === 'GET' && path.startsWith('/api/v1/social/agents/')) return [404, {}];
    // The console's own agents: none listed (the fixture agent is unlisted, and lists no more than that).
    if (method === 'GET' && path === '/api/v1/admin/social/house/agents') {
      return [200, { agents: [{ id: AGENT_ID, handle: MEDIA_FIXTURE_AGENT, listed: false }] }];
    }
    if (method === 'GET') return [404, {}];
    if (path === '/api/v1/admin/social/house/agents') {
      return [201, { id: AGENT_ID, handle: MEDIA_FIXTURE_AGENT, listed: false }];
    }
    if (path === '/api/v1/admin/social/uploads') {
      links += 1;
      return [
        201,
        {
          media: { id: `5c0e0b11-0f00-4000-8000-0000000000b${links}`, state: 'waiting' },
          uploadUrl: `${BUCKET}/${links}?X-Amz-Signature=made-up`,
          headers: { 'Content-Type': 'made-up', 'Content-Length': '1' },
        },
      ];
    }
    return [method === 'POST' && path.endsWith('/posts') ? 201 : 200, {}];
  }
  return { sent, fake };
}

afterEach(() => vi.unstubAllGlobals());

const writes = (sent: Sent[]) =>
  sent
    .filter((one) => one.method !== 'GET')
    .map((one) => `${one.method} ${one.where.split('?')[0]}`);
const world = (fake: ReturnType<typeof site>['fake']) => ({
  fetch: fake as unknown as typeof fetch,
  sleep: vi.fn(async () => undefined),
  now: () => 0,
});
const OTHER = { id: AGENT_ID, house: true, ownerName: null, retired: false };
const posted = (...kinds: string[]): Reply => [
  200,
  { posts: kinds.map((kind) => ({ kind, agent: { handle: MEDIA_FIXTURE_AGENT } })) },
];
const DESK = `GET /api/v1/social/stories/${MEDIA_FIXTURE_STORY}/posts`;
const AGENT = `GET /api/v1/social/agents/${MEDIA_FIXTURE_AGENT}`;

describe('the media fixture’s story', () => {
  it('has version 7 IDs of its own, kept by the console, and is not the market fixtures’ prefix', () => {
    expect(MEDIA_FIXTURE_STORY).toMatch(RECORD_ID);
    expect(MEDIA_FIXTURE_UPDATE).toMatch(RECORD_ID);
    expect(MEDIA_FIXTURE_STORY.startsWith('019a6c00-')).toBe(false);
    expect(KEPT_STORY_IDS.has(MEDIA_FIXTURE_STORY)).toBe(true);
    expect(KEPT_UPDATE_IDS.has(MEDIA_FIXTURE_UPDATE)).toBe(true);
  });

  it('is made unlisted, with its one update, when it is not there', async () => {
    const { sent, fake } = site();
    vi.stubGlobal('fetch', fake);
    await story?.ensure(CONTEXT);
    expect(sent.map((one) => `${one.method} ${one.where}`)).toEqual([
      `GET /api/v1/social/stories/${MEDIA_FIXTURE_STORY}`,
      'POST /api/v1/admin/social/stories',
      'POST /api/v1/admin/social/updates',
    ]);
    expect(sent[1]?.body).toMatchObject({ listed: false, record: { id: MEDIA_FIXTURE_STORY } });
    expect(sent[2]?.body?.record).toMatchObject({
      id: MEDIA_FIXTURE_UPDATE,
      story_id: MEDIA_FIXTURE_STORY,
    });
    // Fixed times in the past, so a second make sends the very same records.
    for (const one of sent.slice(1)) {
      const record = one.body?.record as { updated_at: string };
      expect(Date.parse(record.updated_at)).toBeLessThan(Date.now());
    }
    // Every request carries the admin's session and the bypass.
    expect(sent[1]?.headers.cookie).toBe('session=admin');
  });

  it('writes nothing when it and its update are there', async () => {
    const { sent, fake } = site({
      [`GET /api/v1/social/stories/${MEDIA_FIXTURE_STORY}`]: [
        [
          200,
          {
            state: 'live',
            listed: false,
            requestedId: null,
            updates: [{ id: MEDIA_FIXTURE_UPDATE }],
          },
        ],
      ],
    });
    vi.stubGlobal('fetch', fake);
    await story?.ensure(CONTEXT);
    expect(writes(sent)).toEqual([]);
  });

  it('refuses a story that is there but isn’t what it was made as, naming the status only', async () => {
    const { fake } = site({
      [`GET /api/v1/social/stories/${MEDIA_FIXTURE_STORY}`]: [
        [200, { state: 'live', listed: true, requestedId: null }],
      ],
    });
    vi.stubGlobal('fetch', fake);
    await expect(story?.ensure(CONTEXT)).rejects.toThrow(
      "The media fixture story isn't as it was made (200)",
    );
  });

  it('takes a save the database already has, and fails on any other refusal with its status', async () => {
    const same = site({
      'POST /api/v1/admin/social/updates': [[409, { data: { reason: 'stale_record' } }]],
    });
    vi.stubGlobal('fetch', same.fake);
    await expect(story?.ensure(CONTEXT)).resolves.toBeUndefined();
    const refused = site({ 'POST /api/v1/admin/social/stories': [[403, { message: 'secret' }]] });
    vi.stubGlobal('fetch', refused.fake);
    await expect(story?.ensure(CONTEXT)).rejects.toThrow(
      "Couldn't make the media fixture story (403)",
    );
  });
});

describe('the media fixture’s agent and desk', () => {
  it('make the agent unlisted, then an image post, a video post and an audio post, each file sent to its link', async () => {
    const { sent, fake } = site();
    await ensureMediaDesk(CONTEXT, world(fake));
    expect(sent.map((one) => `${one.method} ${one.where.split('?')[0]}`)).toEqual([
      AGENT,
      'POST /api/v1/admin/social/house/agents',
      `${DESK}`,
      // The picture: a link, the file, done, the post.
      'POST /api/v1/admin/social/uploads',
      `PUT ${BUCKET}/1`,
      'POST /api/v1/admin/social/uploads/5c0e0b11-0f00-4000-8000-0000000000b1/done',
      'POST /api/v1/admin/social/house/posts',
      // The video's still first, then the video, then its post.
      'POST /api/v1/admin/social/uploads',
      `PUT ${BUCKET}/2`,
      'POST /api/v1/admin/social/uploads/5c0e0b11-0f00-4000-8000-0000000000b2/done',
      'POST /api/v1/admin/social/uploads',
      `PUT ${BUCKET}/3`,
      'POST /api/v1/admin/social/uploads/5c0e0b11-0f00-4000-8000-0000000000b3/done',
      'POST /api/v1/admin/social/house/posts',
      // The audio reuses that still: only its own link, file and post.
      'POST /api/v1/admin/social/uploads',
      `PUT ${BUCKET}/4`,
      'POST /api/v1/admin/social/uploads/5c0e0b11-0f00-4000-8000-0000000000b4/done',
      'POST /api/v1/admin/social/house/posts',
    ]);
    const bodies = sent.filter((one) => one.method === 'POST').map((one) => one.body);
    expect(bodies[0]).toEqual({
      requestId: MEDIA_FIXTURE_REQUESTS.agent,
      handle: MEDIA_FIXTURE_AGENT,
      name: 'Screen check media',
      bio: expect.any(String),
      listed: false,
    });
    // Each upload is the console's own, for the fixture agent, of the kind and type its file is.
    const links = bodies.filter((body) => body && 'purpose' in body);
    expect(
      links.map((body) => [body?.kind, body?.contentType, body?.purpose, body?.agentId]),
    ).toEqual([
      ['image', 'image/png', 'console', AGENT_ID],
      ['image', 'image/png', 'console', AGENT_ID],
      ['video', 'video/mp4', 'console', AGENT_ID],
      ['audio', 'audio/mpeg', 'console', AGENT_ID],
    ]);
    // The video and the audio each name the one still image, and carry words.
    const dones = sent.filter((one) => one.where.endsWith('/done')).map((one) => one.body);
    expect(dones.map((body) => body?.requestId)).toEqual([
      MEDIA_FIXTURE_REQUESTS.image.done,
      MEDIA_FIXTURE_REQUESTS.still.done,
      MEDIA_FIXTURE_REQUESTS.video.done,
      MEDIA_FIXTURE_REQUESTS.audio.done,
    ]);
    expect(dones[2]).toMatchObject({ stillMediaId: '5c0e0b11-0f00-4000-8000-0000000000b2' });
    expect(dones[3]).toMatchObject({ stillMediaId: '5c0e0b11-0f00-4000-8000-0000000000b2' });
    expect(typeof dones[2]?.transcript).toBe('string');
    expect(typeof dones[0]?.description).toBe('string');
    const posts = bodies.filter((body) => body && 'storyId' in body);
    expect(
      posts.map((body) => [
        body?.requestId,
        body?.kind,
        body?.mediaId,
        body?.agentId,
        body?.storyId,
      ]),
    ).toEqual([
      [
        MEDIA_FIXTURE_REQUESTS.image.post,
        'image',
        '5c0e0b11-0f00-4000-8000-0000000000b1',
        AGENT_ID,
        MEDIA_FIXTURE_STORY,
      ],
      [
        MEDIA_FIXTURE_REQUESTS.video.post,
        'video',
        '5c0e0b11-0f00-4000-8000-0000000000b3',
        AGENT_ID,
        MEDIA_FIXTURE_STORY,
      ],
      [
        MEDIA_FIXTURE_REQUESTS.audio.post,
        'audio',
        '5c0e0b11-0f00-4000-8000-0000000000b4',
        AGENT_ID,
        MEDIA_FIXTURE_STORY,
      ],
    ]);
  });

  it('send each file to its link as the link says, and nothing of the admin’s session goes to the bucket', async () => {
    const { sent, fake } = site();
    await ensureMediaDesk(CONTEXT, world(fake));
    const puts = sent.filter((one) => one.method === 'PUT');
    expect(puts).toHaveLength(4);
    for (const put of puts) {
      expect(put.headers['content-type']).toBe('made-up');
      expect(put.headers.cookie).toBeUndefined();
      expect(put.headers['x-vercel-protection-bypass']).toBeUndefined();
    }
  });

  it('write nothing when the agent is there and the desk holds all three kinds', async () => {
    const { sent, fake } = site({
      [AGENT]: [[200, OTHER]],
      [DESK]: [posted('audio', 'video', 'image')],
    });
    await ensureMediaDesk(CONTEXT, world(fake));
    expect(writes(sent)).toEqual([]);
  });

  it('make only the kinds the desk lacks, in order, and take posts of other agents for nothing', async () => {
    const { sent, fake } = site({
      [AGENT]: [[200, OTHER]],
      [DESK]: [
        [
          200,
          {
            posts: [
              { kind: 'image', agent: { handle: MEDIA_FIXTURE_AGENT } },
              { kind: 'audio', agent: { handle: 'someone_else' } },
            ],
          },
        ],
      ],
    });
    await ensureMediaDesk(CONTEXT, world(fake));
    const kinds = sent
      .filter((one) => one.where === '/api/v1/admin/social/house/posts')
      .map((one) => one.body?.kind);
    expect(kinds).toEqual(['video', 'audio']);
    // The agent is only read (its public profile and the console's list), never made again.
    expect(
      sent.some(
        (one) => one.method === 'POST' && one.where === '/api/v1/admin/social/house/agents',
      ),
    ).toBe(false);
  });

  it('skip the file of a media that is already ready, and post it', async () => {
    const { sent, fake } = site({
      [AGENT]: [[200, OTHER]],
      [DESK]: [posted('video', 'audio')],
      'POST /api/v1/admin/social/uploads': [
        [201, { media: { id: '5c0e0b11-0f00-4000-8000-0000000000c1', state: 'ready' } }],
      ],
    });
    await ensureMediaDesk(CONTEXT, world(fake));
    expect(sent.filter((one) => one.method === 'PUT')).toHaveLength(0);
    expect(writes(sent)).toEqual([
      'POST /api/v1/admin/social/uploads',
      'POST /api/v1/admin/social/house/posts',
    ]);
  });

  it('wait and ask again when another run is checking the file (409) or the storage is busy (503), and give up after 90 seconds', async () => {
    const mine = site({
      'POST /api/v1/admin/social/uploads/5c0e0b11-0f00-4000-8000-0000000000b1/done': [
        [409, { data: { reason: 'media_checking' } }],
        [503, {}],
      ],
    });
    const waits = world(mine.fake);
    await ensureMediaDesk(CONTEXT, waits);
    expect(waits.sleep).toHaveBeenCalledTimes(2);
    expect(waits.sleep).toHaveBeenCalledWith(3_000);

    const stuck = site({
      'POST /api/v1/admin/social/uploads/5c0e0b11-0f00-4000-8000-0000000000b1/done': Array.from(
        { length: 100 },
        (): Reply => [409, {}],
      ),
    });
    let clock = 0;
    await expect(
      ensureMediaDesk(CONTEXT, {
        fetch: stuck.fake as unknown as typeof fetch,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow("The media fixture's picture wasn't made ready (409)");
  });

  it('find an agent that is there and refuse one that is a person’s, listed in no way a console agent is, or retired', async () => {
    for (const wrong of [
      { ...OTHER, house: false },
      { ...OTHER, ownerName: 'Someone' },
      { ...OTHER, retired: true },
    ]) {
      const { fake } = site({ [AGENT]: [[200, wrong]] });
      await expect(ensureMediaDesk(CONTEXT, world(fake))).rejects.toThrow(
        "The media fixture agent isn't as it was made (200)",
      );
    }
  });

  it('read the agent again when another run made it first (409), and refuse an agent made listed', async () => {
    const race = site({
      [AGENT]: [
        [404, {}],
        [200, OTHER],
      ],
      'POST /api/v1/admin/social/house/agents': [[409, { data: { reason: 'handle_taken' } }]],
      [DESK]: [posted('image', 'video', 'audio')],
    });
    await ensureMediaDesk(CONTEXT, world(race.fake));
    expect(writes(race.sent)).toEqual(['POST /api/v1/admin/social/house/agents']);

    const listed = site({
      'POST /api/v1/admin/social/house/agents': [[201, { id: AGENT_ID, listed: true }]],
    });
    await expect(ensureMediaDesk(CONTEXT, world(listed.fake))).rejects.toThrow(
      "The media fixture agent isn't as it was made (201)",
    );
  });

  it('read the console’s own agents when the agent is already there, and refuse one that is listed', async () => {
    const fine = site({ [AGENT]: [[200, OTHER]], [DESK]: [posted('image', 'video', 'audio')] });
    await ensureMediaDesk(CONTEXT, world(fine.fake));
    expect(fine.sent.map((one) => `${one.method} ${one.where}`)).toContain(
      'GET /api/v1/admin/social/house/agents',
    );
    expect(writes(fine.sent)).toEqual([]);

    const listed = site({
      [AGENT]: [[200, OTHER]],
      'GET /api/v1/admin/social/house/agents': [
        [
          200,
          {
            agents: [
              { id: 'another-agent', listed: true },
              { id: AGENT_ID, listed: true },
            ],
          },
        ],
      ],
    });
    await expect(ensureMediaDesk(CONTEXT, world(listed.fake))).rejects.toThrow(
      "The media fixture agent isn't as it was made (200)",
    );
    expect(writes(listed.sent)).toEqual([]);

    // A fixture agent that has dropped off the console's newest hundred is an unlisted one (listed agents come first).
    const dropped = site({
      [AGENT]: [[200, OTHER]],
      [DESK]: [posted('image', 'video', 'audio')],
      'GET /api/v1/admin/social/house/agents': [
        [200, { agents: [{ id: 'another-agent', listed: false }] }],
      ],
    });
    await expect(ensureMediaDesk(CONTEXT, world(dropped.fake))).resolves.toBeUndefined();

    const unread = site({
      [AGENT]: [[200, OTHER]],
      'GET /api/v1/admin/social/house/agents': [[500, { message: 'secret-text' }]],
    });
    await expect(ensureMediaDesk(CONTEXT, world(unread.fake))).rejects.toThrow(
      "Couldn't read the console's own agents (500)",
    );
  });

  it('refuse a media that was refused on an earlier run, naming what to raise, and never send its file again', async () => {
    const { sent, fake } = site({
      [AGENT]: [[200, OTHER]],
      'POST /api/v1/admin/social/uploads': [
        [201, { media: { id: '5c0e0b11-0f00-4000-8000-0000000000d1', state: 'refused' } }],
      ],
    });
    await expect(ensureMediaDesk(CONTEXT, world(fake))).rejects.toThrow(
      "The media fixture's picture was refused on an earlier run: raise the version of MEDIA_FIXTURE_REQUESTS",
    );
    expect(sent.filter((one) => one.method === 'PUT')).toHaveLength(0);
    expect(writes(sent)).toEqual(['POST /api/v1/admin/social/uploads']);
  });

  it('wait for an agent another run is making (a conflict or a busy site) and take it when it is there, but not for any other refusal', async () => {
    for (const refusal of [409, 503]) {
      const { sent, fake } = site({
        [AGENT]: [
          [404, {}],
          [404, {}],
          [200, OTHER],
        ],
        'POST /api/v1/admin/social/house/agents': [[refusal, { message: 'secret-text' }]],
        [DESK]: [posted('image', 'video', 'audio')],
      });
      const waits = world(fake);
      await ensureMediaDesk(CONTEXT, waits);
      expect(waits.sleep, `a ${refusal}`).toHaveBeenCalledTimes(1);
      expect(writes(sent)).toEqual(['POST /api/v1/admin/social/house/agents']);
    }
    // A refusal that no other run explains fails at once, with no waiting.
    const refused = site({ 'POST /api/v1/admin/social/house/agents': [[403, {}]] });
    const waits = world(refused.fake);
    await expect(ensureMediaDesk(CONTEXT, waits)).rejects.toThrow(
      "Couldn't make the media fixture agent (403)",
    );
    expect(waits.sleep).not.toHaveBeenCalled();
    // An agent that never appears: the patience ends after 90 seconds, naming the refusal.
    const never = site({
      [AGENT]: [[404, {}], ...Array.from({ length: 100 }, (): Reply => [404, {}])],
      'POST /api/v1/admin/social/house/agents': [[409, {}]],
    });
    let clock = 0;
    await expect(
      ensureMediaDesk(CONTEXT, {
        fetch: never.fake as unknown as typeof fetch,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow("Couldn't make the media fixture agent (409)");
    expect(clock).toBe(90_000);
  });

  it('take a post another run made at the same moment, found on the desk, and fail on a refusal nobody explains', async () => {
    const same = site({
      [AGENT]: [[200, OTHER]],
      // The desk has nothing when read first, the image post when read again.
      [DESK]: [posted(), posted('image'), posted('image', 'video', 'audio')],
      'POST /api/v1/admin/social/house/posts': [[409, { message: 'secret-text' }]],
    });
    const waits = world(same.fake);
    await ensureMediaDesk(CONTEXT, waits);
    expect(waits.sleep).not.toHaveBeenCalled();
    const posts = same.sent.filter((one) => one.where === '/api/v1/admin/social/house/posts');
    // The image post was refused and found; the video and the audio were posted as usual.
    expect(posts.map((one) => one.body?.kind)).toEqual(['image', 'video', 'audio']);

    // The post is not there at first (a pause), then it is.
    const later = site({
      [AGENT]: [[200, OTHER]],
      [DESK]: [posted(), posted(), posted('image'), posted('image', 'video', 'audio')],
      'POST /api/v1/admin/social/house/posts': [[503, {}]],
    });
    const pauses = world(later.fake);
    await ensureMediaDesk(CONTEXT, pauses);
    expect(pauses.sleep).toHaveBeenCalledTimes(1);

    // A post that never appears: the patience ends, naming the refusal.
    const stuck = site({
      [AGENT]: [[200, OTHER]],
      'POST /api/v1/admin/social/house/posts': [[409, {}]],
    });
    let clock = 0;
    await expect(
      ensureMediaDesk(CONTEXT, {
        fetch: stuck.fake as unknown as typeof fetch,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow("Couldn't make the media fixture's image post (409)");
    expect(clock).toBe(90_000);
  });

  it('name only a step and a status when something fails, never an answer', async () => {
    const answers: [string, Reply[], string][] = [
      [AGENT, [[500, { message: 'secret-text' }]], "Couldn't read the media fixture agent (500)"],
      [
        DESK,
        [[500, { message: 'secret-text' }]],
        "Couldn't read the media fixture story's desk (500)",
      ],
      [
        'POST /api/v1/admin/social/uploads',
        [[403, { message: 'secret-text' }]],
        "The media fixture's picture link answered 403",
      ],
      [
        'POST /api/v1/admin/social/house/posts',
        [[403, { message: 'secret-text' }]],
        "Couldn't make the media fixture's image post (403)",
      ],
    ];
    for (const [key, queue, message] of answers) {
      const { fake } = site({ [AGENT]: [[200, OTHER]], [key]: queue });
      const failure = await ensureMediaDesk(CONTEXT, world(fake)).catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(message);
      expect((failure as Error).message).not.toContain('secret-text');
    }
    // A PUT the bucket refuses names its status too.
    const { fake } = site({ [AGENT]: [[200, OTHER]], 'PUT /bucket/1': [[403]] });
    await expect(ensureMediaDesk(CONTEXT, world(fake))).rejects.toThrow(
      "The media fixture's picture didn't reach the bucket (403)",
    );
  });

  it('name a request that throws by its method and path, whatever the cookies it carried', async () => {
    const broken = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED cookie: session=admin');
    });
    const failure = await ensureMediaDesk(CONTEXT, world(broken as never)).catch((e: Error) => e);
    expect((failure as Error).message).toBe(
      `GET /api/v1/social/agents/${MEDIA_FIXTURE_AGENT} got no answer`,
    );
  });

  it('are made in the order the areas’ fixtures run: the story, then its desk', () => {
    expect(mediaFixtures.map((fixture) => fixture.name)).toEqual([
      "the media area's test story",
      "the media area's test story's desk",
    ]);
  });
});
