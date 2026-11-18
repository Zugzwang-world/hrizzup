import type { Redis } from '@upstash/redis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from './cache.ts';
import {
  forgetBriefs,
  MOST_CALLS,
  purgePlan,
  purgeTags,
  refreshAgent,
  refreshStories,
  storyTags,
  TAGS_A_CALL,
} from './purge.ts';

/**
 * Social's purges (R5's design note, R4 and M1 rule 7), with Vercel's purge and Redis stood in for: tags
 * go in calls of 16 all at once, the wait is bounded, a failure is counted and never thrown, a brief's
 * Redis copy is deleted before the first tag is purged, and a save never fails because its purge did.
 */

const ID = '01a1a57b-8ca0-7c96-8905-93eb7d0b0d54';
const OTHER = '01a199e9-d180-75ec-8a81-134dd403419a';
const tagList = (count: number) => Array.from({ length: count }, (_, n) => `social:test:${n}`);

function fakeRedis() {
  const calls: string[] = [];
  const redis = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async (...keys: string[]) => {
      calls.push(`del ${keys.join(' ')}`);
      return keys.length;
    }),
  };
  return { redis, calls, cache: { redis: redis as unknown as Redis, prefix: 'dev' } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSocialCache();
});

describe('a story’s tags', () => {
  it('are its story tag and its desk tag, always together', () => {
    expect(storyTags(ID)).toEqual([`social:story:${ID}`, `social:desk:${ID}`]);
  });

  it('refuse an ID that is not a UUID in lower case, since a comma must never reach a header', () => {
    expect(() => storyTags(ID.toUpperCase())).toThrow(TypeError);
    expect(() => storyTags('a,b')).toThrow(TypeError);
  });
});

