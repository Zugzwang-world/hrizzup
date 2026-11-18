import { social as examples } from '@hrizzup/api/examples';
import { socialRedis } from '@hrizzup/social/redis';
import type { Redis } from '@upstash/redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from './cache.ts';

/**
 * A story's brief (R5's design note, M1 rule 6 and R3), with the database and Redis stood in for: the
 * database by a recording stand-in that answers like `social.brief_data` (and counts its calls), Redis by
 * a map with the commands the cache uses. What matters: a Redis copy is kept only under the ID of the
 * story it describes, never for a merged ID or a withdrawn story (a kept "nothing" would hide a later
 * change), and nothing fails when Redis does.
 */

const asked: { text: string; values: unknown[] | undefined }[] = [];
let answer: (id: string) => unknown = () => ({});
const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'begin' || text === 'rollback' || text === 'commit') return { rows: [] };
    if (text.startsWith('select set_config')) return { rows: [] };
    asked.push({ text, values });
    const result = answer(String(values?.[0]));
    if (result instanceof Error) throw result;
    return { rows: [{ answer: result }] };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

const { briefOf, loadBrief } = await import('./brief.ts');

/** A stand-in Redis with just the commands the cache uses. */
function fakeRedis(overrides: Partial<Record<'get' | 'set' | 'del', unknown>> = {}) {
  const store = new Map<string, unknown>();
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const key of keys) store.delete(key);
      return keys.length;
    }),
    ...overrides,
  };
  return { redis, store, cache: { redis: redis as unknown as Redis, prefix: 'dev' } };
}

const STORY = examples.board.storyDetail;
if (STORY.state !== 'live') throw new Error('The example story is live');
const SURVIVOR = STORY.id;
const MERGED = '01a19aea-2a80-7d1f-9d0d-b58cdf6ccb84';
const WITHDRAWN = '01a19cd1-3c40-7a1b-8b2c-4a7e1d9f0b55';
const KEY = (id: string) => socialRedis.brief.key('dev', id);

/** `social.brief_data`'s answer for the example story. */
const liveData = (storyId = SURVIVOR) => ({
  story: {
    id: storyId,
    title: STORY.title,
    summary: STORY.summary,
    categories: STORY.categories,
    places: STORY.places,
    latest_at: STORY.latestAt,
    state: 'live',
  },
  updates: [...STORY.updates].reverse().map((update) => ({
    id: update.id,
    headline: update.headline,
    body: update.body,
    reported_at: update.reportedAt,
    sources: update.sources,
    corrects: update.corrects,
  })),
  posts: [],
  open_questions: [],
  counts: { posts: 0, replies: 0, upvotes: 0, pins: 0 },
});
const withdrawnData = () => ({
  story: { id: WITHDRAWN, state: 'withdrawn', withdrawn_reason: 'No exchange confirmed this.' },
  updates: [],
  posts: [],
  open_questions: [],
  counts: { posts: 0, replies: 0, upvotes: 0, pins: 0 },
});

/** Each ID as the database answers it: the surviving story's data for the merged ID too. */
const database = (id: string) => {
  if (id === SURVIVOR || id === MERGED) return liveData(SURVIVOR);
  if (id === WITHDRAWN) return withdrawnData();
  return Object.assign(new Error('No such story'), { code: 'P0002' });
};

beforeEach(() => {
  answer = database;
});
afterEach(() => {
  vi.clearAllMocks();
  asked.length = 0;
  resetSocialCache();
});

describe('building a brief', () => {
  it('is pure: the same data gives the same version and file, whenever it is built', () => {
    const first = briefOf(liveData() as never, '2026-11-17T10:00:00Z');
    const second = briefOf(liveData() as never, '2026-11-18T11:30:00Z');
    expect(first?.version).toBe(second?.version);
    expect(first?.markdown).toBe(second?.markdown);
    expect(first?.builtAt).toBe('2026-11-17T10:00:00Z');
    expect(first?.storyId).toBe(SURVIVOR);
    expect(first?.markdown).toContain(`# ${STORY.title}`);
  });

  it('is made now when no time is given, and is null for a withdrawn story', () => {
    const before = Date.now();
    const brief = briefOf(liveData() as never);
    expect(Date.parse(brief?.builtAt ?? '')).toBeGreaterThanOrEqual(before - 1000);
    expect(briefOf(withdrawnData() as never)).toBeNull();
  });
});

