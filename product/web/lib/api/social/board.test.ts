import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { CursorError, encodeCursor } from '@hrizzup/social/cursor';
import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from '@/lib/social/cache.ts';

/**
 * The board's and the stories' six public reads (docs/social/build.md, sections 5, 5.1 and 6; R5's
 * design note, M1; 9.2's `board.test.ts`). The database is stood in for by a recording stand-in that
 * answers like the functions of migrations/*_social.sql (their snake_case answers, their SQLSTATEs),
 * so what is proven here is the handlers: the values they send, the answers they map, the headers and
 * tags they set, the refusals. That the hand-written mappers match what the SQL really emits is
 * proven by `board.db.test.ts` on a real database.
 */

/** What the stand-in database is asked, in order, once the transaction's own setup is left out. */
type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
let answer: (statement: Statement) => unknown = () => ({});

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'begin' || text === 'rollback' || text === 'commit') return { rows: [] };
    if (text.startsWith('select set_config')) return { rows: [] };
    asked.push({ text, values });
    const result = answer({ text, values });
    if (result instanceof Error) throw result;
    return { rows: [{ answer: result }] };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

const { router } = await import('../router.ts');

/** A client of the real router, with the response headers the handler sets kept for the test to read. */
function api() {
  const resHeaders = new Headers();
  const called = createRouterClient(router, {
    context: {
      headers: new Headers(),
      resHeaders,
      url: 'https://staging.hrizzup.com/api/v1/social/board',
    },
  });
  return { api: called, resHeaders };
}

/** A database error as `pg` raises it. */
const fault = (code: string, message: string) => Object.assign(new Error(message), { code });

/** snake_case from camelCase, deeply: what the functions answer. */
function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        snake(item),
      ]),
    );
  }
  return value;
}

const noSuchCall = { code: 'NOT_FOUND', status: 404, message: 'No such call' };
const STORY = examples.board.storyDetail;
if (STORY.state !== 'live') throw new Error('The example story is live');
const SURVIVOR = STORY.id;
const MERGED = '01a19aea-2a80-7d1f-9d0d-b58cdf6ccb84';
const WITHDRAWN = examples.board.withdrawnStory;
const TOP = { r: '2878129044800', i: '01a1a57b-8ca0-7c96-8905-93eb7d0b0d54' };
const TIME = { t: '2026-11-02T09:40:00Z', i: '01a19ba7-ae20-7fb8-a847-35438eddf011' };

/** The example story as `social.story` answers it, snake_case. */
const storyRow = (changes: Record<string, unknown> = {}) => ({
  ...(snake({ ...STORY, requestedId: null }) as object),
  ...changes,
});
/** The example post as `social.desk` answers it: no picture and no media, since no function writes any before R8. */
const postRow = (changes: Record<string, unknown> = {}) => {
  const post = examples.board.deskPage.posts[0];
  if (!post) throw new Error('The example desk has a post');
  const row = snake({
    ...post,
    kind: 'text',
    media: null,
    agent: { ...post.agent, picture: null },
  });
  return { ...(row as object), ...changes };
};
/** `social.brief_data`'s answer for the example story. */
const briefData = (changes: Record<string, unknown> = {}) => ({
  story: {
    id: SURVIVOR,
    title: STORY.title,
    summary: STORY.summary,
    categories: STORY.categories,
    places: STORY.places,
    latest_at: STORY.latestAt,
    created_at: STORY.createdAt,
    state: 'live',
    counts: snake(STORY.counts),
  },
  updates: [...STORY.updates].reverse().map((update) => snake(update)),
  posts: [],
  open_questions: [],
  counts: { posts: 2, replies: 7, upvotes: 4, pins: 3 },
  ...changes,
});

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  resetSocialCache(null);
  answer = () => ({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  resetSocialCache();
});

describe('the lists', () => {
  it('answer from the agreement with no database call, kept at the edge for an hour under their own tag', async () => {
    const { api: called, resHeaders } = api();
    const lists = await called.social.lists();
    expect(social.lists.parse(lists)).toEqual(lists);
    expect(lists.categories.length).toBeGreaterThan(0);
    expect(lists.sorts).toEqual(['top', 'latest']);
    expect(client.query).not.toHaveBeenCalled();
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=3600, stale-while-revalidate=86400',
    );
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe('social:lists');
  });
});

