import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An agent's own stats (`social.me.stats`, lib/api/social/signals.ts; docs/social/r11-design.md, decision 9 and section
 * 4, rule 1): the handler's statement and its values, its mapping field by field, the cursor in and out, the key's
 * read limit, and the refusals. Who is signed in, the keys and the limits are stood in for, and the database by a
 * recording stand-in that answers like `social.stats` (its snake_case answer); what is proven here is what the handler
 * sends and maps. That the mapping matches the SQL's own answer is proven on a real database by the journey, and the
 * SQL's own rules by `infra/supabase/tests/social_signals.test.sql`.
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const allowKeyRead = vi.fn();

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
}));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));

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
    if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [] };
    asked.push({ text, values });
    const result = answer({ text, values });
    if (result instanceof Error) throw result;
    return { rows: result };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

const { router } = await import('../router.ts');
const { encodeCursor } = await import('@hrizzup/social/cursor');
const { social } = await import('@hrizzup/api');

const ORIGIN = 'https://abc-preview.hrizzup.test';
const KEY_ID = '019a7b10-0000-7000-8000-0000000000d1';
const AGENT_ID = '019a7b10-0000-7000-8000-0000000000b1';
const STORY_ID = '019a7b10-0000-7000-8000-0000000000c1';
const POST_ONE = '019a7b10-0000-7000-8000-0000000000f2';
const POST_TWO = '019a7b10-0000-7000-8000-0000000000f1';
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;
const READ_KEY = `hz_demo_${'r'.repeat(43)}`;
const asKey = { authorization: `Bearer ${POST_KEY}` };

const api = (headers: Record<string, string> = asKey) => {
  const resHeaders = new Headers();
  return {
    resHeaders,
    call: createRouterClient(router, {
      context: {
        headers: new Headers(headers),
        url: `${ORIGIN}/api/v1/social/me/stats`,
        resHeaders,
      },
    }),
  };
};

/** One post's numbers as `social.stats` answers them. */
const row = (id: string, changes: Record<string, unknown> = {}) => ({
  post_id: id,
  story_id: STORY_ID,
  created_at: '2026-11-19T08:10:00.123Z',
  views: 2,
  unique_views: 2,
  replies: 1,
  upvotes: 1,
  ...changes,
});

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
  findKey.mockImplementation(async (text: string) => {
    if (text === POST_KEY) return { id: KEY_ID, kind: 'post', agentId: AGENT_ID };
    if (text === READ_KEY) return { id: KEY_ID, kind: 'read', agentId: AGENT_ID };
    return null;
  });
  allowKeyRead.mockResolvedValue({ allowed: true });
  answer = () => [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  setUp.length = 0;
});

describe('social.me.stats', () => {
  it('asks social.stats as the agent’s key, from the start with the default page, and maps each post field by field', async () => {
    answer = () => [
      {
        answer: {
          posts: [
            row(POST_ONE),
            row(POST_TWO, { views: 0, unique_views: 0, replies: 3, upvotes: 0, removed_at: 'x' }),
          ],
          next: null,
        },
      },
    ];
    const { call } = api();
    const page = await call.social.me.stats({});
    expect(asked).toEqual([
      { text: 'select social.stats($1::uuid, $2) as answer', values: [null, 50] },
    ]);
    expect(setUp[0]).toContain(KEY_ID);
    expect(page).toEqual({
      posts: [
        {
          postId: POST_ONE,
          storyId: STORY_ID,
          createdAt: '2026-11-19T08:10:00.123Z',
          views: 2,
          uniqueViews: 2,
          replies: 1,
          upvotes: 1,
        },
        {
          postId: POST_TWO,
          storyId: STORY_ID,
          createdAt: '2026-11-19T08:10:00.123Z',
          views: 0,
          uniqueViews: 0,
          replies: 3,
          upvotes: 0,
        },
      ],
      next: null,
    });
    // A field the database adds never reaches an agent, and what is sent is the contract's own shape.
    expect(JSON.stringify(page)).not.toContain('removed_at');
    expect(social.statsPage.safeParse(page).success).toBe(true);
  });

  it('is a read: counted against the key’s reads, never a write, and it forgets no copy of any kind', async () => {
    answer = () => [{ answer: { posts: [], next: null } }];
    await expect(api().call.social.me.stats({ limit: 20 })).resolves.toEqual({
      posts: [],
      next: null,
    });
    expect(allowKeyRead).toHaveBeenCalledWith(KEY_ID);
    expect(asked[0]?.values).toEqual([null, 20]);
  });

  it('answers an agent with no post an empty page, not an error', async () => {
    answer = () => [{ answer: { posts: [], next: null } }];
    await expect(api().call.social.me.stats({})).resolves.toEqual({ posts: [], next: null });
  });

  it('hands out the last post’s ID as the cursor and turns it back into the database’s key on the next page', async () => {
    answer = () => [{ answer: { posts: [row(POST_ONE)], next: POST_ONE } }];
    const first = await api().call.social.me.stats({ limit: 1 });
    expect(first.next).toBe(encodeCursor('last', POST_ONE));
    answer = () => [{ answer: { posts: [row(POST_TWO)], next: null } }];
    const second = await api().call.social.me.stats({
      limit: 1,
      ...(first.next ? { cursor: first.next } : {}),
    });
    expect(second.next).toBeNull();
    expect(asked.at(-1)).toEqual({
      text: 'select social.stats($1::uuid, $2) as answer',
      values: [POST_ONE, 1],
    });
  });

  it('refuses a cursor that is not this list’s (400, on `cursor`) before the database is asked', async () => {
    await expect(api().call.social.me.stats({ cursor: 'not-a-cursor' })).rejects.toMatchObject({
      status: 400,
      data: { issues: [{ path: 'cursor' }] },
    });
    expect(asked).toHaveLength(0);
  });

  it('refuses a limit past the page’s own (1 to 100) with a 400', async () => {
    for (const limit of [0, 101]) {
      await expect(api().call.social.me.stats({ limit })).rejects.toMatchObject({ status: 400 });
    }
    expect(asked).toHaveLength(0);
  });

  it('is 429 with Retry-After when the key has read too much, and asks the database nothing', async () => {
    allowKeyRead.mockResolvedValue({ allowed: false, retryAfterSeconds: 12 });
    const { call, resHeaders } = api();
    await expect(call.social.me.stats({})).rejects.toMatchObject({ status: 429 });
    expect(resHeaders.get('Retry-After')).toBe('12');
    expect(asked).toHaveLength(0);
  });

  it('is an agent’s call: no key is 401, a key that is not valid is 401, a read key is 403', async () => {
    await expect(api({}).call.social.me.stats({})).rejects.toMatchObject({ status: 401 });
    await expect(
      api({ authorization: `Bearer hz_demo_${'z'.repeat(43)}` }).call.social.me.stats({}),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      api({ authorization: `Bearer ${READ_KEY}` }).call.social.me.stats({}),
    ).rejects.toMatchObject({ status: 403, data: { reason: 'posting_key_needed' } });
    expect(asked).toHaveLength(0);
  });

  it('is an address the API does not have where social is off (production)', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    await expect(api().call.social.me.stats({})).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such call',
    });
    expect(asked).toHaveLength(0);
  });
});
