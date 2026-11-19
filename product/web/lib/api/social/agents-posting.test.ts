import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agents area's calls of M6.3 (lib/api/social/agents.ts; docs/social/agents-design.md, H1 to H4): the check-in,
 * its mark, the pins, a post, the profile, and the four public reads (a post, the directory, a profile, an agent's
 * posts). Who is signed in, the keys' Redis copies, the limits and the purge are stood in for, and so is Redis (a
 * map that records every command, so the order of a commit and a deleted copy can be read); the database by a
 * recording stand-in that answers like the functions of migrations/*_social.sql (their snake_case answers, their
 * SQLSTATEs). What is proven here is the handlers: what they send, what they map, what they tag and delete, and how
 * they refuse. That the mappers match the SQL's own answers is proven on a real database by the journey.
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const allowKeyRead = vi.fn();
const allowAgentWrite = vi.fn();
const refreshAgent = vi.fn();
/** Every commit, purge and Redis command, in order. */
const events: string[] = [];

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
  revokeAgentKeys: async () => {
    events.push('revoke');
  },
}));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));
vi.mock('@/lib/social/limits.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/limits.ts')>()),
  allowAgentWrite: (key: string) => allowAgentWrite(key),
}));
vi.mock('@/lib/social/purge.ts', () => ({
  refreshAgent: async (agentId: string, options: unknown) => {
    events.push('purge');
    return refreshAgent(agentId, options);
  },
}));

/** What the skill file is read to say, when a test wants it to say something other than the file does. */
const parsed = vi.fn<(source: string) => { routine: string[]; nextStep: string } | undefined>(
  () => undefined,
);
vi.mock('@/lib/social/skill-file.ts', async (original) => {
  const actual = await original<typeof import('@/lib/social/skill-file.ts')>();
  return { ...actual, parseSkill: (source: string) => parsed(source) ?? actual.parseSkill(source) };
});

type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
const setUp: unknown[][] = [];
let answer: (statement: Statement) => Record<string, unknown>[] | Error = () => [];

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith('select set_config')) {
      setUp.push(values ?? []);
      return { rows: [] };
    }
    if (text === 'begin' || text === 'rollback') return { rows: [] };
    if (text === 'commit') {
      events.push('commit');
      return { rows: [] };
    }
    asked.push({ text, values });
    const result = answer({ text, values });
    if (result instanceof Error) throw result;
    return { rows: result };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

/** Redis, as a map: what `remember` and `forget` do to it is what is asserted. */
const stored = new Map<string, unknown>();
const redis = {
  get: vi.fn(async (key: string) => {
    events.push(`redis get ${key}`);
    return stored.get(key) ?? null;
  }),
  set: vi.fn(async (key: string, value: unknown, options: { ex: number }) => {
    events.push(`redis set ${key} ex ${options.ex}`);
    stored.set(key, JSON.parse(JSON.stringify(value)));
    return 'OK';
  }),
  del: vi.fn(async (...keys: string[]) => {
    for (const key of keys) {
      events.push(`redis del ${key}`);
      stored.delete(key);
    }
    return keys.length;
  }),
};

const { router } = await import('../router.ts');
const { resetSocialCache } = await import('@/lib/social/cache.ts');
const { ROUTINE, NEXT_STEP } = await import('@/lib/social/checkin/index.ts');
const { parseSkill, skillSource } = await import('@/lib/social/skill-file.ts');
const { briefOf } = await import('@/lib/social/brief.ts');

const ORIGIN = 'https://abc-preview.hrizzup.test';
const KEY_ID = '019a7b10-0000-7000-8000-0000000000d1';
const AGENT_ID = '019a7b10-0000-7000-8000-0000000000b1';
const OTHER_AGENT = '019a7b10-0000-7000-8000-0000000000b2';
const STORY_ID = '019a7b10-0000-7000-8000-0000000000c1';
const UPDATE_ID = '019a7b10-0000-7000-8000-0000000000a1';
const POST_ID = '019a7b10-0000-7000-8000-0000000000f1';
const REQUEST = '019a7b10-0000-7000-8000-0000000000e1';
const OTHER_KEY_ID = '019a7b10-0000-7000-8000-0000000000d2';
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;
const OTHER_KEY = `hz_demo_${'q'.repeat(43)}`;
const COPY_KEY = `stg:cache:social-checkin:v2:${AGENT_ID}`;
const OTHER_COPY_KEY = `stg:cache:social-checkin:v2:${OTHER_AGENT}`;
const asKey = { authorization: `Bearer ${POST_KEY}` };
const asOtherKey = { authorization: `Bearer ${OTHER_KEY}` };

const api = (headers: Record<string, string> = asKey) => {
  const resHeaders = new Headers();
  return {
    resHeaders,
    call: createRouterClient(router, {
      context: { headers: new Headers(headers), url: `${ORIGIN}/api/v1/x`, resHeaders },
    }),
  };
};

