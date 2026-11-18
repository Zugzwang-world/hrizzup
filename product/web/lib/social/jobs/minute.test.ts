import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from '../cache.ts';
import { FRAME, framed, RECOUNT, STORIES } from './budget.ts';
import { LEASE_SECONDS, runMinute, STEPS } from './minute.ts';
import { type JobDeps, mergeIds, noIds, type Step, type StepContext } from './types.ts';

/** Vercel's purge, stood in for: every call the purge step makes, with its tags. */
const invalidate = vi.fn(async (_tags: string[]) => {});
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: (tags: string[]) => invalidate(tags),
}));

beforeEach(() => {
  // No Redis: the purge step forgets briefs there, and this test has none.
  resetSocialCache(null);
  invalidate.mockClear();
});

afterEach(() => {
  resetSocialCache();
});

/**
 * The minute job's frame (docs/social/build.md, D7, section 7.2 and 9.2's `minute.test.ts`): the lease,
 * the steps in order, each step's IDs reaching the recount, a failed step ending the run unhealthy.
 */

const IDS = {
  story: '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f',
  post: '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d',
  other: '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c8d',
  agent: '01a1e3a0-ab00-7ef9-810c-37c5772f543f',
};

/** A database stand-in that answers `job_begin` with `lease` and records `job_end`. */
function database(lease: { run: string; since: string } | null) {
  const statements: { text: string; values: unknown[] | undefined }[] = [];
  const deps: JobDeps = {
    run: async (work) =>
      work({
        query: async (text: string, values?: unknown[]) => {
          statements.push({ text, values });
          return { rows: [{ answer: text.includes('job_begin') ? lease : null }] };
        },
      } as never),
    cache: null,
    now: () => new Date('2026-11-18T10:00:00Z'),
  };
  return { deps, statements };
}

const LEASE = { run: '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8d', since: '2026-11-18T09:57:00Z' };

/** A step that records its context and answers what it is told to. */
function step(
  name: Step['name'],
  answer: Awaited<ReturnType<Step['run']>> = {},
): Step & { seen: StepContext[] } {
  const seen: StepContext[] = [];
  return {
    name,
    seen,
    run: vi.fn(async (context: StepContext) => {
      seen.push(context);
      return answer;
    }),
  };
}

describe('the lease', () => {
  it('answers busy and runs nothing when no lease is free, closing nothing', async () => {
    const { deps, statements } = database(null);
    const steps = [step('stories'), step('recount')];
    await expect(runMinute(deps, steps)).resolves.toEqual({ ran: false, busy: true });
    expect(steps[0]?.run).not.toHaveBeenCalled();
    expect(statements.map((one) => one.text)).toEqual([
      'select social.job_begin($1, $2) as answer',
    ]);
    expect(statements[0]?.values).toEqual(['minute', LEASE_SECONDS]);
    expect(LEASE_SECONDS).toBe(55);
  });

  it('refuses a lease answer that is not {run, since}', async () => {
    const { deps } = database({ run: 5 } as never);
    await expect(runMinute(deps, [])).rejects.toThrow(/job_begin/);
  });
});