describe('loading a brief with Redis', () => {
  it('asks the database on a miss, keeps the brief for 120 seconds under its own ID, and serves it from Redis next time', async () => {
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    const first = await loadBrief(SURVIVOR);
    expect(first?.storyId).toBe(SURVIVOR);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.brief_data($1) as answer');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(KEY(SURVIVOR), first, { ex: 120 });
    expect(await loadBrief(SURVIVOR)).toEqual(first);
    expect(asked).toHaveLength(1);
  });

  it('serves a Redis hit without asking the database', async () => {
    const { store, cache } = fakeRedis();
    const kept = briefOf(liveData() as never, '2026-11-17T10:00:00Z');
    store.set(KEY(SURVIVOR), kept);
    resetSocialCache(cache);
    expect(await loadBrief(SURVIVOR)).toEqual(kept);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('reads the ID in lower case: one story is one key', async () => {
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    await loadBrief(SURVIVOR.toUpperCase());
    expect(asked[0]?.values).toEqual([SURVIVOR]);
    expect(redis.set).toHaveBeenCalledWith(KEY(SURVIVOR), expect.anything(), { ex: 120 });
  });

  it('answers the surviving story’s brief for a merged ID every time, asks the database every time, and keeps nothing', async () => {
    const { redis, store, cache } = fakeRedis();
    resetSocialCache(cache);
    const first = await loadBrief(MERGED);
    const second = await loadBrief(MERGED);
    expect(first?.storyId).toBe(SURVIVOR);
    expect(second?.storyId).toBe(SURVIVOR);
    expect(second?.version).toBe(first?.version);
    expect(asked.map((statement) => statement.values?.[0])).toEqual([MERGED, MERGED]);
    expect(redis.set).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('answers null for a withdrawn story every time, asks the database every time, and keeps no copy of "nothing"', async () => {
    const { redis, store, cache } = fakeRedis();
    resetSocialCache(cache);
    expect(await loadBrief(WITHDRAWN)).toBeNull();
    expect(await loadBrief(WITHDRAWN)).toBeNull();
    expect(asked).toHaveLength(2);
    expect(redis.set).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('sees a story withdrawn after it was kept as soon as its copy is deleted, never before', async () => {
    const { store, cache } = fakeRedis();
    resetSocialCache(cache);
    expect((await loadBrief(SURVIVOR))?.storyId).toBe(SURVIVOR);
    answer = (id) =>
      id === SURVIVOR
        ? { ...withdrawnData(), story: { ...withdrawnData().story, id: SURVIVOR } }
        : database(id);
    // The kept copy is served until the purge deletes it (the minute job, a console save).
    expect((await loadBrief(SURVIVOR))?.storyId).toBe(SURVIVOR);
    store.delete(KEY(SURVIVOR));
    expect(await loadBrief(SURVIVOR)).toBeNull();
  });

  it('lets an unknown ID be a 404 from the database, and keeps nothing', async () => {
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    await expect(loadBrief('01a19cd1-3c40-7a1b-8b2c-000000000000')).rejects.toMatchObject({
      status: 404,
      message: 'No such story',
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('is answered by the database when Redis cannot answer or write, and nothing fails', async () => {
    const down = fakeRedis({
      get: vi.fn(async () => {
        throw new Error('down');
      }),
      set: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    resetSocialCache(down.cache);
    expect((await loadBrief(SURVIVOR))?.storyId).toBe(SURVIVOR);
    expect((await loadBrief(MERGED))?.storyId).toBe(SURVIVOR);
    expect(await loadBrief(WITHDRAWN)).toBeNull();
    expect(asked).toHaveLength(3);
  });
});

describe('loading a brief with no Redis', () => {
  it('reads the database each time', async () => {
    resetSocialCache(null);
    expect((await loadBrief(SURVIVOR))?.storyId).toBe(SURVIVOR);
    expect((await loadBrief(MERGED))?.storyId).toBe(SURVIVOR);
    expect(await loadBrief(WITHDRAWN)).toBeNull();
    expect(asked).toHaveLength(3);
  });
});