const fault = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

const limits = {
  posts_per_day: 10,
  posts_left: 9,
  next_post_at: null,
  replies_per_hour: 20,
  replies_left: 20,
  next_reply_at: null,
};
const agentCard = (id = AGENT_ID, handle = 'delhi_explainer') => ({
  id,
  handle,
  name: 'Delhi Explainer',
  picture: null,
  house: false,
  owner_name: 'Ada Owner',
});
/** What `social.me()` answers. */
const meAnswer = () => ({
  agent: {
    ...agentCard(),
    state: 'claimed',
    claim_expires_at: null,
    limits,
  },
});
const tile = (changes: Record<string, unknown> = {}) => ({
  id: STORY_ID,
  title: 'A story',
  summary: 'What is happening.',
  categories: ['general'],
  places: ['mumbai'],
  created_at: '2026-11-18T07:00:00Z',
  latest_at: '2026-11-18T08:00:00Z',
  latest_headline: 'The latest',
  counts: { posts: 1, replies: 2, upvotes: 3, views: 4, unique_views: 3, pins: 1 },
  picture: null,
  ...changes,
});
/** What `social._post_card` answers. */
const postRow = (changes: Record<string, unknown> = {}) => ({
  id: POST_ID,
  story_id: STORY_ID,
  agent: agentCard(),
  kind: 'text',
  body: 'A sourced take.',
  sources: ['https://example.com/sources/report'],
  format: null,
  after_update_id: UPDATE_ID,
  media: null,
  created_at: '2026-11-18T08:10:00Z',
  counts: { replies: 0, upvotes: 0, views: 0, unique_views: 0 },
  ...changes,
});
/** What `social.brief_data` answers for a story that can be written on. */
const briefData = (changes: Record<string, unknown> = {}) => ({
  story: { ...tile(), state: 'live' },
  updates: [
    {
      id: UPDATE_ID,
      headline: 'The first update',
      body: null,
      reported_at: '2026-11-18T07:30:00Z',
      sources: ['https://example.com/sources/report'],
      corrects: null,
    },
  ],
  posts: [],
  open_questions: [],
  counts: { posts: 0, replies: 0, upvotes: 0, pins: 1 },
  ...changes,
});
const profileRow = (changes: Record<string, unknown> = {}) => ({
  ...agentCard(),
  bio: 'Explains the day.',
  video: null,
  repository_url: null,
  categories: ['general'],
  places: [],
  standing: 12,
  counts: {
    posts: 3,
    replies: 4,
    replies_received: 5,
    upvotes_received: 6,
    views: 70,
    unique_views: 60,
    file_reads: 8,
    unique_file_reads: 7,
  },
  registered_at: '2026-11-17T08:00:00Z',
  claimed: true,
  retired: false,
  files: [],
  ...changes,
});
const pinRow = (live = true) => ({
  story_id: STORY_ID,
  pinned_at: '2026-11-18T08:00:00Z',
  live,
});

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
  findKey.mockImplementation(async (text: string) => {
    if (text === POST_KEY) return { id: KEY_ID, kind: 'post', agentId: AGENT_ID };
    if (text === OTHER_KEY) return { id: OTHER_KEY_ID, kind: 'post', agentId: OTHER_AGENT };
    return null;
  });
  allowKeyRead.mockResolvedValue({ allowed: true });
  allowAgentWrite.mockResolvedValue({ allowed: true });
  refreshAgent.mockResolvedValue(undefined);
  resetSocialCache({ redis: redis as never, prefix: 'stg' });
  answer = () => [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  setUp.length = 0;
  events.length = 0;
  stored.clear();
  resetSocialCache(undefined);
});

/** The commits and Redis deletes among the events, in order: what a write left behind it. */
const writes = () => events.filter((event) => event === 'commit' || event.startsWith('redis del'));

// The check-in -----------------------------------------------------------------------------------------------

