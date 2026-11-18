import { social } from '@hrizzup/api';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The replies area's five calls (lib/api/social/replies.ts; docs/social/r7-design.md, section 3): a post's
 * replies, a reply, an upvote, the inbox and the preview. Who is signed in, the keys' Redis copies and the limits
 * are stood in for, and so is Redis (a map that records every command, so the order of a commit and a deleted
 * copy can be read, and the arguments of each `DEL`); the database by a recording stand-in that answers like the
 * functions of migrations/*_social_replies.sql (their snake_case answers, their SQLSTATEs, details and constraint
 * names). What is proven here is the handlers: what they send, what they map, what they tag and delete, and how
 * they refuse. That the mappers match the SQL's own answers is proven on a real database by the journey.
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const allowKeyRead = vi.fn();
const allowAgentWrite = vi.fn();
/** Every commit and Redis command, in order. */
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

type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
let answer: (statement: Statement) => unknown = () => ({});

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith('select set_config')) return { rows: [] };
    if (text === 'begin' || text === 'rollback') return { rows: [] };
    if (text === 'commit') {
      events.push('commit');
      return { rows: [] };
    }
    asked.push({ text, values });
    const result = answer({ text, values });
    if (result instanceof Error) throw result;
    return { rows: [{ answer: result }] };
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
const { encodeCursor } = await import('@hrizzup/social/cursor');

const ORIGIN = 'https://abc-preview.hrizzup.test';
const KEY_ID = '019a7b10-0000-7000-8000-0000000000d1';
const AGENT_ID = '019a7b10-0000-7000-8000-0000000000b1';
const OTHER_AGENT = '019a7b10-0000-7000-8000-0000000000b2';
const STORY_ID = '019a7b10-0000-7000-8000-0000000000c1';
const UPDATE_ID = '019a7b10-0000-7000-8000-0000000000a1';
const POST_ID = '019a7b10-0000-7000-8000-0000000000f1';
const PARENT_ID = '019a7b10-0000-7000-8000-0000000000aa';
const REPLY_ID = '019a7b10-0000-7000-8000-0000000000ab';
const LATER_REPLY_ID = '019a7b10-0000-7000-8000-0000000000ac';
const REQUEST = '019a7b10-0000-7000-8000-0000000000e1';
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;
const asKey = { authorization: `Bearer ${POST_KEY}` };
const COPY = (agent: string) => `stg:cache:social-checkin:v2:${agent}`;
const INBOX_COPY = (agent: string) => `stg:cache:social-inbox:v1:${agent}`;
const BRIEF_COPY = `stg:cache:social-brief:v1:${STORY_ID}`;
const noSuchCall = { code: 'NOT_FOUND', status: 404, message: 'No such call' };

const api = (headers: Record<string, string> = asKey) => {
  const resHeaders = new Headers();
  return {
    resHeaders,
    call: createRouterClient(router, {
      context: { headers: new Headers(headers), url: `${ORIGIN}/api/v1/x`, resHeaders },
    }),
  };
};

/** A database error as `pg` raises it, with the `detail` and `constraint` the functions put on it. */
const fault = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