describe('the steps', () => {
  it('run in order, each given the window’s start, and the IDs each answers join the ones after it', async () => {
    const { deps, statements } = database(LEASE);
    const stories = step('stories', {
      ids: { stories: [IDS.story], posts: [IDS.post] },
      summary: { merged: 1 },
    });
    const counts = step('counts', { ids: { posts: [IDS.post, IDS.other], agents: [IDS.agent] } });
    const recount = step('recount', {
      ids: { stories: [IDS.story], posts: [IDS.other] },
      data: { board: true, directory: false },
    });
    const purge = step('purge');
    const answer = await runMinute(deps, [stories, counts, recount, purge]);

    expect(answer).toEqual({
      ran: true,
      ok: true,
      runId: LEASE.run,
      steps: { stories: { merged: 1 }, counts: {}, recount: {}, purge: {} },
    });
    // The first step starts with nothing; the recount takes everything the two before it changed, once each.
    expect(stories.seen[0]?.also).toEqual(noIds());
    expect(stories.seen[0]).toMatchObject({ runId: LEASE.run, since: LEASE.since });
    expect(recount.seen[0]?.also).toEqual({
      stories: [IDS.story],
      posts: [IDS.post, IDS.other],
      agents: [IDS.agent],
    });
    // The purge sees what the recount answered, and every ID changed so far.
    expect(purge.seen[0]?.earlier.recount?.data).toEqual({ board: true, directory: false });
    expect(purge.seen[0]?.also.posts).toEqual([IDS.post, IDS.other]);
    // The lease is closed once, by its own run, healthy, with the summary.
    const ended = statements.at(-1);
    expect(ended?.text).toBe('select social.job_end($1, $2, $3, $4::jsonb)');
    expect(ended?.values?.slice(0, 3)).toEqual(['minute', LEASE.run, true]);
    expect(JSON.parse(String(ended?.values?.[3]))).toEqual({
      stories: { merged: 1 },
      counts: {},
      recount: {},
      purge: {},
    });
    expect(vi.mocked(purge.run).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(recount.run).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('end the run unhealthy when one fails: the ones after it do not run, and what is answered names only the step', async () => {
    const { deps, statements } = database(LEASE);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stories = step('stories', { ids: { stories: [IDS.story] } });
    const counts: Step = {
      name: 'counts',
      run: async () => {
        throw Object.assign(new Error('secret text of a database error'), { code: '57014' });
      },
    };
    const recount = step('recount');
    const purge = step('purge');
    const answer = await runMinute(deps, [stories, counts, recount, purge]);

    expect(answer).toEqual({
      ran: true,
      ok: false,
      runId: LEASE.run,
      failed: 'counts',
      steps: { stories: {}, counts: { failed: true } },
    });
    expect(recount.run).not.toHaveBeenCalled();
    expect(purge.run).not.toHaveBeenCalled();
    const ended = statements.at(-1);
    expect(ended?.values?.slice(0, 3)).toEqual(['minute', LEASE.run, false]);
    expect(String(ended?.values?.[3])).not.toContain('secret text');
    // The log has the step and the error's name and code, not its text.
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret text');
    expect(JSON.stringify(log.mock.calls)).toContain('57014');
    log.mockRestore();
  });

  it('are the four of section 7.2, in its order', () => {
    expect(STEPS.map((one) => one.name)).toEqual(['stories', 'counts', 'recount', 'purge']);
  });
});

describe('the four real steps', () => {
  const IDS_OUT = {
    movedStory: '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f',
    survivor: '01a1e7f8-2b00-7c3d-8e4f-5a6b7c8d9e0f',
    movedPost: '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d',
    countedPost: '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c8d',
    agent: '01a1e3a0-ab00-7ef9-810c-37c5772f543f',
  };

  /**
   * A stand-in for the database that answers each statement as its function does (the shape the SQL
   * emits: lists of IDs and the two marks), and fails any other statement, so a step that asked for
   * something it shouldn't, or in another form, fails the test instead of passing on a stand-in that
   * answers anything. Each statement is recorded with the limits its transaction was given.
   */
  function standIn(recountAnswer: unknown) {
    const statements: { text: string; values: unknown[] | undefined; limits: unknown }[] = [];
    const run: JobDeps['run'] = async (work, limits) =>
      work({
        query: async (text: string, values?: unknown[]) => {
          statements.push({ text, values, limits });
          switch (text) {
            case 'select social.job_begin($1, $2) as answer':
              return { rows: [{ answer: LEASE }] };
            case 'select social.job_sync_stories($1::timestamptz) as answer':
              return {
                rows: [
                  {
                    answer: {
                      stories: [IDS_OUT.movedStory, IDS_OUT.survivor],
                      posts: [IDS_OUT.movedPost],
                    },
                  },
                ],
              };
            case 'select social.job_recount($1::timestamptz, $2::jsonb) as answer':
              return { rows: [{ answer: recountAnswer }] };
            case 'select social.job_end($1, $2, $3, $4::jsonb)':
              return { rows: [] };
          }
          throw new Error(
            `The stand-in database was asked something no function of the job answers: ${text}`,
          );
        },
      } as never);
    const deps: JobDeps = {
      run: framed(run),
      cache: null,
      now: () => new Date('2026-11-18T10:00:00Z'),
    };
    return { deps, statements };
  }

  const RECOUNTED = {
    stories: [IDS_OUT.movedStory, IDS_OUT.survivor],
    posts: [IDS_OUT.movedPost, IDS_OUT.countedPost],
    agents: [IDS_OUT.agent],
    board: true,
    directory: false,
  };

  it('run clean: begin, sync, recount, end, in that order, each statement only as its function takes it', async () => {
    const { deps, statements } = standIn(RECOUNTED);
    const answer = await runMinute(deps);
    expect(answer).toMatchObject({ ran: true, ok: true, runId: LEASE.run });
    expect(answer).not.toHaveProperty('failed');
    expect(statements.map((one) => one.text)).toEqual([
      'select social.job_begin($1, $2) as answer',
      'select social.job_sync_stories($1::timestamptz) as answer',
      'select social.job_recount($1::timestamptz, $2::jsonb) as answer',
      'select social.job_end($1, $2, $3, $4::jsonb)',
    ]);
    // The window's start goes to both steps, as the lease gave it.
    expect(statements[1]?.values).toEqual([LEASE.since]);
    expect(statements[2]?.values?.[0]).toBe(LEASE.since);
  });

  it('give the recount every ID the stories step answered, and close the lease with a summary of IDs and counts', async () => {
    const { deps, statements } = standIn(RECOUNTED);
    await runMinute(deps);
    expect(JSON.parse(String(statements[2]?.values?.[1]))).toEqual({
      stories: [IDS_OUT.movedStory, IDS_OUT.survivor],
      posts: [IDS_OUT.movedPost],
      agents: [],
    });
    const ended = statements.at(-1);
    expect(ended?.values?.slice(0, 3)).toEqual(['minute', LEASE.run, true]);
    const summary = JSON.parse(String(ended?.values?.[3])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(summary.stories).toEqual({
      counts: { stories: 2, posts: 1 },
      sample: { stories: [IDS_OUT.movedStory, IDS_OUT.survivor], posts: [IDS_OUT.movedPost] },
    });
    expect(summary.counts).toEqual({});
    expect(summary.recount).toEqual({
      counts: { stories: 2, posts: 2, agents: 1 },
      board: true,
      directory: false,
    });
    expect(summary.purge).toMatchObject({
      briefs: 2,
      calls: 1,
      failed: 0,
      late: 0,
      overflow: false,
    });
  });

  it('limit each database call: the lease’s two the frame’s, each step its own', async () => {
    const { deps, statements } = standIn(RECOUNTED);
    await runMinute(deps);
    expect(statements.map((one) => one.limits)).toEqual([FRAME, STORIES, RECOUNT, FRAME]);
  });

  it('purge what the recount changed: every story and its desk, each post, each agent, and the board, in calls started together', async () => {
    const { deps } = standIn(RECOUNTED);
    await runMinute(deps);
    const tags = invalidate.mock.calls.flatMap(([each]) => each);
    expect(tags.sort()).toEqual(
      [
        `social:story:${IDS_OUT.movedStory}`,
        `social:desk:${IDS_OUT.movedStory}`,
        `social:story:${IDS_OUT.survivor}`,
        `social:desk:${IDS_OUT.survivor}`,
        `social:post:${IDS_OUT.movedPost}`,
        `social:post:${IDS_OUT.countedPost}`,
        `social:agent:${IDS_OUT.agent}`,
        'social:board',
      ].sort(),
    );
  });

  it('put the board on the purge when the pipeline changed a story, though the recount’s mark says no (a story just withdrawn)', async () => {
    const { deps } = standIn({ ...RECOUNTED, board: false });
    await runMinute(deps);
    expect(invalidate.mock.calls.flatMap(([each]) => each)).toContain('social:board');
  });

  it('end the run unhealthy, purging nothing, when the database answers a step wrongly', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps, statements } = standIn({ stories: [], posts: [], agents: [], board: 'yes' });
    const answer = await runMinute(deps);
    expect(answer).toEqual({
      ran: true,
      ok: false,
      runId: LEASE.run,
      failed: 'recount',
      steps: {
        stories: expect.any(Object),
        counts: {},
        recount: { failed: true },
      },
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(statements.at(-1)?.values?.slice(0, 3)).toEqual(['minute', LEASE.run, false]);
    log.mockRestore();
  });
});

describe('the IDs', () => {
  it('join without repeats, in the order found', () => {
    expect(
      mergeIds({ posts: [IDS.post] }, { posts: [IDS.other, IDS.post], stories: [IDS.story] }, {}),
    ).toEqual({ stories: [IDS.story], posts: [IDS.post, IDS.other], agents: [] });
    expect(mergeIds()).toEqual(noIds());
  });
});