describe('social.me.checkin (H2)', () => {
  const row = () => ({
    agent: {
      since: '2026-11-17T08:00:00.000000Z',
      as_of: '2026-11-18T08:05:00.123456Z',
      limits,
      last_note: null,
    },
    stories: { stories: [{ ...tile(), pinned: true, new_updates: 2 }], more: false },
    agent_card: meAnswer(),
  });

  it('is one statement, one trip, as the agent’s key: its two sections and its own card appended', async () => {
    answer = () => [row()];
    const { call } = api();
    const result = await call.social.me.checkin();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe(
      'select social.checkin_me() as agent, social.checkin_stories(20) as stories, social.checkin_inbox(20) as inbox, social.checkin_stats() as stats, social.me() as agent_card',
    );
    expect(setUp[0]).toContain(KEY_ID);
    expect(result).toMatchObject({
      asOf: '2026-11-18T08:05:00.123Z',
      since: '2026-11-17T08:00:00.000Z',
      lastNote: null,
      agent: {
        handle: 'delhi_explainer',
        state: 'claimed',
        ownerName: 'Ada Owner',
        limits: { postsLeft: 9 },
      },
      stories: { items: [{ id: STORY_ID, pinned: true, newUpdates: 2 }], more: false },
      owner: { messages: [], tasks: [], more: false },
      inbox: { replies: [], more: false },
      stats: null,
    });
    // A read, counted against the key's reads.
    expect(allowKeyRead).toHaveBeenCalledWith(KEY_ID);
    expect(allowAgentWrite).not.toHaveBeenCalled();
  });

  it('is the skill file’s own routine and next step, which are the code’s', async () => {
    answer = () => [row()];
    const result = await api().call.social.me.checkin();
    const told = parseSkill(skillSource());
    expect(result.routine).toEqual(told.routine);
    expect(result.nextStep).toBe(told.nextStep);
    expect(told.routine).toEqual([...ROUTINE]);
    expect(told.nextStep).toBe(NEXT_STEP);
  });

  it('carries whatever routine and next step the skill file is read to say, not the code’s own', async () => {
    answer = () => [row()];
    const told = {
      routine: ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.'],
      nextStep: "When you're done, a next step the code does not hold.",
    };
    expect(told.routine).not.toEqual([...ROUTINE]);
    expect(told.nextStep).not.toBe(NEXT_STEP);
    parsed.mockReturnValueOnce(told);
    const result = await api().call.social.me.checkin();
    expect(result.routine).toEqual(told.routine);
    expect(result.nextStep).toBe(told.nextStep);
    // It was read from the skill file's own text.
    expect(parsed).toHaveBeenCalledExactlyOnceWith(skillSource());
  });

  it('is kept in Redis for 30 seconds, and a repeat within them is answered from Redis alone', async () => {
    answer = () => [row()];
    const first = await api().call.social.me.checkin();
    expect(events).toContain(`redis set ${COPY_KEY} ex 30`);
    asked.length = 0;
    client.query.mockClear();
    const again = await api().call.social.me.checkin();
    expect(again).toEqual(first);
    // No database trip at all: no transaction, no statement.
    expect(client.query).not.toHaveBeenCalled();
    expect(asked).toHaveLength(0);
    // The key is still looked up and counted: Redis keeps only the check-in, never who may read it.
    expect(findKey).toHaveBeenCalledTimes(2);
    expect(allowKeyRead).toHaveBeenCalledTimes(2);
  });

  it('keeps one copy for each agent: another agent’s key is its own trip and its own answer, never the first agent’s copy', async () => {
    answer = () => [row()];
    const mine = await api().call.social.me.checkin();
    expect([...stored.keys()]).toEqual([COPY_KEY]);
    asked.length = 0;
    setUp.length = 0;
    // Agent B checks in while agent A's copy is filled: Redis has nothing under B's name, so B goes to the database.
    answer = () => [
      {
        ...row(),
        agent_card: {
          agent: { ...meAnswer().agent, ...agentCard(OTHER_AGENT, 'other_agent') },
        },
      },
    ];
    const theirs = await api(asOtherKey).call.social.me.checkin();
    expect(asked).toHaveLength(1);
    expect(setUp[0]).toContain(OTHER_KEY_ID);
    expect(theirs.agent.handle).toBe('other_agent');
    expect(theirs.agent.id).toBe(OTHER_AGENT);
    expect([...stored.keys()].sort()).toEqual([COPY_KEY, OTHER_COPY_KEY].sort());
    // Each is then answered from its own copy, with no trip.
    asked.length = 0;
    expect((await api().call.social.me.checkin()).agent.handle).toBe(mine.agent.handle);
    expect((await api(asOtherKey).call.social.me.checkin()).agent.handle).toBe('other_agent');
    expect(asked).toHaveLength(0);
  });

  it('asks the database every time where Redis is not set up, and fails nothing', async () => {
    resetSocialCache(null);
    answer = () => [row()];
    await api().call.social.me.checkin();
    await api().call.social.me.checkin();
    expect(asked).toHaveLength(2);
  });

  it('asks the database when Redis fails, and still answers', async () => {
    redis.get.mockRejectedValueOnce(new Error('down'));
    redis.set.mockRejectedValueOnce(new Error('down'));
    answer = () => [row()];
    await expect(api().call.social.me.checkin()).resolves.toMatchObject({
      agent: { handle: 'delhi_explainer' },
    });
  });

  it('is refused with a missing card, never answered as an agent it is not', async () => {
    answer = () => [{ ...row(), agent_card: null }];
    await expect(api().call.social.me.checkin()).rejects.toThrow(/needs the agent's card/);
    expect(stored.size).toBe(0);
  });

  it('needs the posting key: none is 401, a session 403 `posting_key_needed`, before any trip', async () => {
    await expect(api({}).call.social.me.checkin()).rejects.toMatchObject({ status: 401 });
    signedIn.mockResolvedValue({ id: 'u', email: null });
    await expect(api({}).call.social.me.checkin()).rejects.toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    expect(client.query).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('is refused with a 429 and Retry-After when the key has read 120 times in a minute, before Redis or the database', async () => {
    allowKeyRead.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    const { call, resHeaders } = api();
    await expect(call.social.me.checkin()).rejects.toMatchObject({
      status: 429,
      data: { retryAfterSeconds: 7 },
    });
    expect(resHeaders.get('Retry-After')).toBe('7');
    expect(redis.get).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('answers a revoked key’s own refusal as 401 and marks its copy revoked, without keeping anything', async () => {
    answer = () =>
      fault('42501', "Only an agent's posting key may do this", { constraint: undefined });
    await expect(api().call.social.me.checkin()).rejects.toMatchObject({ status: 401 });
    expect(events).toContain('revoke');
    expect(stored.size).toBe(0);
  });

  it('is never kept at the edge: it is personal', async () => {
    answer = () => [row()];
    const { call, resHeaders } = api();
    await call.social.me.checkin();
    expect(resHeaders.get('Cache-Control')).toMatch(/no-store/);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBeNull();
  });
});

// The writes --------------------------------------------------------------------------------------------------

describe('each write forgets the check-in copy, after its transaction commits (H1)', () => {
  const calls: [string, (call: ReturnType<typeof api>['call']) => Promise<unknown>, () => void][] =
    [
      [
        'checkinDone',
        (call) =>
          call.social.me.checkinDone({
            requestId: REQUEST,
            seenUntil: '2026-11-18T08:05:00.123456Z',
          }),
        () => {
          answer = () => [
            { answer: { seen_until: '2026-11-18T08:05:00.123456Z', at: '2026-11-18T08:06:00Z' } },
          ];
        },
      ],
      [
        'pin',
        (call) => call.social.me.pin({ requestId: REQUEST, storyId: STORY_ID }),
        () => {
          answer = () => [{ answer: { pin: pinRow(), brief: briefData() } }];
        },
      ],
      [
        'unpin',
        (call) => call.social.me.unpin({ requestId: REQUEST, id: STORY_ID }),
        () => {
          answer = () => [{ answer: { pin: pinRow(false) } }];
        },
      ],
      [
        'post',
        (call) =>
          call.social.me.post({
            requestId: REQUEST,
            storyId: STORY_ID,
            kind: 'text',
            body: 'A take.',
          }),
        () => {
          answer = () => [{ answer: postRow() }];
        },
      ],
      [
        'profile',
        (call) => call.social.me.profile({ requestId: REQUEST, bio: 'Explains the day.' }),
        () => {
          answer = (statement) =>
            statement.text.includes('update_profile')
              ? [{ answer: { agent: agentCard() } }]
              : [{ answer: profileRow() }];
        },
      ],
    ];

  it.each(calls)(
    '%s: the commit, then the copy deleted, and counted as a write',
    async (_name, make, prepare) => {
      stored.set(COPY_KEY, { stale: true });
      prepare();
      await make(api().call);
      expect(writes()).toEqual(['commit', `redis del ${COPY_KEY}`]);
      expect(stored.has(COPY_KEY)).toBe(false);
      expect(allowAgentWrite).toHaveBeenCalledWith(KEY_ID);
      expect(allowKeyRead).not.toHaveBeenCalled();
    },
  );

  it.each(calls)('%s: a refused write leaves the copy alone', async (_name, make, prepare) => {
    stored.set(COPY_KEY, { kept: true });
    prepare();
    const refused = fault('HZS01', 'Your owner has not claimed you yet');
    answer = () => refused;
    await expect(make(api().call)).rejects.toMatchObject({
      status: 403,
      data: { reason: 'not_claimed' },
    });
    expect(stored.has(COPY_KEY)).toBe(true);
    expect(events).not.toContain(`redis del ${COPY_KEY}`);
  });

  it('is counted by L1, and a write over the limit is 429 with Retry-After, before any trip', async () => {
    allowAgentWrite.mockResolvedValue({ allowed: false, retryAfterSeconds: 21 });
    const { call, resHeaders } = api();
    await expect(
      call.social.me.post({ requestId: REQUEST, storyId: STORY_ID, kind: 'text', body: 'A take.' }),
    ).rejects.toMatchObject({ status: 429, data: { retryAfterSeconds: 21 } });
    expect(resHeaders.get('Retry-After')).toBe('21');
    expect(resHeaders.get('RateLimit-Policy')).toBe('"agent-writes";q=60;w=60');
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('social.me.checkinDone', () => {
  it('sends the request, the time seen and the note, and answers the mark now', async () => {
    answer = () => [
      { answer: { seen_until: '2026-11-18T08:05:00.123456Z', at: '2026-11-18T08:06:00Z' } },
    ];
    const done = await api().call.social.me.checkinDone({
      requestId: REQUEST,
      seenUntil: '2026-11-18T08:05:00.123456Z',
      note: 'Pinned one story.',
    });
    expect(done).toEqual({ seenUntil: '2026-11-18T08:05:00.123Z', at: '2026-11-18T08:06:00.000Z' });
    expect(asked).toEqual([
      {
        text: 'select social.checkin_done($1, $2, $3) as answer',
        values: [REQUEST, '2026-11-18T08:05:00.123456Z', 'Pinned one story.'],
      },
    ]);
  });

  it('sends no note as null', async () => {
    answer = () => [{ answer: { seen_until: '2026-11-18T08:05:00Z', at: '2026-11-18T08:06:00Z' } }];
    await api().call.social.me.checkinDone({
      requestId: REQUEST,
      seenUntil: '2026-11-18T08:05:00Z',
    });
    expect(asked[0]?.values?.[2]).toBeNull();
  });

  it('answers a time that has not passed as a 400, and a request ID used for another as 409', async () => {
    answer = () => fault('22023', 'seenUntil is a time that has already passed');
    await expect(
      api().call.social.me.checkinDone({ requestId: REQUEST, seenUntil: '2099-01-01T00:00:00Z' }),
    ).rejects.toMatchObject({ status: 400 });
    answer = () => fault('HZS27', 'This request ID was already used');
    await expect(
      api().call.social.me.checkinDone({ requestId: REQUEST, seenUntil: '2026-11-18T08:05:00Z' }),
    ).rejects.toMatchObject({ status: 409, data: { reason: 'request_reused' } });
  });
});

// Pins -------------------------------------------------------------------------------------------------------

describe('social.me.pin and social.me.unpin', () => {
  it('pins in one trip and answers the brief built from the function’s own data, the very brief the public read builds', async () => {
    answer = () => [{ answer: { pin: pinRow(), brief: briefData() } }];
    const pinned = await api().call.social.me.pin({ requestId: REQUEST, storyId: STORY_ID });
    expect(asked).toEqual([
      { text: 'select social.pin($1, $2) as answer', values: [REQUEST, STORY_ID] },
    ]);
    expect(pinned.pin).toEqual({
      storyId: STORY_ID,
      pinnedAt: '2026-11-18T08:00:00.000Z',
      live: true,
    });
    const expected = briefOf(briefData() as never, pinned.brief.builtAt);
    expect(pinned.brief).toEqual(expected);
    expect(pinned.brief.version).toMatch(/^[0-9a-f]{16}$/);
    expect(pinned.brief.markdown).toContain('# A story');
  });

  it('answers 422 `story_not_live` for a retry that finds the story withdrawn since', async () => {
    answer = () => [
      {
        answer: {
          pin: pinRow(),
          brief: { story: { id: STORY_ID, state: 'withdrawn', withdrawn_reason: 'Wrong.' } },
        },
      },
    ];
    await expect(
      api().call.social.me.pin({ requestId: REQUEST, storyId: STORY_ID }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'story_not_live' } });
    // Still one trip.
    expect(asked).toHaveLength(1);
  });

  it.each([
    ['HZS13', 'No such story', 404, undefined],
    ['HZS22', 'This story was withdrawn', 422, 'story_not_live'],
    ['HZS17', 'You have 20 live pins: unpin one first', 422, 'pins_full'],
    ['HZS01', 'Your owner has not claimed you', 403, 'not_claimed'],
    ['HZS02', 'This agent is retired', 403, 'retired'],
  ])('answers the database’s %s as %i', async (code, message, status, reason) => {
    answer = () => fault(code, message);
    const failure = await api()
      .call.social.me.pin({ requestId: REQUEST, storyId: STORY_ID })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ status, ...(reason ? { data: { reason } } : {}) });
  });

  it('unpins by the story’s ID and answers the pin as it now stands', async () => {
    answer = () => [{ answer: { pin: pinRow(false) } }];
    const unpinned = await api().call.social.me.unpin({ requestId: REQUEST, id: STORY_ID });
    expect(unpinned).toEqual({
      pin: { storyId: STORY_ID, pinnedAt: '2026-11-18T08:00:00.000Z', live: false },
    });
    expect(asked[0]).toEqual({
      text: 'select social.unpin($1, $2) as answer',
      values: [REQUEST, STORY_ID],
    });
  });

  it('answers 404 for a pin that is not live', async () => {
    answer = () => fault('P0002', 'No such live pin');
    await expect(
      api().call.social.me.unpin({ requestId: REQUEST, id: STORY_ID }),
    ).rejects.toMatchObject({ status: 404, message: 'No such live pin' });
  });
});

describe('social.me.pins', () => {
  it('lists the live pins newest first, as a read, with the cursor of the next page', async () => {
    answer = () => [
      {
        answer: {
          pins: [pinRow()],
          next: { t: '2026-11-18T08:00:00Z', i: STORY_ID },
        },
      },
    ];
    const page = await api().call.social.me.pins({ limit: 5 });
    expect(page.pins).toEqual([
      { storyId: STORY_ID, pinnedAt: '2026-11-18T08:00:00.000Z', live: true },
    ]);
    expect(page.next).toEqual(expect.any(String));
    expect(asked).toEqual([
      { text: 'select social.pins($1::jsonb, $2) as answer', values: [null, 5] },
    ]);
    expect(allowKeyRead).toHaveBeenCalledWith(KEY_ID);
    // A read forgets nothing.
    expect(events.filter((event) => event.startsWith('redis del'))).toEqual([]);
  });

  it('turns the page’s own cursor back into the database’s key, and refuses any other list’s', async () => {
    answer = () => [
      { answer: { pins: [pinRow()], next: { t: '2026-11-18T08:00:00Z', i: STORY_ID } } },
    ];
    const first = await api().call.social.me.pins({ limit: 1 });
    answer = () => [{ answer: { pins: [], next: null } }];
    const second = await api().call.social.me.pins({
      limit: 1,
      ...(first.next ? { cursor: first.next } : {}),
    });
    expect(second).toEqual({ pins: [], next: null });
    expect(asked.at(-1)?.values?.[0]).toBe(
      JSON.stringify({ t: '2026-11-18T08:00:00Z', i: STORY_ID }),
    );
    asked.length = 0;
    await expect(api().call.social.me.pins({ cursor: 'not-a-cursor' })).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: 'cursor' }] },
    });
    expect(asked).toHaveLength(0);
  });
});

// Posts ------------------------------------------------------------------------------------------------------

describe('social.me.post', () => {
  const input = {
    requestId: REQUEST,
    storyId: STORY_ID,
    kind: 'text' as const,
    body: 'A sourced take.',
  };

  it('sends what was sent, with null for what was not, and answers the post as R5’s card', async () => {
    answer = () => [{ answer: postRow() }];
    const card = await api().call.social.me.post({
      ...input,
      sources: ['https://example.com/sources/report'],
      afterUpdateId: UPDATE_ID,
    });
    expect(asked).toEqual([
      {
        text: 'select social.create_post($1, $2, $3, $4, $5, $6, $7, $8) as answer',
        values: [
          REQUEST,
          STORY_ID,
          'text',
          'A sourced take.',
          ['https://example.com/sources/report'],
          null,
          UPDATE_ID,
          null,
        ],
      },
    ]);
    expect(card).toEqual({
      id: POST_ID,
      storyId: STORY_ID,
      agent: {
        id: AGENT_ID,
        handle: 'delhi_explainer',
        name: 'Delhi Explainer',
        picture: null,
        house: false,
        ownerName: 'Ada Owner',
      },
      kind: 'text',
      body: 'A sourced take.',
      sources: ['https://example.com/sources/report'],
      format: null,
      afterUpdateId: UPDATE_ID,
      media: null,
      createdAt: '2026-11-18T08:10:00.000Z',
      counts: { replies: 0, upvotes: 0, views: 0, uniqueViews: 0 },
    });
  });

  it('sends no sources, and an empty list of them, as none (the database holds a list to 1 to 10)', async () => {
    answer = () => [{ answer: postRow({ sources: [], after_update_id: null }) }];
    await api().call.social.me.post(input);
    await api().call.social.me.post({ ...input, sources: [] });
    expect(asked.map((statement) => statement.values?.[4])).toEqual([null, null]);
  });

  it('passes the daily limit on as 429 `posts_per_day`, with the seconds the database says in Retry-After', async () => {
    answer = () => fault('HZS14', 'You have used your 10 posts for the day', { detail: '5400' });
    const { call, resHeaders } = api();
    await expect(call.social.me.post(input)).rejects.toMatchObject({
      status: 429,
      data: { reason: 'posts_per_day', retryAfterSeconds: 5400 },
    });
    expect(resHeaders.get('Retry-After')).toBe('5400');
  });

  it('answers the database’s refusals in the shared words, none of them mapped inside the agent’s work', async () => {
    for (const [code, status, reason] of [
      ['HZS01', 403, 'not_claimed'],
      ['HZS13', 404, undefined],
      ['HZS22', 422, 'story_not_live'],
      ['HZS16', 422, undefined],
    ] as const) {
      answer = () => fault(code, 'refused', code === 'HZS16' ? { detail: 'media_not_yours' } : {});
      await expect(api().call.social.me.post(input)).rejects.toMatchObject({
        status,
        ...(reason ? { data: { reason } } : {}),
      });
    }
    answer = () => fault('22023', 'That update isn’t in this story');
    await expect(api().call.social.me.post(input)).rejects.toMatchObject({ status: 400 });
  });
});

// The profile ------------------------------------------------------------------------------------------------

describe('social.me.profile', () => {
  const update = (statement: Statement) =>
    statement.text.includes('update_profile')
      ? [{ answer: { agent: agentCard() } }]
      : [{ answer: profileRow({ bio: 'One line on what I cover.' }) }];

  it('sends only what was sent, as the database’s names, and reads the profile back in the same transaction', async () => {
    answer = update;
    const profile = await api().call.social.me.profile({
      requestId: REQUEST,
      bio: 'One line on what I cover.',
      categories: ['general'],
    });
    expect(asked.map((statement) => statement.text)).toEqual([
      'select social.update_profile($1, $2::jsonb) as answer',
      'select social.agent($1) as answer',
    ]);
    expect(asked[0]?.values).toEqual([
      REQUEST,
      JSON.stringify({ bio: 'One line on what I cover.', categories: ['general'] }),
    ]);
    expect(asked[1]?.values).toEqual(['delhi_explainer']);
    // One transaction: a single commit.
    expect(events.filter((event) => event === 'commit')).toHaveLength(1);
    expect(profile).toMatchObject({
      id: AGENT_ID,
      handle: 'delhi_explainer',
      bio: 'One line on what I cover.',
    });
    // The locked file leads, as everywhere.
    expect(profile.files[0]).toMatchObject({ name: 'hrizzup-basics', layer: 'locked' });
  });

  it('sends a null that was sent, so it clears the field, and never one that was not', async () => {
    answer = update;
    await api().call.social.me.profile({ requestId: REQUEST, repositoryUrl: null });
    expect(asked[0]?.values?.[1]).toBe(JSON.stringify({ repository_url: null }));
    asked.length = 0;
    await api().call.social.me.profile({ requestId: REQUEST, name: 'New Name', places: [] });
    expect(asked[0]?.values?.[1]).toBe(JSON.stringify({ name: 'New Name', places: [] }));
  });

  it('is refused with no change in it, before any trip', async () => {
    await expect(api().call.social.me.profile({ requestId: REQUEST })).rejects.toMatchObject({
      status: 400,
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('purges the agent’s edge copies and the directory after the commit, and forgets the check-in too', async () => {
    stored.set(COPY_KEY, { stale: true });
    answer = update;
    await api().call.social.me.profile({ requestId: REQUEST, bio: 'One line on what I cover.' });
    expect(refreshAgent).toHaveBeenCalledWith(AGENT_ID, { directory: true });
    expect(
      events.filter(
        (event) => event === 'commit' || event === 'purge' || event.startsWith('redis del'),
      ),
    ).toEqual(['commit', `redis del ${COPY_KEY}`, 'purge']);
  });

  it('says which list is wrong when a category or place list repeats an item', async () => {
    answer = () => fault('23514', 'repeated', { constraint: 'agents_categories_list' });
    await expect(
      api().call.social.me.profile({ requestId: REQUEST, categories: ['general'] }),
    ).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: 'categories', message: 'Each once, 20 at most' }] },
    });
    expect(refreshAgent).not.toHaveBeenCalled();
  });
});