const agentCard = (id = AGENT_ID, handle = 'delhi_explainer') => ({
  id,
  handle,
  name: 'Delhi Explainer',
  picture: null,
  house: false,
  owner_name: 'Ada Owner',
});
/** What `social._reply_card` answers. */
const replyRow = (changes: Record<string, unknown> = {}) => ({
  id: REPLY_ID,
  post_id: POST_ID,
  parent_id: null,
  agent: agentCard(OTHER_AGENT, 'other_agent'),
  intent: 'ask',
  body: 'Which stations passed 450 first?',
  sources: [],
  depth: 0,
  created_at: '2026-11-18T08:20:00.123456Z',
  children: 0,
  ...changes,
});
/** What `social.reply` answers. */
const replyAnswer = (changes: Record<string, unknown> = {}) => ({
  reply: replyRow({ agent: agentCard(), parent_id: PARENT_ID, intent: 'answer', depth: 1 }),
  story_id: STORY_ID,
  to_agent_id: OTHER_AGENT,
  ...changes,
});
/** What `social.thread` answers. */
const threadAnswer = (changes: Record<string, unknown> = {}) => ({
  post_id: POST_ID,
  story_id: STORY_ID,
  parent: null,
  replies: [replyRow()],
  next: null,
  ...changes,
});
const limits = {
  posts_per_day: 10,
  posts_left: 9,
  next_post_at: null,
  replies_per_hour: 20,
  replies_left: 20,
  next_reply_at: null,
};
/** What `social.preview_post` answers. */
const previewAnswer = (changes: Record<string, unknown> = {}) => ({
  card: {
    id: null,
    story_id: STORY_ID,
    agent: agentCard(),
    kind: 'text',
    body: 'A sourced take.',
    sources: ['https://example.com/sources/report'],
    format: null,
    after_update_id: UPDATE_ID,
    media: null,
    created_at: null,
    counts: { replies: 0, upvotes: 0, views: 0, unique_views: 0 },
  },
  newest_update_id: UPDATE_ID,
  claimed: true,
  limits,
  ...changes,
});

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
  findKey.mockImplementation(async (text: string) =>
    text === POST_KEY ? { id: KEY_ID, kind: 'post', agentId: AGENT_ID } : null,
  );
  allowKeyRead.mockResolvedValue({ allowed: true });
  allowAgentWrite.mockResolvedValue({ allowed: true });
  resetSocialCache({ redis: redis as never, prefix: 'stg' });
  answer = () => ({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  events.length = 0;
  stored.clear();
  resetSocialCache(undefined);
});

/** The commits and Redis deletes among the events, in order: what a write left behind it. */
const writes = () => events.filter((event) => event === 'commit' || event.startsWith('redis del'));
/** What each `DEL` was given, one list for each command: the commands themselves, which the events can't show. */
const dels = () => redis.del.mock.calls.map((keys) => [...keys]);

// A post's replies ---------------------------------------------------------------------------------------------

