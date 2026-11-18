import type { Redis } from '@upstash/redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from '../../cache.ts';
import { PURGE_WAIT_MS, RECOUNT, STORIES } from '../budget.ts';
import { noIds, type StepAnswer, type StepContext } from '../types.ts';
import { step as purge } from './purge.ts';
import { step as recount } from './recount.ts';
import { step as stories } from './stories.ts';

/**
 * The three steps R5 builds (R5's design note, M2 rules 6 to 8): the statement each makes and its
 * values and limits, the shape each demands of its function's answer, what each hands the steps after
 * it, and the purge's rules: briefs before tags, the board's mark or a story the pipeline changed, a
 * purge that fails leaving the run healthy. Vercel's purge, the database and Redis are stood in for.
 */

const invalidate = vi.fn(async (_tags: string[]) => {});
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: (tags: string[]) => invalidate(tags),
}));

const S1 = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f';
const S2 = '01a1e7f8-2b00-7c3d-8e4f-5a6b7c8d9e0f';
const P1 = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d';
const P2 = '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c8d';
const A1 = '01a1e3a0-ab00-7ef9-810c-37c5772f543f';
const SINCE = '2026-11-18T09:57:00';

type Statement = { text: string; values: unknown[] | undefined; limits: unknown };

/** A step's context with a database that answers what it is told and records each statement. */
function context(
  answer: unknown,
  extra: Partial<StepContext> = {},
): { context: StepContext; statements: Statement[] } {
  const statements: Statement[] = [];
  return {
    statements,
    context: {
      run: async (work, limits) =>
        work({
          query: async (text: string, values?: unknown[]) => {
            statements.push({ text, values, limits });
            return { rows: [{ answer }] };
          },
        } as never),
      cache: null,
      now: () => new Date('2026-11-18T10:00:00Z'),
      runId: '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8d',
      since: SINCE,
      also: noIds(),
      earlier: {},
      ...extra,
    },
  };
}

beforeEach(() => {
  resetSocialCache(null);
  invalidate.mockReset();
  invalidate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSocialCache();
});

describe('the stories step', () => {
  it('calls social.job_sync_stories with the window’s start, within its own limits, and answers the IDs it moved', async () => {
    const { context: given, statements } = context({ stories: [S1, S2], posts: [P1] });
    const answer = await stories.run(given);
    expect(stories.name).toBe('stories');
    expect(statements).toEqual([
      {
        text: 'select social.job_sync_stories($1::timestamptz) as answer',
        values: [SINCE],
        limits: STORIES,
      },
    ]);
    expect(answer.ids).toEqual({ stories: [S1, S2], posts: [P1] });
    expect(answer.summary).toEqual({
      counts: { stories: 2, posts: 1 },
      sample: { stories: [S1, S2], posts: [P1] },
    });
    expect(answer.data).toBeUndefined();
  });

  it('names the first 20 IDs of each list and counts the rest', async () => {
    const many = Array.from(
      { length: 45 },
      (_, n) => `01a1e7f8-1a00-7c3d-8e4f-${String(n).padStart(12, '0')}`,
    );
    const answer = await stories.run(context({ stories: many, posts: [] }).context);
    expect(answer.summary).toEqual({
      counts: { stories: 45, posts: 0 },
      sample: { stories: many.slice(0, 20), posts: [] },
    });
    expect(answer.ids?.stories).toHaveLength(45);
  });

  it('answers no IDs for a window with nothing in it', async () => {
    const answer = await stories.run(context({ stories: [], posts: [] }).context);
    expect(answer.ids).toEqual({ stories: [], posts: [] });
    expect(answer.summary).toMatchObject({ counts: { stories: 0, posts: 0 } });
  });

  it('refuses an answer that is not exactly {stories, posts} of UUIDs, naming the function and never quoting the answer', async () => {
    const wrong: unknown[] = [
      null,
      [],
      'text',
      {},
      { stories: [S1] },
      { stories: [S1], posts: [P1], extra: [] },
      { stories: S1, posts: [] },
      { stories: ['not-a-uuid'], posts: [] },
      { stories: [S1.toUpperCase()], posts: [] },
      { stories: [S1, 5], posts: [] },
      { stories: [], posts: [{ id: P1 }] },
    ];
    for (const answer of wrong) {
      const error = await stories.run(context(answer).context).catch((caught: unknown) => caught);
      expect(error, JSON.stringify(answer)).toBeInstanceOf(TypeError);
      expect(String((error as Error).message)).toContain('social.job_sync_stories');
      expect(String((error as Error).message)).not.toContain('not-a-uuid');
    }
  });
});