describe('purging tags', () => {
  it('sends 16 tags to a call, every call started at once, repeats removed', async () => {
    const seen: string[][] = [];
    const invalidate = vi.fn(async (tags: string[]) => {
      seen.push(tags);
    });
    const tags = [...tagList(40), ...tagList(40)];
    const result = await purgeTags(tags, { waitMs: 1_000, invalidate });
    expect(result).toEqual({ calls: 3, failed: 0, late: 0 });
    expect(seen.map((chunk) => chunk.length)).toEqual([16, 16, 8]);
    expect(seen.flat()).toEqual(tagList(40));
    expect(TAGS_A_CALL).toBe(16);
  });

  it('starts every call before any finishes (all at once, never one after another)', async () => {
    let running = 0;
    let most = 0;
    const invalidate = vi.fn(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    });
    await purgeTags(tagList(160), { waitMs: 1_000, invalidate });
    expect(invalidate).toHaveBeenCalledTimes(10);
    expect(most).toBe(10);
  });

  it('makes no call for no tags', async () => {
    const invalidate = vi.fn(async () => {});
    expect(await purgeTags([], { waitMs: 10, invalidate })).toEqual({
      calls: 0,
      failed: 0,
      late: 0,
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('takes 800 tags (50 calls) and throws a RangeError for more, before purging anything', async () => {
    const invalidate = vi.fn(async () => {});
    await expect(purgeTags(tagList(800), { waitMs: 10, invalidate })).resolves.toMatchObject({
      calls: 50,
    });
    invalidate.mockClear();
    await expect(purgeTags(tagList(801), { waitMs: 10, invalidate })).rejects.toThrow(RangeError);
    expect(invalidate).not.toHaveBeenCalled();
    expect(MOST_CALLS).toBe(50);
  });

  it('counts the calls that failed, whether they reject or throw, and never throws', async () => {
    let n = 0;
    const invalidate = vi.fn((_tags: string[]): Promise<void> => {
      n++;
      if (n === 1) return Promise.reject(new Error('refused'));
      if (n === 2) throw new Error('no purge here');
      return Promise.resolve();
    });
    const result = await purgeTags(tagList(64), { waitMs: 1_000, invalidate });
    expect(result).toEqual({ calls: 4, failed: 2, late: 0 });
  });

  it('waits no longer than asked, and counts the calls still running as late', async () => {
    vi.useFakeTimers();
    const invalidate = vi.fn(
      (tags: string[]) =>
        new Promise<void>((resolve) => {
          if (tags[0] === 'social:test:0') resolve();
        }),
    );
    const done = purgeTags(tagList(48), { waitMs: 1_500, invalidate });
    await vi.advanceTimersByTimeAsync(1_499);
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toEqual({ calls: 3, failed: 0, late: 2 });
  });
});

describe('forgetting briefs', () => {
  it('deletes every brief key in one command, under the environment’s prefix', async () => {
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    await forgetBriefs([ID, OTHER]);
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del.mock.calls[0]).toEqual([
      `dev:cache:social-brief:v1:${ID}`,
      `dev:cache:social-brief:v1:${OTHER}`,
    ]);
  });

  it('does nothing with no Redis or no stories', async () => {
    resetSocialCache(null);
    await expect(forgetBriefs([ID])).resolves.toBeUndefined();
    const { redis, cache } = fakeRedis();
    resetSocialCache(cache);
    await forgetBriefs([]);
    expect(redis.del).not.toHaveBeenCalled();
  });
});

describe('refreshing stories', () => {
  it('deletes the Redis briefs before the first tag is purged, then purges each story’s two tags and the board’s when it is listed', async () => {
    const { calls, cache } = fakeRedis();
    resetSocialCache(cache);
    const invalidate = vi.fn(async (tags: string[]) => {
      calls.push(`purge ${tags.join(' ')}`);
    });
    await refreshStories([ID, OTHER, ID.toUpperCase()], { board: true, invalidate });
    expect(calls).toEqual([
      `del dev:cache:social-brief:v1:${ID} dev:cache:social-brief:v1:${OTHER}`,
      `purge social:story:${ID} social:desk:${ID} social:story:${OTHER} social:desk:${OTHER} social:board`,
    ]);
  });

  it('leaves the board’s tag out for an unlisted story', async () => {
    resetSocialCache(null);
    const invalidate = vi.fn(async (_tags: string[]) => {});
    await refreshStories([ID], { board: false, invalidate });
    expect(invalidate).toHaveBeenCalledWith([`social:story:${ID}`, `social:desk:${ID}`]);
  });

  it('never throws and logs only the error’s name, whatever throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetSocialCache(null);
    await expect(
      refreshStories(['not an id, with a secret text'], { board: true }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toEqual({ name: 'TypeError' });
    expect(JSON.stringify(log.mock.calls[0])).not.toContain('secret');
  });

  it('logs the counts of calls that failed or ran late, and nothing else, and nothing at all when every call finished', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetSocialCache(null);
    await refreshStories([ID], { board: true, invalidate: vi.fn(async (_tags: string[]) => {}) });
    expect(log).not.toHaveBeenCalled();
    // A purge that fails is counted by `purgeTags`, never raised, and the count is logged.
    const failing = vi.fn(async (_tags: string[]) => {
      throw new Error('refused: social:story:secret-looking-tag');
    });
    await expect(
      refreshStories([ID], { board: true, invalidate: failing }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toEqual({ failed: 1, late: 0 });
    expect(JSON.stringify(log.mock.calls[0])).not.toMatch(/social:|secret|refused/);
  });

  it('logs a purge still running when the wait ends as late', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetSocialCache(null);
    const slow = vi.fn((_tags: string[]) => new Promise<void>(() => {}));
    const done = refreshStories([ID], { board: false, invalidate: slow });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(done).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toEqual({ failed: 0, late: 1 });
  });
});

describe('refreshing an agent', () => {
  it('purges the agent’s tag, and the directory’s too when its card shows there', async () => {
    const invalidate = vi.fn(async (_tags: string[]) => {});
    await refreshAgent(ID, { directory: true, invalidate });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith([`social:agent:${ID}`, 'social:agents']);
    invalidate.mockClear();
    await refreshAgent(ID, { directory: false, invalidate });
    expect(invalidate).toHaveBeenCalledWith([`social:agent:${ID}`]);
  });

  it('reads the ID in lower case', async () => {
    const invalidate = vi.fn(async (_tags: string[]) => {});
    await refreshAgent(ID.toUpperCase(), { directory: true, invalidate });
    expect(invalidate).toHaveBeenCalledWith([`social:agent:${ID}`, 'social:agents']);
  });

  it('never throws: a purge that fails or throws is swallowed, and only its counts are logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      refreshAgent(ID, {
        directory: true,
        invalidate: vi.fn().mockRejectedValue(new Error('refused')),
      }),
    ).resolves.toBeUndefined();
    expect(log.mock.calls[0]?.[1]).toEqual({ failed: 1, late: 0 });
    log.mockClear();
    await expect(
      refreshAgent(ID, {
        directory: true,
        invalidate: () => {
          throw new Error('no purge here');
        },
      }),
    ).resolves.toBeUndefined();
    expect(log.mock.calls[0]?.[1]).toEqual({ failed: 1, late: 0 });
    // An ID that is no UUID is the caller's mistake, still never raised.
    log.mockClear();
    await expect(
      refreshAgent('not an id, with a secret', { directory: false }),
    ).resolves.toBeUndefined();
    expect(log.mock.calls[0]?.[1]).toEqual({ name: 'TypeError' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });

  it('logs nothing when the purge finishes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await refreshAgent(ID, { directory: true, invalidate: vi.fn(async (_tags: string[]) => {}) });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('the minute job’s purge plan', () => {
  const POST = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d';
  const AGENT = '01a1e3a0-ab00-7ef9-810c-37c5772f543f';
  const stories = (count: number) =>
    Array.from(
      { length: count },
      (_, n) => `01a1e7f8-1a00-7c3d-8e4f-${String(n).padStart(12, '0')}`,
    );

  it('is a story’s story and desk tags, each post’s tag, each agent’s tag, then the families the marks name, in that order', () => {
    expect(
      purgePlan({
        stories: [ID, OTHER],
        posts: [POST],
        agents: [AGENT],
        board: true,
        directory: true,
      }),
    ).toEqual({
      tags: [
        `social:story:${ID}`,
        `social:desk:${ID}`,
        `social:story:${OTHER}`,
        `social:desk:${OTHER}`,
        `social:post:${POST}`,
        `social:agent:${AGENT}`,
        'social:board',
        'social:agents',
      ],
      briefs: [ID, OTHER],
      overflow: false,
    });
  });

  it('names a family only when its mark is set, and nothing when there is nothing', () => {
    expect(purgePlan({ stories: [ID], board: true }).tags).toEqual([
      `social:story:${ID}`,
      `social:desk:${ID}`,
      'social:board',
    ]);
    expect(purgePlan({ agents: [AGENT], directory: true }).tags).toEqual([
      `social:agent:${AGENT}`,
      'social:agents',
    ]);
    expect(purgePlan({})).toEqual({ tags: [], briefs: [], overflow: false });
  });

  it('holds no tag twice, however often an ID repeats', () => {
    const plan = purgePlan({
      stories: [ID, ID],
      posts: [POST, POST],
      agents: [AGENT, AGENT],
      board: true,
    });
    expect(plan.tags).toHaveLength(new Set(plan.tags).size);
    expect(plan.tags).toHaveLength(5);
    expect(plan.briefs).toEqual([ID]);
  });

  it('is exactly at its limit with 800 tags: 400 stories’ tags, all of them purged', () => {
    const plan = purgePlan({ stories: stories(400) });
    expect(plan.tags).toHaveLength(MOST_CALLS * TAGS_A_CALL);
    expect(plan.overflow).toBe(false);
    expect(plan.briefs).toHaveLength(400);
  });

  it('overflows at 801 tags, counting the family tags: only the board, and the directory when its mark is set, are purged, and every brief is still deleted', () => {
    // 400 stories make 800 tags, so the board's tag makes 801.
    const over = purgePlan({ stories: stories(400), board: true });
    expect(over).toMatchObject({ tags: ['social:board'], overflow: true });
    expect(over.briefs).toHaveLength(400);
    expect(purgePlan({ stories: stories(400), board: true, directory: true }).tags).toEqual([
      'social:board',
      'social:agents',
    ]);
    // The board is purged on overflow whatever its own mark said.
    expect(
      purgePlan({ stories: stories(399), posts: [POST, OTHER, ID], directory: false }).tags,
    ).toEqual(['social:board']);
  });

  it('never makes more calls than a purge may: a plan below the limit always fits purgeTags', async () => {
    const plan = purgePlan({ stories: stories(400) });
    const result = await purgeTags(plan.tags, { waitMs: 1_000, invalidate: async () => {} });
    expect(result.calls).toBe(MOST_CALLS);
  });

  it('refuses an ID that is not a UUID in lower case, since a comma must never reach a header', () => {
    expect(() => purgePlan({ stories: [ID.toUpperCase()] })).toThrow(TypeError);
    expect(() => purgePlan({ posts: ['a,b'] })).toThrow(TypeError);
  });
});