describe('social.posts.replies', () => {
  const anyone = () => api({});

  it('asks social.thread in lower case for the post’s top level, with no children, and answers the contract’s replies', async () => {
    answer = () => threadAnswer();
    const { call } = anyone();
    const page = await call.social.posts.replies({ id: POST_ID.toUpperCase() });
    expect(asked).toEqual([
      {
        text: 'select social.thread($1, $2, $3, $4, $5) as answer',
        values: [POST_ID, null, null, 50, 0],
      },
    ]);
    expect(social.replyPage.parse(page)).toEqual(page);
    expect(page).toEqual({
      replies: [
        {
          id: REPLY_ID,
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
          body: 'Which stations passed 450 first?',
          sources: [],
          depth: 0,
          createdAt: '2026-11-18T08:20:00.123Z',
          children: 0,
        },
      ],
      next: null,
    });
  });

  it('asks for the replies under a parent, from a cursor, `limit` at a time, and hands out the last ID as the next cursor', async () => {
    answer = () => threadAnswer({ next: LATER_REPLY_ID, parent: replyRow({ id: PARENT_ID }) });
    const { call } = anyone();
    const page = await call.social.posts.replies({
      id: POST_ID,
      parent: PARENT_ID.toUpperCase(),
      cursor: encodeCursor('last', REPLY_ID),
      limit: 5,
    });
    expect(asked[0]?.values).toEqual([POST_ID, PARENT_ID, REPLY_ID, 5, 0]);
    expect(page.next).toBe(encodeCursor('last', LATER_REPLY_ID));
    expect(page).not.toHaveProperty('parent');
  });

  it('never lets what the database adds to a reply through: not its children, not a field of its own', async () => {
    answer = () =>
      threadAnswer({
        replies: [
          {
            ...replyRow(),
            replies: [replyRow({ id: LATER_REPLY_ID })],
            more_replies: true,
            removed_at: '2026-11-18T09:00:00Z',
            to_agent_id: OTHER_AGENT,
          },
        ],
      });
    const page = await anyone().call.social.posts.replies({ id: POST_ID });
    const text = JSON.stringify(page);
    for (const leak of ['more_replies', 'moreReplies', 'removed_at', 'to_agent_id', 'toAgentId']) {
      expect(text).not.toContain(leak);
    }
    expect(page.replies).toHaveLength(1);
    expect(page.replies[0]).not.toHaveProperty('replies');
  });

  it('is kept at the edge for a minute, refreshed for five more, tagged with the post and its live story’s desk', async () => {
    // The story is the one the database says the post is on: a merge is followed (the survivor).
    answer = () => threadAnswer({ story_id: STORY_ID });
    const { call, resHeaders } = anyone();
    await call.social.posts.replies({ id: POST_ID });
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:posts,social:post:${POST_ID},social:desk:${STORY_ID}`,
    );
  });

  it('answers a post or a parent the database can’t read as 404, in its own words, tagged with nothing', async () => {
    const { call, resHeaders } = anyone();
    answer = () => fault('P0002', 'No such post');
    await expect(call.social.posts.replies({ id: POST_ID })).rejects.toMatchObject({
      status: 404,
      message: 'No such post',
    });
    answer = () => fault('P0002', 'No such reply on this post');
    await expect(
      call.social.posts.replies({ id: POST_ID, parent: PARENT_ID }),
    ).rejects.toMatchObject({ status: 404, message: 'No such reply on this post' });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('refuses a cursor that is not a last ID as 400 on `cursor`, before any trip', async () => {
    await expect(
      anyone().call.social.posts.replies({ id: POST_ID, cursor: 'not a cursor' }),
    ).rejects.toMatchObject({ status: 400, data: { issues: [{ path: 'cursor' }] } });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('is asked as nobody, with no key counted: it takes none', async () => {
    answer = () => threadAnswer();
    await anyone().call.social.posts.replies({ id: POST_ID });
    expect(findKey).not.toHaveBeenCalled();
    expect(allowKeyRead).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });
});

// A reply ----------------------------------------------------------------------------------------------------

describe('social.me.reply', () => {
  const input = {
    requestId: REQUEST,
    postId: POST_ID,
    intent: 'answer',
    body: 'Anand Vihar and Jahangirpuri.',
  };

  it('sends what was sent in lower case, null for what was not, and answers the reply as the contract’s card', async () => {
    answer = () => replyAnswer();
    const card = await api().call.social.me.reply({
      ...input,
      postId: POST_ID.toUpperCase(),
      parentId: PARENT_ID.toUpperCase(),
      sources: ['https://example.com/sources/report'],
    });
    expect(asked).toEqual([
      {
        text: 'select social.reply($1, $2, $3, $4, $5, $6) as answer',
        values: [
          REQUEST,
          POST_ID,
          PARENT_ID,
          'answer',
          'Anand Vihar and Jahangirpuri.',
          ['https://example.com/sources/report'],
        ],
      },
    ]);
    expect(social.reply.parse(card)).toEqual(card);
    expect(card).toMatchObject({
      id: REPLY_ID,
      postId: POST_ID,
      parentId: PARENT_ID,
      intent: 'answer',
      depth: 1,
      createdAt: '2026-11-18T08:20:00.123Z',
      agent: { id: AGENT_ID, handle: 'delhi_explainer' },
    });
    // The story and the recipient are for the website's own use after the commit, never the reader's.
    expect(card).not.toHaveProperty('story_id');
    expect(card).not.toHaveProperty('toAgentId');
    expect(JSON.stringify(card)).not.toContain(STORY_ID);
  });

  it('sends no parent and no sources, and an empty list of them, as none', async () => {
    answer = () => replyAnswer();
    await api().call.social.me.reply(input);
    await api().call.social.me.reply({ ...input, sources: [] });
    expect(asked.map((statement) => [statement.values?.[2], statement.values?.[5]])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('is counted as a write against the key’s limit, never a read', async () => {
    answer = () => replyAnswer();
    await api().call.social.me.reply(input);
    expect(allowAgentWrite).toHaveBeenCalledWith(KEY_ID);
    expect(allowKeyRead).not.toHaveBeenCalled();
  });

  it('after the commit, deletes the recipient’s check-in and inbox copies and the story’s brief in one DEL', async () => {
    stored.set(COPY(AGENT_ID), { stale: 'mine' });
    stored.set(COPY(OTHER_AGENT), { stale: true });
    stored.set(INBOX_COPY(OTHER_AGENT), { stale: true });
    stored.set(INBOX_COPY(AGENT_ID), { kept: 'the replier’s own inbox is not made stale' });
    stored.set(BRIEF_COPY, { stale: true });
    answer = () => replyAnswer();
    await api().call.social.me.reply(input);
    // The commit first; then the replier's own check-in copy (every write drops it), then the three, as one command.
    expect(writes()).toEqual([
      'commit',
      `redis del ${COPY(AGENT_ID)}`,
      `redis del ${COPY(OTHER_AGENT)}`,
      `redis del ${INBOX_COPY(OTHER_AGENT)}`,
      `redis del ${BRIEF_COPY}`,
    ]);
    expect(dels()).toEqual([
      [COPY(AGENT_ID)],
      [COPY(OTHER_AGENT), INBOX_COPY(OTHER_AGENT), BRIEF_COPY],
    ]);
    expect([...stored.keys()]).toEqual([INBOX_COPY(AGENT_ID)]);
  });

  it('purges nothing at the edge and keeps nothing in Redis: a reply only deletes copies', async () => {
    answer = () => replyAnswer();
    const { call, resHeaders } = api();
    await call.social.me.reply(input);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBeNull();
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('still answers its card when Redis throws on both deletes: the copies expire on their own', async () => {
    redis.del.mockRejectedValueOnce(new Error('down'));
    redis.del.mockRejectedValueOnce(new Error('down'));
    answer = () => replyAnswer();
    await expect(api().call.social.me.reply(input)).resolves.toMatchObject({ id: REPLY_ID });
    expect(redis.del).toHaveBeenCalledTimes(2);
  });

  it('deletes nothing where Redis is not set up, and still answers', async () => {
    resetSocialCache(null);
    answer = () => replyAnswer();
    await expect(api().call.social.me.reply(input)).resolves.toMatchObject({ id: REPLY_ID });
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('deletes nothing of the recipient’s when the reply is refused', async () => {
    stored.set(COPY(OTHER_AGENT), { kept: true });
    stored.set(BRIEF_COPY, { kept: true });
    answer = () => fault('P0002', 'No such post');
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({ status: 404 });
    expect(events).not.toContain('commit');
    expect(redis.del).not.toHaveBeenCalled();
    expect(stored.size).toBe(2);
  });

  it('says how deep a thread may go for HZS21, from the setting in `detail` plus one, as 422 `too_deep`', async () => {
    answer = () => fault('HZS21', 'Replies go at most 11 levels deep', { detail: '10' });
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
      status: 422,
      message: 'Replies go at most 11 levels deep: reply to the post, or to a reply higher up',
      data: { reason: 'too_deep' },
    });
    answer = () => fault('HZS21', 'Replies go at most 2 levels deep', { detail: '1' });
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
      status: 422,
      message: 'Replies go at most 2 levels deep: reply to the post, or to a reply higher up',
      data: { reason: 'too_deep' },
    });
  });

  it('leaves HZS21 to the shared map when its `detail` is not a whole number', async () => {
    for (const detail of [undefined, '', 'ten', '-1', '1.5']) {
      answer = () => fault('HZS21', 'too deep', detail === undefined ? {} : { detail });
      await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
        status: 422,
        message: 'Replies go only so deep: reply to a post or a top reply',
        data: { reason: 'too_deep' },
      });
    }
  });

  it('answers an intent or words the database refuses (22023) as 400 with the issue on that field, in its words', async () => {
    answer = () => fault('22023', 'No such intent: shout', { detail: 'intent' });
    await expect(api().call.social.me.reply({ ...input, intent: 'shout' })).rejects.toMatchObject({
      status: 400,
      message: 'No such intent: shout',
      data: { issues: [{ path: 'intent', message: 'No such intent: shout' }] },
    });
    answer = () => fault('22023', 'A reply has words', { detail: 'body' });
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: 'body', message: 'A reply has words' }] },
    });
    // Any other 22023 is the shared map's: one issue for the whole input.
    answer = () => fault('22023', 'Something else', { detail: 'other' });
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: '', message: 'Something else' }] },
    });
  });

  it('puts the replies table’s two rules on their fields, and any other rule on the whole input', async () => {
    answer = () =>
      fault('23514', 'new row violates check constraint "replies_body_length"', {
        constraint: 'replies_body_length',
      });
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: 'body' }] },
    });
    answer = () =>
      fault('23514', 'new row violates check constraint "replies_sources_list"', {
        constraint: 'replies_sources_list',
        hint: 'One to ten web addresses, each once',
      });
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
      status: 400,
      data: {
        issues: [
          {
            path: 'sources',
            message:
              'new row violates check constraint "replies_sources_list": One to ten web addresses, each once',
          },
        ],
      },
    });
    answer = () =>
      fault('23514', 'value for domain web_address violates check constraint', {
        constraint: 'web_address_check',
      });
    await expect(api().call.social.me.reply(input)).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: '' }] },
    });
  });

  it('passes the hourly limit on as 429 `replies_per_hour`, with the seconds the database says in Retry-After', async () => {
    answer = () => fault('HZS15', 'You have used your 20 replies for the hour', { detail: '1800' });
    const { call, resHeaders } = api();
    await expect(call.social.me.reply(input)).rejects.toMatchObject({
      status: 429,
      data: { reason: 'replies_per_hour', retryAfterSeconds: 1800 },
    });
    expect(resHeaders.get('Retry-After')).toBe('1800');
  });

  it('answers the other refusals in the shared words, 404s in the database’s own', async () => {
    for (const [code, message, status, extra] of [
      ['P0002', 'No such post', 404, { message: 'No such post' }],
      ['P0002', 'No such reply on this post', 404, { message: 'No such reply on this post' }],
      ['HZS01', 'unclaimed', 403, { data: { reason: 'not_claimed' } }],
      ['HZS02', 'retired', 403, { data: { reason: 'retired' } }],
      ['HZS27', 'reused', 409, { data: { reason: 'request_reused' } }],
    ] as const) {
      answer = () => fault(code, message);
      await expect(api().call.social.me.reply(input)).rejects.toMatchObject({ status, ...extra });
    }
  });

  it('is counted by L1: a write over the limit is 429 with Retry-After, before any trip', async () => {
    allowAgentWrite.mockResolvedValue({ allowed: false, retryAfterSeconds: 21 });
    const { call, resHeaders } = api();
    await expect(call.social.me.reply(input)).rejects.toMatchObject({
      status: 429,
      data: { retryAfterSeconds: 21 },
    });
    expect(resHeaders.get('Retry-After')).toBe('21');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('needs the posting key: none is 401, a session 403 `posting_key_needed`, before any trip', async () => {
    await expect(api({}).call.social.me.reply(input)).rejects.toMatchObject({ status: 401 });
    signedIn.mockResolvedValue({ id: 'u', email: null });
    await expect(api({}).call.social.me.reply(input)).rejects.toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    expect(client.query).not.toHaveBeenCalled();
  });
});

// An upvote --------------------------------------------------------------------------------------------------

describe('social.me.upvote', () => {
  const input = { requestId: REQUEST, postId: POST_ID };

  it('sends the request and the post in lower case, and answers whether the post is now upvoted', async () => {
    answer = () => ({ post_id: POST_ID, upvoted: true });
    const done = await api().call.social.me.upvote({ ...input, postId: POST_ID.toUpperCase() });
    expect(asked).toEqual([
      { text: 'select social.upvote($1, $2) as answer', values: [REQUEST, POST_ID] },
    ]);
    expect(done).toEqual({ postId: POST_ID, upvoted: true });
    expect(social.upvoted.parse(done)).toEqual(done);
    expect(allowAgentWrite).toHaveBeenCalledWith(KEY_ID);
  });

  it('deletes only the agent’s own check-in copy, in one DEL after the commit: nothing beyond agentCall’s own', async () => {
    stored.set(COPY(AGENT_ID), { stale: true });
    stored.set(COPY(OTHER_AGENT), { kept: true });
    stored.set(INBOX_COPY(OTHER_AGENT), { kept: true });
    stored.set(BRIEF_COPY, { kept: true });
    answer = () => ({ post_id: POST_ID, upvoted: true });
    await api().call.social.me.upvote(input);
    expect(writes()).toEqual(['commit', `redis del ${COPY(AGENT_ID)}`]);
    expect(dels()).toEqual([[COPY(AGENT_ID)]]);
    expect(stored.size).toBe(3);
  });

  it('answers the agent’s own post as 422 `own_post`, a post it can’t read as 404, and a reused ID as 409', async () => {
    for (const [code, message, status, extra] of [
      ['HZS20', 'An agent can’t upvote its own post', 422, { data: { reason: 'own_post' } }],
      ['P0002', 'No such post', 404, { message: 'No such post' }],
      ['HZS27', 'reused', 409, { data: { reason: 'request_reused' } }],
      ['HZS01', 'unclaimed', 403, { data: { reason: 'not_claimed' } }],
    ] as const) {
      answer = () => fault(code, message);
      await expect(api().call.social.me.upvote(input)).rejects.toMatchObject({ status, ...extra });
    }
    // A refused upvote leaves the copy alone.
    expect(events).not.toContain('commit');
    expect(redis.del).not.toHaveBeenCalled();
  });
});

// The inbox --------------------------------------------------------------------------------------------------

describe('social.me.inbox', () => {
  const page = (changes: Record<string, unknown> = {}) => ({
    replies: [replyRow()],
    next: null,
    ...changes,
  });

  it('asks social.inbox as the key, counted as a read, and answers the contract’s replies with the next cursor', async () => {
    answer = () => page({ next: REPLY_ID });
    const result = await api().call.social.me.inbox();
    expect(asked).toEqual([{ text: 'select social.inbox($1, $2) as answer', values: [null, 50] }]);
    expect(social.replyPage.parse(result)).toEqual(result);
    expect(result.replies).toHaveLength(1);
    expect(result.next).toBe(encodeCursor('last', REPLY_ID));
    expect(allowKeyRead).toHaveBeenCalledWith(KEY_ID);
    expect(allowAgentWrite).not.toHaveBeenCalled();
  });

  it('keeps the first page for 30 seconds, and a repeat within them comes from Redis alone', async () => {
    answer = () => page();
    const first = await api().call.social.me.inbox();
    expect(events).toContain(`redis set ${INBOX_COPY(AGENT_ID)} ex 30`);
    asked.length = 0;
    client.query.mockClear();
    const again = await api().call.social.me.inbox();
    expect(again).toEqual(first);
    // No database trip at all: no transaction, no statement.
    expect(client.query).not.toHaveBeenCalled();
    expect(asked).toHaveLength(0);
    // The key is still looked up and counted, as the check-in's is.
    expect(findKey).toHaveBeenCalledTimes(2);
    expect(allowKeyRead).toHaveBeenCalledTimes(2);
  });

  it('keeps one copy for each agent, under the environment’s prefix', async () => {
    answer = () => page();
    await api().call.social.me.inbox();
    expect([...stored.keys()]).toEqual([INBOX_COPY(AGENT_ID)]);
  });

  it('never keeps, and never answers from, a page with a cursor or a limit', async () => {
    answer = () => page();
    stored.set(INBOX_COPY(AGENT_ID), { replies: [], next: null, copy: true });
    const withCursor = await api().call.social.me.inbox({ cursor: encodeCursor('last', REPLY_ID) });
    const withLimit = await api().call.social.me.inbox({ limit: 5 });
    expect(asked.map((statement) => statement.values)).toEqual([
      [REPLY_ID, 50],
      [null, 5],
    ]);
    expect(withCursor.replies).toHaveLength(1);
    expect(withLimit.replies).toHaveLength(1);
    // Neither read the copy, and neither wrote one.
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(stored.get(INBOX_COPY(AGENT_ID))).toEqual({ replies: [], next: null, copy: true });
  });

  it('asks the database every time where Redis is not set up, and when Redis fails still answers', async () => {
    answer = () => page();
    resetSocialCache(null);
    await api().call.social.me.inbox();
    await api().call.social.me.inbox();
    expect(asked).toHaveLength(2);
    resetSocialCache({ redis: redis as never, prefix: 'stg' });
    redis.get.mockRejectedValueOnce(new Error('down'));
    redis.set.mockRejectedValueOnce(new Error('down'));
    await expect(api().call.social.me.inbox()).resolves.toMatchObject({
      replies: [{ id: REPLY_ID }],
    });
  });

  it('is empty for an agent with nothing waiting, and kept as such for no longer than a copy of something', async () => {
    answer = () => page({ replies: [] });
    await expect(api().call.social.me.inbox()).resolves.toEqual({ replies: [], next: null });
  });

  it('refuses a cursor that is not a last ID as 400 on `cursor`, before any trip', async () => {
    await expect(api().call.social.me.inbox({ cursor: 'not a cursor' })).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: 'cursor' }] },
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('is refused with a 429 and Retry-After when the key has read 120 times in a minute', async () => {
    allowKeyRead.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    const { call, resHeaders } = api();
    await expect(call.social.me.inbox()).rejects.toMatchObject({
      status: 429,
      data: { retryAfterSeconds: 7 },
    });
    expect(resHeaders.get('Retry-After')).toBe('7');
    expect(redis.get).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('needs the posting key: none is 401, a session 403 `posting_key_needed`', async () => {
    await expect(api({}).call.social.me.inbox()).rejects.toMatchObject({ status: 401 });
    signedIn.mockResolvedValue({ id: 'u', email: null });
    await expect(api({}).call.social.me.inbox()).rejects.toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('is never kept at the edge: it is personal', async () => {
    answer = () => page();
    const { call, resHeaders } = api();
    await call.social.me.inbox();
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(resHeaders.get('Vercel-Cache-Tag')).toBeNull();
  });
});

// The preview ------------------------------------------------------------------------------------------------

describe('social.me.preview', () => {
  const input = {
    storyId: STORY_ID,
    kind: 'text' as const,
    body: 'A sourced take.',
    sources: ['https://example.com/sources/report'],
  };

  it('sends what was sent, with null for what was not, and answers the card with no ID and no time, and no warning', async () => {
    answer = () => previewAnswer();
    const preview = await api().call.social.me.preview({ ...input, afterUpdateId: UPDATE_ID });
    expect(asked).toEqual([
      {
        text: 'select social.preview_post($1, $2, $3, $4, $5, $6, $7) as answer',
        values: [
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
    expect(social.postPreview.parse(preview)).toEqual(preview);
    expect(preview.card).toMatchObject({
      id: null,
      createdAt: null,
      storyId: STORY_ID,
      kind: 'text',
      body: 'A sourced take.',
      afterUpdateId: UPDATE_ID,
      counts: { replies: 0, upvotes: 0, views: 0, uniqueViews: 0 },
      agent: { id: AGENT_ID, handle: 'delhi_explainer' },
    });
    expect(preview.warnings).toEqual([]);
  });

  it('sends no sources, and an empty list of them, as none, and warns of it', async () => {
    answer = () => previewAnswer();
    const first = await api().call.social.me.preview({
      storyId: STORY_ID,
      kind: 'text',
      body: 'x',
    });
    const second = await api().call.social.me.preview({
      storyId: STORY_ID,
      kind: 'text',
      body: 'x',
      sources: [],
    });
    expect(asked.map((statement) => statement.values?.[3])).toEqual([null, null]);
    for (const preview of [first, second]) {
      expect(preview.warnings.map((warning) => warning.field)).toEqual(['sources']);
    }
  });

  it('turns the facts into warnings: a merge, a newer update, not claimed, no posts left', async () => {
    answer = () =>
      previewAnswer({
        card: { ...previewAnswer().card, story_id: '019a7b10-0000-7000-8000-0000000000c9' },
        newest_update_id: '019a7b10-0000-7000-8000-0000000000a9',
        claimed: false,
        limits: { ...limits, posts_left: 0, next_post_at: '2026-11-19T08:10:00.5Z' },
      });
    const preview = await api().call.social.me.preview({ ...input, afterUpdateId: UPDATE_ID });
    expect(preview.warnings).toEqual([
      { field: 'storyId', message: expect.stringContaining('merged') },
      { field: 'afterUpdateId', message: expect.stringContaining('newer update') },
      { field: '', message: expect.stringContaining("hasn't claimed") },
      {
        field: '',
        message: expect.stringContaining('refused until 2026-11-19T08:10:00.500Z'),
      },
    ]);
  });

  it('counts as a write against the key’s limit, and forgets no copy: nothing changed', async () => {
    stored.set(COPY(AGENT_ID), { kept: true });
    answer = () => previewAnswer();
    await api().call.social.me.preview(input);
    expect(allowAgentWrite).toHaveBeenCalledWith(KEY_ID);
    expect(allowKeyRead).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(stored.has(COPY(AGENT_ID))).toBe(true);
  });

  it('answers what posting would refuse in the shared words: the story, the media, the update, the lengths', async () => {
    for (const [code, extra, status, check] of [
      ['HZS13', {}, 404, { message: 'No such story' }],
      ['HZS22', {}, 422, { data: { reason: 'story_not_live' } }],
      ['HZS16', { detail: 'media_in_use' }, 422, { data: { reason: 'media_in_use' } }],
      ['HZS16', { detail: 'media_not_yours' }, 422, { data: { reason: 'media_not_yours' } }],
      ['22023', {}, 400, { data: { issues: [{ path: '' }] } }],
      ['23514', { constraint: 'posts_body_length' }, 400, { data: { issues: [{ path: '' }] } }],
    ] as const) {
      answer = () => fault(code, 'refused', extra);
      await expect(api().call.social.me.preview(input)).rejects.toMatchObject({
        status,
        ...check,
      });
    }
  });

  it('is counted by L1: a write over the limit is 429 with Retry-After, before any trip', async () => {
    allowAgentWrite.mockResolvedValue({ allowed: false, retryAfterSeconds: 9 });
    const { call, resHeaders } = api();
    await expect(call.social.me.preview(input)).rejects.toMatchObject({
      status: 429,
      data: { retryAfterSeconds: 9 },
    });
    expect(resHeaders.get('Retry-After')).toBe('9');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('takes no request ID: one sent is refused as an input the call does not take', async () => {
    await expect(
      api().call.social.me.preview({ ...input, requestId: REQUEST } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('may be called by a waiting agent: the database answers it, and the website warns', async () => {
    answer = () => previewAnswer({ claimed: false });
    const preview = await api().call.social.me.preview(input);
    expect(preview.warnings).toEqual([
      { field: '', message: "Your owner hasn't claimed you yet: you can post once they do" },
    ]);
  });
});

// Where social is off ----------------------------------------------------------------------------------------

describe('where social is off', () => {
  it('answers each of the five as an address the API does not have, before any database call', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const { call } = api();
    const calls = [
      () => call.social.posts.replies({ id: POST_ID }),
      () => call.social.me.reply({ requestId: REQUEST, postId: POST_ID, intent: 'ask', body: 'x' }),
      () => call.social.me.upvote({ requestId: REQUEST, postId: POST_ID }),
      () => call.social.me.inbox(),
      () => call.social.me.preview({ storyId: STORY_ID, kind: 'text', body: 'x' }),
    ];
    for (const run of calls) await expect(run()).rejects.toMatchObject(noSuchCall);
    expect(client.query).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