describe('the recount step', () => {
  const recounted = { stories: [S1], posts: [P1, P2], agents: [A1], board: true, directory: false };

  it('calls social.job_recount with the window’s start and every ID the earlier steps changed, within its own limits', async () => {
    const also = { stories: [S1, S2], posts: [P1], agents: [A1] };
    const { context: given, statements } = context(recounted, { also });
    const answer = await recount.run(given);
    expect(recount.name).toBe('recount');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      text: 'select social.job_recount($1::timestamptz, $2::jsonb) as answer',
      limits: RECOUNT,
    });
    expect(statements[0]?.values?.[0]).toBe(SINCE);
    expect(JSON.parse(String(statements[0]?.values?.[1]))).toEqual(also);
    expect(answer.ids).toEqual({ stories: [S1], posts: [P1, P2], agents: [A1] });
    expect(answer.data).toEqual({ board: true, directory: false });
    expect(answer.summary).toEqual({
      counts: { stories: 1, posts: 2, agents: 1 },
      board: true,
      directory: false,
    });
  });

  it('sends `also` as the three lists even when nothing changed before it', async () => {
    const { context: given, statements } = context({
      ...recounted,
      stories: [],
      posts: [],
      agents: [],
    });
    await recount.run(given);
    expect(JSON.parse(String(statements[0]?.values?.[1]))).toEqual({
      stories: [],
      posts: [],
      agents: [],
    });
  });

  it('refuses an answer that is not {stories, posts, agents, board, directory}', async () => {
    const wrong: unknown[] = [
      null,
      {},
      { stories: [], posts: [], agents: [] },
      { ...recounted, board: 'yes' },
      { ...recounted, directory: 1 },
      { ...recounted, agents: undefined },
      { ...recounted, extra: true },
      { ...recounted, posts: ['x'] },
    ];
    for (const answer of wrong) {
      const error = await recount.run(context(answer).context).catch((caught: unknown) => caught);
      expect(error, JSON.stringify(answer)).toBeInstanceOf(TypeError);
      expect(String((error as Error).message)).toContain('social.job_recount');
    }
  });

  it('reads a JSON answer the driver gave as text', async () => {
    const answer = await recount.run(context(JSON.stringify(recounted)).context);
    expect(answer.ids).toEqual({ stories: [S1], posts: [P1, P2], agents: [A1] });
  });
});