describe('the board', () => {
  const page = (next: unknown = null) => ({
    stories: snake(examples.board.storyPage.stories),
    next,
  });

  it('is Top with no filter, 50 to a page and no cursor when the caller sends nothing', async () => {
    answer = () => page();
    const { api: called } = api();
    await called.social.board();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.board($1, $2, $3::text[], $4::jsonb, $5) as answer');
    expect(asked[0]?.values).toEqual(['top', null, null, null, 50]);
    // And the same with an empty input.
    asked.length = 0;
    await called.social.board({});
    expect(asked[0]?.values).toEqual(['top', null, null, null, 50]);
  });

  it("sends a tier's places, one place as itself, the category, Latest and the limit", async () => {
    answer = () => page();
    const { api: called } = api();
    await called.social.board({ place: 'local', category: 'sports', limit: 7, sort: 'latest' });
    expect(asked[0]?.values).toEqual([
      'latest',
      'sports',
      ['mumbai', 'delhi-ncr', 'bengaluru'],
      null,
      7,
    ]);
    asked.length = 0;
    await called.social.board({ place: 'mumbai' });
    expect(asked[0]?.values?.[2]).toEqual(['mumbai']);
  });

  it("answers the example's tiles exactly as the contract has them", async () => {
    answer = () => page();
    const { api: called } = api();
    const answered = await called.social.board({ sort: 'top', place: 'local', limit: 2 });
    expect(social.storyPage.parse(answered)).toEqual(answered);
    expect(answered.stories).toEqual(examples.board.storyPage.stories);
    expect(answered.next).toBeNull();
  });

  it("hands the page's next out as a cursor, and takes it back as the database's key: Top and Latest", async () => {
    const { api: called } = api();
    answer = () => page(TOP);
    const top = await called.social.board({ sort: 'top' });
    expect(top.next).toBe(encodeCursor('top', TOP));
    asked.length = 0;
    answer = () => page();
    await called.social.board({ sort: 'top', cursor: top.next ?? '' });
    expect(JSON.parse(String(asked[0]?.values?.[3]))).toEqual(TOP);

    answer = () => page(TIME);
    const latest = await called.social.board({ sort: 'latest' });
    expect(latest.next).toBe(encodeCursor('time', TIME));
    asked.length = 0;
    answer = () => page();
    await called.social.board({ sort: 'latest', cursor: latest.next ?? '' });
    expect(JSON.parse(String(asked[0]?.values?.[3]))).toEqual(TIME);
  });

  it('pages from the key of a cursor made under another filter, since a cursor grants nothing', async () => {
    answer = () => page();
    const { api: called } = api();
    await called.social.board({ category: 'sports', cursor: encodeCursor('top', TOP) });
    expect(JSON.parse(String(asked[0]?.values?.[3]))).toEqual(TOP);
  });

  it('refuses a cursor that is not this list’s with a 400 issue on `cursor`, before the database', async () => {
    const { api: called } = api();
    const edited = btoa(JSON.stringify({ r: 'one', i: TOP.i })).replace(/=+$/, '');
    const bad = [
      'not a cursor',
      encodeCursor('time', TIME), // another list's shape
      edited, // an edited one
      'a'.repeat(199),
    ];
    for (const cursor of bad) {
      await expect(called.social.board({ sort: 'top', cursor }), cursor).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        status: 400,
        data: { issues: [{ path: 'cursor' }] },
      });
    }
    // Latest wants the time shape: Top's is refused there too.
    await expect(
      called.social.board({ sort: 'latest', cursor: encodeCursor('top', TOP) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { issues: [{ path: 'cursor' }] } });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('is kept at the edge for a minute, refreshed for five more, under the board tag and no other', async () => {
    answer = () => page();
    const { api: called, resHeaders } = api();
    await called.social.board();
    expect(resHeaders.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe('social:board');
  });

  it('stays a 500, never a 400, when the database hands back a next key the cursor cannot hold', async () => {
    answer = () => page({ r: 'not a rank', i: TOP.i });
    const { api: called } = api();
    // Not the API's own error: the route turns any other error into a 500.
    const failure = await called.social.board().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CursorError);
    expect(failure).not.toBeInstanceOf(ORPCError);
  });
});

describe('one story', () => {
  it('asks social.story in lower case and answers a live story, tagged with the ID asked for', async () => {
    answer = () => storyRow();
    const { api: called, resHeaders } = api();
    const story = await called.social.stories.get({ id: SURVIVOR.toUpperCase() });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual({ text: 'select social.story($1) as answer', values: [SURVIVOR] });
    expect(social.storyDetail.parse(story)).toEqual(story);
    expect(story).toEqual({ ...STORY, requestedId: null });
    expect(story).not.toHaveProperty('withdrawnReason');
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:stories,social:story:${SURVIVOR}`);
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
  });

  it('answers the story a merged one went into, with the ID asked for, and tags both', async () => {
    answer = () => storyRow({ requested_id: MERGED });
    const { api: called, resHeaders } = api();
    const story = await called.social.stories.get({ id: MERGED });
    expect(story).toEqual(examples.board.storyDetail);
    expect(story).toMatchObject({ state: 'live', id: SURVIVOR, requestedId: MERGED });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:stories,social:story:${MERGED},social:story:${SURVIVOR}`,
    );
  });

  it('answers a withdrawn story as its state and reason only, never as a tile', async () => {
    answer = () => snake(WITHDRAWN);
    const { api: called, resHeaders } = api();
    const story = await called.social.stories.get({ id: WITHDRAWN.id });
    expect(story).toEqual(WITHDRAWN);
    expect(Object.keys(story).sort()).toEqual(['id', 'requestedId', 'state', 'withdrawnReason']);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:stories,social:story:${WITHDRAWN.id}`);
  });

  it("answers a merged story whose survivor was withdrawn as the survivor's withdrawn shape, with the ID asked for", async () => {
    answer = () => snake({ ...WITHDRAWN, requestedId: MERGED });
    const { api: called, resHeaders } = api();
    const story = await called.social.stories.get({ id: MERGED });
    expect(story).toEqual({ ...WITHDRAWN, requestedId: MERGED });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:stories,social:story:${MERGED},social:story:${WITHDRAWN.id}`,
    );
  });

  it('is 404 "No such story" for an ID the database does not know, and is never kept at the edge', async () => {
    answer = () => fault('P0002', 'No such story');
    const { api: called, resHeaders } = api();
    await expect(called.social.stories.get({ id: SURVIVOR })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such story',
    });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBeNull();
    expect(resHeaders.get('Vercel-CDN-Cache-Control')).toBeNull();
  });

  it('prints its times with three decimals, whatever form the database wrote them in: the market API’s printer is social’s too', async () => {
    const written = {
      created_at: '2026-11-03T10:15:00.123456Z',
      latest_at: '2026-11-04T05:20:00Z',
    };
    const row = storyRow(written) as { updates: { reported_at: string }[] };
    row.updates = row.updates.map((update, n) => ({
      ...update,
      reported_at: n === 0 ? '2026-11-03T03:50:00.5Z' : update.reported_at,
    }));
    answer = () => row;
    const { api: called } = api();
    const story = await called.social.stories.get({ id: SURVIVOR });
    if (story.state !== 'live') throw new Error('The story is live');
    // Cut at the third decimal, never rounded; padded when there are fewer.
    expect(story.createdAt).toBe('2026-11-03T10:15:00.123Z');
    expect(story.latestAt).toBe('2026-11-04T05:20:00.000Z');
    expect(story.updates[0]?.reportedAt).toBe('2026-11-03T03:50:00.500Z');
  });

  it('stays a 500 for a state the database never answers (a story is never answered as merged)', async () => {
    answer = () => storyRow({ state: 'merged' });
    const { api: called } = api();
    const failure = await called.social.stories
      .get({ id: SURVIVOR })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure).not.toBeInstanceOf(ORPCError);
  });

  it('is refused for an ID that is not a UUID, before the database', async () => {
    const { api: called } = api();
    await expect(called.social.stories.get({ id: 'a-story' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("a story's updates", () => {
  const updates = snake(examples.board.updatePage.updates) as unknown[];

  it('asks social.story_updates in lower case with 50 to a page, and answers the updates newest first', async () => {
    answer = () => ({ updates, next: null });
    const { api: called, resHeaders } = api();
    const answered = await called.social.stories.updates({ id: SURVIVOR.toUpperCase() });
    expect(asked[0]).toEqual({
      text: 'select social.story_updates($1, $2::jsonb, $3) as answer',
      values: [SURVIVOR, null, 50],
    });
    expect(social.updatePage.parse(answered)).toEqual(answered);
    expect(answered).toEqual({ updates: examples.board.updatePage.updates, next: null });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:stories,social:story:${SURVIVOR}`);
  });

  it("round-trips the page's next as a cursor, and refuses a Top cursor", async () => {
    const { api: called } = api();
    answer = () => ({ updates: updates.slice(0, 1), next: TIME });
    const first = await called.social.stories.updates({ id: SURVIVOR, limit: 1 });
    expect(asked[0]?.values?.[2]).toBe(1);
    expect(first.next).toBe(encodeCursor('time', TIME));
    asked.length = 0;
    answer = () => ({ updates, next: null });
    await called.social.stories.updates({ id: SURVIVOR, limit: 1, cursor: first.next ?? '' });
    expect(JSON.parse(String(asked[0]?.values?.[1]))).toEqual(TIME);
    asked.length = 0;
    await expect(
      called.social.stories.updates({ id: SURVIVOR, cursor: encodeCursor('top', TOP) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { issues: [{ path: 'cursor' }] } });
    expect(asked).toHaveLength(0);
  });

  it("answers a withdrawn story's updates as an empty page, and an unknown story 404", async () => {
    const { api: called } = api();
    answer = () => ({ updates: [], next: null });
    await expect(called.social.stories.updates({ id: WITHDRAWN.id })).resolves.toEqual({
      updates: [],
      next: null,
    });
    answer = () => fault('P0002', 'No such story');
    await expect(called.social.stories.updates({ id: SURVIVOR })).rejects.toMatchObject({
      status: 404,
      message: 'No such story',
    });
  });
});

describe("a story's desk", () => {
  it('asks social.desk with Top and 50 to a page by default, answers the cards with no picture or media, and tags the desk and its posts’ story', async () => {
    answer = () => ({ posts: [postRow()], next: null });
    const { api: called, resHeaders } = api();
    const desk = await called.social.stories.posts({ id: MERGED });
    expect(asked[0]).toEqual({
      text: 'select social.desk($1, $2, $3::jsonb, $4) as answer',
      values: [MERGED, 'top', null, 50],
    });
    expect(social.postPage.parse(desk)).toEqual(desk);
    const post = desk.posts[0];
    expect(post).toMatchObject({ storyId: SURVIVOR, kind: 'text', media: null });
    expect(post?.agent.picture).toBeNull();
    // The rest of the card is the example's, field for field.
    const example = examples.board.deskPage.posts[0];
    expect(post).toEqual({
      ...example,
      kind: 'text',
      media: null,
      agent: { ...example?.agent, picture: null },
    });
    // The desk asked for (a merged story's ID) and the desk the posts belong to.
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:desks,social:desk:${MERGED},social:desk:${SURVIVOR}`,
    );
  });

  it('tags only the desk asked for when it holds no posts, as a withdrawn story’s does', async () => {
    answer = () => ({ posts: [], next: null });
    const { api: called, resHeaders } = api();
    await expect(called.social.stories.posts({ id: WITHDRAWN.id })).resolves.toEqual({
      posts: [],
      next: null,
    });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:desks,social:desk:${WITHDRAWN.id}`);
  });

  it("pages Top by rank and Latest by ID, each with its own cursor, and refuses the other's", async () => {
    const { api: called } = api();
    answer = () => ({ posts: [postRow()], next: TOP });
    const top = await called.social.stories.posts({ id: SURVIVOR, sort: 'top', limit: 1 });
    expect(top.next).toBe(encodeCursor('top', TOP));
    asked.length = 0;
    answer = () => ({ posts: [postRow()], next: { i: TOP.i } });
    const latest = await called.social.stories.posts({ id: SURVIVOR, sort: 'latest', limit: 1 });
    expect(asked[0]?.values).toEqual([SURVIVOR, 'latest', null, 1]);
    expect(latest.next).toBe(encodeCursor('id', { i: TOP.i }));
    asked.length = 0;
    answer = () => ({ posts: [], next: null });
    await called.social.stories.posts({ id: SURVIVOR, sort: 'latest', cursor: latest.next ?? '' });
    expect(JSON.parse(String(asked[0]?.values?.[2]))).toEqual({ i: TOP.i });
    asked.length = 0;
    await called.social.stories.posts({ id: SURVIVOR, sort: 'top', cursor: top.next ?? '' });
    expect(JSON.parse(String(asked[0]?.values?.[2]))).toEqual(TOP);
    asked.length = 0;
    for (const [sort, cursor] of [
      ['top', latest.next],
      ['latest', top.next],
    ] as const) {
      await expect(
        called.social.stories.posts({ id: SURVIVOR, sort, cursor: cursor ?? '' }),
        sort,
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { issues: [{ path: 'cursor' }] } });
    }
    expect(asked).toHaveLength(0);
  });
});

describe("a story's brief", () => {
  it('is built from social.brief_data, holds the story and every update, and is tagged with the story and its desk', async () => {
    answer = () => briefData();
    const { api: called, resHeaders } = api();
    const brief = await called.social.stories.brief({ id: SURVIVOR.toUpperCase() });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual({
      text: 'select social.brief_data($1) as answer',
      values: [SURVIVOR],
    });
    expect(social.brief.parse(brief)).toEqual(brief);
    expect(brief.storyId).toBe(SURVIVOR);
    expect(brief.markdown).toContain(`# ${STORY.title}`);
    for (const update of STORY.updates) expect(brief.markdown).toContain(update.headline);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:briefs,social:story:${SURVIVOR},social:desk:${SURVIVOR}`,
    );
  });

  it('gives the same version for the same data, whenever it is built', async () => {
    answer = () => briefData();
    const { api: called } = api();
    const first = await called.social.stories.brief({ id: SURVIVOR });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await called.social.stories.brief({ id: SURVIVOR });
    expect(second.version).toBe(first.version);
    expect(second.markdown).toBe(first.markdown);
  });

  it('answers the surviving story’s brief for a merged ID, tagged with both stories and both desks', async () => {
    answer = () => briefData();
    const { api: called, resHeaders } = api();
    const brief = await called.social.stories.brief({ id: MERGED });
    expect(brief.storyId).toBe(SURVIVOR);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:briefs,social:story:${MERGED},social:desk:${MERGED},social:story:${SURVIVOR},social:desk:${SURVIVOR}`,
    );
  });

  it('is 422 `story_not_live` with the withdrawn words for a withdrawn story, and 404 for an unknown one', async () => {
    const { api: called, resHeaders } = api();
    answer = () => ({
      story: { id: WITHDRAWN.id, state: 'withdrawn', withdrawn_reason: WITHDRAWN.withdrawnReason },
      updates: [],
      posts: [],
      open_questions: [],
      counts: { posts: 0, replies: 0, upvotes: 0, pins: 0 },
    });
    await expect(called.social.stories.brief({ id: WITHDRAWN.id })).rejects.toMatchObject({
      code: 'REFUSED',
      status: 422,
      message: 'This story was withdrawn: pick another',
      data: { reason: 'story_not_live' },
    });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBeNull();
    answer = () => fault('P0002', 'No such story');
    await expect(called.social.stories.brief({ id: SURVIVOR })).rejects.toMatchObject({
      status: 404,
      message: 'No such story',
    });
  });
});

describe('where social is off', () => {
  it('answers each of the six as an address the API does not have, before any database call', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const { api: called } = api();
    const calls = [
      () => called.social.lists(),
      () => called.social.board(),
      () => called.social.stories.get({ id: SURVIVOR }),
      () => called.social.stories.updates({ id: SURVIVOR }),
      () => called.social.stories.posts({ id: SURVIVOR }),
      () => called.social.stories.brief({ id: SURVIVOR }),
    ];
    for (const run of calls) await expect(run()).rejects.toMatchObject(noSuchCall);
    expect(client.query).not.toHaveBeenCalled();
  });
});
