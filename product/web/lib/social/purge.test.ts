import type { Redis } from '@upstash/redis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from './cache.ts';
import {
  forgetBriefs,
  MOST_CALLS,
  purgeTags,
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

  it('never throws and logs only the error’s name, whatever fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetSocialCache(null);
    await expect(
      refreshStories(['not an id, with a secret text'], { board: true }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls[0])).not.toContain('secret');
    // A purge that fails is counted by `purgeTags`, never raised.
    const failing = vi.fn(async (_tags: string[]) => {
      throw new Error('refused');
    });
    await expect(
      refreshStories([ID], { board: true, invalidate: failing }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