describe('the purge step', () => {
  const withRecount = (
    data: unknown,
    ids: StepAnswer['ids'],
    touched: string[] = [],
  ): StepContext =>
    context(null, {
      earlier: {
        stories: { ids: { stories: touched } },
        recount: { ids, data },
      },
    }).context;
  const purged = () => invalidate.mock.calls.flatMap(([tags]) => tags);

  it('purges each recounted story and its desk, each post and each agent, and the families the marks name', async () => {
    const answer = await purge.run(
      withRecount({ board: true, directory: true }, { stories: [S1], posts: [P1], agents: [A1] }),
    );
    expect(purge.name).toBe('purge');
    expect(purged().sort()).toEqual(
      [
        `social:story:${S1}`,
        `social:desk:${S1}`,
        `social:post:${P1}`,
        `social:agent:${A1}`,
        'social:board',
        'social:agents',
      ].sort(),
    );
    expect(answer.summary).toEqual({
      briefs: 1,
      tags: 6,
      calls: 1,
      failed: 0,
      late: 0,
      overflow: false,
    });
  });

  it('leaves the families out when no mark names them', async () => {
    await purge.run(
      withRecount({ board: false, directory: false }, { stories: [S1], posts: [], agents: [] }),
    );
    expect(purged().sort()).toEqual([`social:desk:${S1}`, `social:story:${S1}`].sort());
  });

  it('purges the board when the stories step returned a story, though the recount’s mark is false (a story the pipeline just withdrew)', async () => {
    await purge.run(
      withRecount({ board: false, directory: false }, { stories: [], posts: [], agents: [] }, [S2]),
    );
    expect(purged()).toEqual(['social:board']);
  });

  it('purges nothing, and makes no call, when nothing changed', async () => {
    const answer = await purge.run(
      withRecount({ board: false, directory: false }, { stories: [], posts: [], agents: [] }),
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(answer.summary).toEqual({
      briefs: 0,
      tags: 0,
      calls: 0,
      failed: 0,
      late: 0,
      overflow: false,
    });
  });

  it('treats anything missing as empty: no recount answer, or one with no IDs or marks', async () => {
    await expect(purge.run(context(null).context)).resolves.toMatchObject({
      summary: { tags: 0, calls: 0 },
    });
    await expect(purge.run(withRecount(undefined, undefined))).resolves.toMatchObject({
      summary: { tags: 0 },
    });
    await expect(purge.run(withRecount({ board: 'true' }, {}))).resolves.toMatchObject({
      summary: { tags: 0 },
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('purges only the families, and says so, above 800 tags', async () => {
    const many = Array.from(
      { length: 401 },
      (_, n) => `01a1e7f8-1a00-7c3d-8e4f-${String(n).padStart(12, '0')}`,
    );
    const answer = await purge.run(
      withRecount({ board: false, directory: true }, { stories: many, posts: [], agents: [] }),
    );
    expect(purged().sort()).toEqual(['social:agents', 'social:board']);
    expect(answer.summary).toMatchObject({ briefs: 401, tags: 2, calls: 1, overflow: true });
  });

  it('deletes the briefs of the recounted stories in Redis, once, before the first tag is purged', async () => {
    const order: string[] = [];
    const redis = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async (...keys: string[]) => {
        order.push(`del ${keys.length}`);
        return keys.length;
      }),
    };
    resetSocialCache({ redis: redis as unknown as Redis, prefix: 'dev' });
    invalidate.mockImplementation(async () => {
      order.push('purge');
    });
    await purge.run(
      withRecount({ board: true, directory: false }, { stories: [S1, S2], posts: [], agents: [] }),
    );
    expect(redis.del).toHaveBeenCalledOnce();
    expect(redis.del.mock.calls[0]).toHaveLength(2);
    expect(order).toEqual(['del 2', 'purge']);
  });

  it('leaves the run healthy when a purge call fails, and counts it', async () => {
    invalidate.mockRejectedValue(new Error('the edge is down'));
    const answer = await purge.run(
      withRecount({ board: true, directory: false }, { stories: [S1], posts: [], agents: [] }),
    );
    expect(answer.summary).toMatchObject({ calls: 1, failed: 1, late: 0 });
    expect(JSON.stringify(answer)).not.toContain('the edge is down');
  });

  it('waits no longer than its wait for a purge that runs late, and counts it', async () => {
    vi.useFakeTimers();
    invalidate.mockImplementation(() => new Promise<void>(() => {}));
    const running = purge.run(
      withRecount({ board: true, directory: false }, { stories: [], posts: [], agents: [] }),
    );
    await vi.advanceTimersByTimeAsync(PURGE_WAIT_MS);
    await expect(running).resolves.toMatchObject({ summary: { calls: 1, failed: 0, late: 1 } });
  });
});