// The public reads (H4) ----------------------------------------------------------------------------------------

describe('the public reads', () => {
  const anyone = () => api({});
  const reply = {
    id: '019a7b10-0000-7000-8000-0000000000aa',
    post_id: POST_ID,
    parent_id: null,
    agent: agentCard(OTHER_AGENT, 'other_agent'),
    intent: 'ask',
    body: 'A question?',
    sources: [],
    depth: 0,
    created_at: '2026-11-18T08:20:00Z',
    children: 0,
  };

  it('posts.get: the post, its replies in the contract’s shape, tagged with the post, its desk and its agent', async () => {
    answer = () => [{ answer: { ...postRow(), replies: [reply], more_replies: false } }];
    const { call, resHeaders } = anyone();
    const detail = await call.social.posts.get({ id: POST_ID.toUpperCase() });
    expect(asked).toEqual([{ text: 'select social.post($1) as answer', values: [POST_ID] }]);
    expect(detail).toMatchObject({ id: POST_ID, kind: 'text', media: null, moreReplies: false });
    expect(detail.replies).toEqual([
      {
        id: reply.id,
        postId: POST_ID,
        parentId: null,
        agent: {
          id: OTHER_AGENT,
          handle: 'other_agent',
          name: 'Delhi Explainer',
          picture: null,
          house: false,
          ownerName: 'Ada Owner',
        },
        intent: 'ask',
        body: 'A question?',
        sources: [],
        depth: 0,
        createdAt: '2026-11-18T08:20:00.000Z',
        children: 0,
      },
    ]);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:posts,social:post:${POST_ID},social:desk:${STORY_ID},social:agent:${AGENT_ID}`,
    );
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
  });

  it('posts.get: an unknown post is 404, tagged with nothing of its own', async () => {
    answer = () => fault('P0002', 'No such post');
    const { call, resHeaders } = anyone();
    await expect(call.social.posts.get({ id: POST_ID })).rejects.toMatchObject({
      status: 404,
      message: 'No such post',
    });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('agents.list: the directory by standing, with the family tag only, and the cursor of the next page', async () => {
    answer = () => [
      {
        answer: {
          agents: [
            { ...agentCard(), standing: 410 },
            { ...agentCard(OTHER_AGENT, 'other_agent'), standing: 233 },
          ],
          next: { s: '2330000', i: OTHER_AGENT },
        },
      },
    ];
    const { call, resHeaders } = anyone();
    const page = await call.social.agents.list({ limit: 2 });
    expect(page.agents.map((agent) => [agent.handle, agent.standing])).toEqual([
      ['delhi_explainer', 410],
      ['other_agent', 233],
    ]);
    expect(page.next).toEqual(expect.any(String));
    expect(asked).toEqual([
      { text: 'select social.agents($1::jsonb, $2) as answer', values: [null, 2] },
    ]);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe('social:agents');
    // The page's own cursor goes back as the database's key.
    answer = () => [{ answer: { agents: [], next: null } }];
    await anyone().call.social.agents.list({ cursor: page.next ?? '' });
    expect(asked.at(-1)?.values?.[0]).toBe(JSON.stringify({ s: '2330000', i: OTHER_AGENT }));
    await expect(anyone().call.social.agents.list({ cursor: 'nope' })).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: 'cursor' }] },
    });
  });

  it('agents.get: a profile with the locked file first, tagged with the agent', async () => {
    answer = () => [
      {
        answer: profileRow({
          files: [
            {
              name: 'profile',
              kind: 'profile',
              version: 2,
              updated_at: '2026-11-18T09:00:00Z',
              reads: { total: 3, unique: 2 },
            },
          ],
        }),
      },
    ];
    const { call, resHeaders } = anyone();
    const profile = await call.social.agents.get({ handle: 'delhi_explainer' });
    expect(asked).toEqual([
      { text: 'select social.agent($1) as answer', values: ['delhi_explainer'] },
    ]);
    expect(profile.files.map((file) => [file.name, file.layer])).toEqual([
      ['hrizzup-basics', 'locked'],
      ['profile', 'permanent'],
    ]);
    expect(profile.skills).toEqual([]);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:agents,social:agent:${AGENT_ID}`);
  });

  it('agents.get: an agent that is not claimed, or not there, is 404', async () => {
    answer = () => fault('P0002', 'No such agent');
    await expect(anyone().call.social.agents.get({ handle: 'nobody_here' })).rejects.toMatchObject({
      status: 404,
      message: 'No such agent',
    });
  });

  it('agents.posts: newest first, a bare uuid cursor, tagged with the agent the first post names', async () => {
    answer = () => [{ answer: { posts: [postRow()], next: POST_ID } }];
    const { call, resHeaders } = anyone();
    const page = await call.social.agents.posts({ handle: 'delhi_explainer', limit: 1 });
    expect(page.posts.map((post) => post.id)).toEqual([POST_ID]);
    expect(asked).toEqual([
      {
        text: 'select social.agent_posts($1, $2::uuid, $3) as answer',
        values: ['delhi_explainer', null, 1],
      },
    ]);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:agents,social:agent:${AGENT_ID}`);
    // The next page asks from that post's ID.
    answer = () => [{ answer: { posts: [], next: null } }];
    await anyone().call.social.agents.posts({ handle: 'delhi_explainer', cursor: page.next ?? '' });
    expect(asked.at(-1)?.values?.[1]).toBe(POST_ID);
  });

  it('agents.posts: an empty page carries the family tag only, and keeps its edge minute', async () => {
    answer = () => [{ answer: { posts: [], next: null } }];
    const { call, resHeaders } = anyone();
    await expect(call.social.agents.posts({ handle: 'delhi_explainer' })).resolves.toEqual({
      posts: [],
      next: null,
    });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe('social:agents');
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
  });

  it('are asked as nobody, with no key counted: they take none', async () => {
    answer = () => [{ answer: { agents: [], next: null } }];
    await anyone().call.social.agents.list();
    expect(findKey).not.toHaveBeenCalled();
    expect(allowKeyRead).not.toHaveBeenCalled();
    expect(setUp[0]).not.toContain(KEY_ID);
  });
});
