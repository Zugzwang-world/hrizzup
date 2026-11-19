import { DatabaseBusyError } from '@hrizzup/db';
import { socialRedis } from '@hrizzup/social/redis';
import { agentTag, deskTag, familyTags, postTag, storyTag } from '@hrizzup/social/tags';
import { TAKE_SCRIPT } from '@hrizzup/social/views';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../access.ts';
import { resetSocialCache } from '../cache.ts';
import { RECOUNT } from './budget.ts';
import { COUNTS_LEASE_SECONDS, runCounts } from './counts.ts';
import { APPLY, TARGETS } from './tally.ts';
import type { JobDeps } from './types.ts';

/**
 * A check run's own counting (jobs/counts.ts; docs/social/r11-design.md, section 3.7): the lease it takes (the
 * `counts` row, never the minute's), what it takes from Redis, which IDs the recount gets, the purge, how a run
 * ends, and what a deadlock does. The database and Redis are stood in for by recorders; Vercel's purge records its
 * tags. The functions' own rules are proven by the pgTAP tests and `minute.db.test.ts`.
 */

const invalidate = vi.fn(async (_tags: string[]) => {});
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: (tags: string[]) => invalidate(tags),
  waitUntil: () => undefined,
}));

const RUN = '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8d';
const P1 = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c01';
const P2 = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c02';
const S1 = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e01';
const S2 = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e02';
const F1 = '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c01';
const AX = '01a1e3a0-ab00-7ef9-810c-37c5772f5401';
const AY = '01a1e3a0-ab00-7ef9-810c-37c5772f5402';
const AZ = '01a1e3a0-ab00-7ef9-810c-37c5772f5403';
const REQUEST = { posts: [P1, P2], stories: [S1], files: [F1] };

type Name = 'begin' | 'targets' | 'apply' | 'recount' | 'end';
type Statement = { name: Name; text: string; values: unknown[] | undefined; limits: unknown };

const TARGETS_ANSWER = {
  posts: [
    { id: P1, story_id: S1, agent_id: AX },
    { id: P2, story_id: S2, agent_id: AY },
  ],
  stories: [S1],
  files: [{ id: F1, agent_id: AZ }],
};
const APPLY_ANSWER = { posts: [P1, P2], stories: [S1, S2], agents: [AX, AY, AZ], files: [F1] };
const RECOUNT_ANSWER = {
  stories: [S1, S2],
  posts: [P1, P2],
  agents: [AX, AY, AZ],
  board: true,
  directory: false,
};

/** The database's stand-in: each function answers what `answers` gives it (or an error), and every statement is recorded. */
function database(
  answers: Partial<Record<Name, unknown>> = {},
  fails: (name: Name, attempt: number) => Error | undefined = () => undefined,
) {
  const statements: Statement[] = [];
  const attempts: Record<Name, number> = { begin: 0, targets: 0, apply: 0, recount: 0, end: 0 };
  const defaults: Record<Name, unknown> = {
    begin: { run: RUN, since: '2026-11-19T09:57:00.000Z' },
    targets: TARGETS_ANSWER,
    apply: APPLY_ANSWER,
    recount: RECOUNT_ANSWER,
    end: null,
  };
  const run: Run = async (work, limits) =>
    work({
      query: async (text: string, values?: unknown[]) => {
        const name = (['begin', 'targets', 'apply', 'recount', 'end'] as const).find((one) =>
          text.includes(
            {
              begin: 'job_begin',
              targets: 'job_count_targets',
              apply: 'job_apply_counts',
              recount: 'job_recount',
              end: 'job_end',
            }[one],
          ),
        );
        if (!name) throw new Error(`An unexpected statement: ${text}`);
        statements.push({ name, text, values, limits });
        attempts[name] += 1;
        const failure = fails(name, attempts[name]);
        if (failure) throw failure;
        return {
          rows: [{ answer: Object.hasOwn(answers, name) ? answers[name] : defaults[name] }],
        };
      },
    } as never);
  const names = () => statements.map((one) => one.name);
  return { run, statements, names };
}

/** Redis's stand-in: the take script, a transaction that answers 2 for each count, and the DEL a brief's delete uses. */
function redis(take: unknown[] = [`post:${P1}`, '3', `file:${F1}`, '1']) {
  const takes: { keys: string[]; args: string[] }[] = [];
  const deleted: string[][] = [];
  const client = {
    createScript: vi.fn((script: string) => ({
      exec: vi.fn(async (keys: string[], args: string[]) => {
        if (script !== TAKE_SCRIPT) throw new Error('only the take runs here');
        takes.push({ keys, args });
        return take;
      }),
    })),
    multi: vi.fn(() => {
      const commands: string[] = [];
      const record = (name: string) => () => {
        commands.push(name);
        return pipeline;
      };
      const pipeline = {
        pfcount: record('pfcount'),
        pfmerge: record('pfmerge'),
        expire: record('expire'),
        del: record('del'),
        exec: async () => commands.map((name) => (name === 'pfcount' ? 2 : 'OK')),
      };
      return pipeline;
    }),
    del: vi.fn(async (...keys: string[]) => {
      deleted.push(keys);
      return keys.length;
    }),
  };
  return { cache: { redis: client as never, prefix: 'stg' }, takes, deleted, client };
}

function deps(db: ReturnType<typeof database>, cache: JobDeps['cache']): JobDeps {
  return { run: db.run, cache, now: () => new Date('2026-11-19T10:00:00.000Z') };
}

beforeEach(() => {
  invalidate.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSocialCache();
});

describe('the lease', () => {
  it('takes the `counts` lease for 30 seconds, and answers busy, doing nothing, when another run holds it', async () => {
    const r = redis();
    resetSocialCache(r.cache);
    const db = database({ begin: null });
    await expect(runCounts(REQUEST, deps(db, r.cache))).resolves.toEqual({
      ran: false,
      busy: true,
    });
    expect(db.names()).toEqual(['begin']);
    expect(db.statements[0]?.values).toEqual(['counts', COUNTS_LEASE_SECONDS]);
    expect(COUNTS_LEASE_SECONDS).toBe(30);
    expect(r.takes).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refuses a lease answer that is not {run, since}', async () => {
    const db = database({ begin: { run: 5 } });
    await expect(runCounts(REQUEST, deps(db, null))).rejects.toThrow(/job_begin/);
  });
});

describe('a run with Redis', () => {
  async function ran() {
    const r = redis();
    resetSocialCache(r.cache);
    const db = database();
    const answer = await runCounts(REQUEST, deps(db, r.cache));
    return { r, db, answer };
  }

  it('takes only its own fields, then targets, apply, recount and end, in that order', async () => {
    const { r, db } = await ran();
    expect(r.takes).toEqual([
      {
        keys: ['stg:count:social:v1'],
        args: ['some', `post:${P1}`, `post:${P2}`, `story:${S1}`, `file:${F1}`],
      },
    ]);
    expect(db.names()).toEqual(['begin', 'targets', 'apply', 'recount', 'end']);
    expect(db.statements[1]?.limits).toEqual(TARGETS);
    expect(db.statements[2]?.limits).toEqual(APPLY);
  });

  it('gives the recount each post’s story and agent and each file’s agent, with what the apply changed, once each', async () => {
    const { db } = await ran();
    const recount = db.statements.find((one) => one.name === 'recount');
    expect(recount?.text).toBe('select social.job_recount($1::timestamptz, $2::jsonb) as answer');
    expect(recount?.limits).toEqual(RECOUNT);
    expect(recount?.values?.[0]).toBeNull();
    const also = JSON.parse(String(recount?.values?.[1])) as Record<string, string[]>;
    expect(also.posts?.sort()).toEqual([P1, P2]);
    expect(also.stories?.sort()).toEqual([S1, S2]);
    expect(also.agents?.sort()).toEqual([AX, AY, AZ]);
  });

  it('purges the tags of everything recounted, after deleting the stories’ briefs in Redis', async () => {
    const { r } = await ran();
    expect(r.deleted).toEqual([[S1, S2].map((id) => socialRedis.brief.key('stg', id))]);
    const tags = invalidate.mock.calls.flatMap(([called]) => called);
    for (const id of [S1, S2])
      expect(tags).toEqual(expect.arrayContaining([storyTag(id), deskTag(id)]));
    for (const id of [P1, P2]) expect(tags).toContain(postTag(id));
    for (const id of [AX, AY, AZ]) expect(tags).toContain(agentTag(id));
    expect(tags).toContain(familyTags.board);
    expect(tags).not.toContain(familyTags.agents);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('ends the `counts` lease with the summary, never the minute’s row, and answers the recount’s IDs', async () => {
    const { db, answer } = await ran();
    const ended = db.statements.at(-1);
    expect(ended?.text).toBe('select social.job_end($1, $2, $3, $4::jsonb)');
    expect(ended?.values?.slice(0, 3)).toEqual(['counts', RUN, true]);
    expect(JSON.parse(String(ended?.values?.[3]))).toMatchObject({
      taken: 2,
      counted: { posts: 1, stories: 0, files: 1 },
    });
    expect(JSON.stringify(db.statements.map((one) => one.values))).not.toContain('minute');
    expect(answer).toEqual({
      ran: true,
      ok: true,
      ids: { stories: [S1, S2], posts: [P1, P2], agents: [AX, AY, AZ] },
    });
  });

  it('takes the directory family tag when the recount says a listed agent was among them', async () => {
    const r = redis();
    resetSocialCache(r.cache);
    const db = database({ recount: { ...RECOUNT_ANSWER, board: false, directory: true } });
    await runCounts(REQUEST, deps(db, r.cache));
    const tags = invalidate.mock.calls.flatMap(([called]) => called);
    expect(tags).toContain(familyTags.agents);
    expect(tags).not.toContain(familyTags.board);
  });

  it('recounts nothing when the IDs are all unknown and nothing was taken, and still ends', async () => {
    const r = redis([]);
    resetSocialCache(r.cache);
    const db = database({ targets: { posts: [], stories: [], files: [] } });
    const answer = await runCounts(REQUEST, deps(db, r.cache));
    expect(db.names()).toEqual(['begin', 'targets', 'end']);
    expect(answer).toEqual({ ran: true, ok: true, ids: { stories: [], posts: [], agents: [] } });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('recounts the requested IDs even when Redis fails the take, and says so', async () => {
    const r = redis();
    r.client.createScript.mockImplementation(() => ({
      exec: vi.fn(async () => {
        throw new Error('down');
      }),
    }));
    resetSocialCache(r.cache);
    const db = database();
    const answer = await runCounts(REQUEST, deps(db, r.cache));
    expect(db.names()).toEqual(['begin', 'targets', 'recount', 'end']);
    expect(answer).toMatchObject({ ran: true, ok: true });
    expect(JSON.parse(String(db.statements.at(-1)?.values?.[3]))).toEqual({
      taken: 0,
      redis: false,
    });
  });
});

describe('a run with no Redis', () => {
  it('reads the targets and recounts them: no take, no apply', async () => {
    resetSocialCache(null);
    const db = database();
    const answer = await runCounts(REQUEST, deps(db, null));
    expect(db.names()).toEqual(['begin', 'targets', 'recount', 'end']);
    const also = JSON.parse(String(db.statements[2]?.values?.[1])) as Record<string, string[]>;
    expect(also.posts?.sort()).toEqual([P1, P2]);
    expect(also.agents?.sort()).toEqual([AX, AY, AZ]);
    expect(JSON.parse(String(db.statements.at(-1)?.values?.[3]))).toEqual({ taken: 0 });
    expect(answer).toMatchObject({ ran: true, ok: true });
    // The requested IDs are still purged.
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('a run that fails', () => {
  it('ends `ok: false`, logging only the error’s name and code, and purges nothing', async () => {
    const r = redis();
    resetSocialCache(r.cache);
    const db = database({}, (name) =>
      name === 'recount'
        ? Object.assign(new Error('quotes some data: aaaaaaaaaaaaaaaaaaaaaa'), {
            name: 'DatabaseError',
            code: '57014',
          })
        : undefined,
    );
    const answer = await runCounts(REQUEST, deps(db, r.cache));
    expect(answer).toEqual({ ran: true, ok: false, ids: { stories: [], posts: [], agents: [] } });
    expect(db.statements.at(-1)?.values?.slice(0, 3)).toEqual(['counts', RUN, false]);
    expect(db.statements.filter((one) => one.name === 'recount')).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('DatabaseError');
    expect(logged).toContain('57014');
    expect(logged).not.toContain('quotes some data');
  });

  it('ends `ok: false` when the apply fails, the lease still closed', async () => {
    const r = redis();
    resetSocialCache(r.cache);
    const db = database({}, (name) => (name === 'apply' ? new Error('boom') : undefined));
    const answer = await runCounts(REQUEST, deps(db, r.cache));
    expect(answer).toMatchObject({ ran: true, ok: false });
    expect(db.names()).toEqual(['begin', 'targets', 'apply', 'end']);
  });

  it('ends `ok: false` for a recount answer it cannot read, never quoting it', async () => {
    const r = redis();
    resetSocialCache(r.cache);
    const db = database({
      recount: { stories: ['not-an-id'], posts: [], agents: [], board: true, directory: false },
    });
    const answer = await runCounts(REQUEST, deps(db, r.cache));
    expect(answer).toMatchObject({ ran: true, ok: false });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('not-an-id');
  });
});

describe('no retry of its own', () => {
  const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

  it('runs the recount once, and ends the run unhealthy, when it fails with a deadlock (`transaction` has tried it three times by then)', async () => {
    for (const failure of [
      deadlock,
      () => Object.assign(new Error('x'), { code: '57014' }),
      () => new DatabaseBusyError({ cause: deadlock() }),
    ]) {
      const r = redis();
      resetSocialCache(r.cache);
      const db = database({}, (name) => (name === 'recount' ? failure() : undefined));
      const answer = await runCounts(REQUEST, deps(db, r.cache));
      expect(db.statements.filter((one) => one.name === 'recount')).toHaveLength(1);
      expect(db.statements.filter((one) => one.name === 'apply')).toHaveLength(1);
      expect(answer).toMatchObject({ ran: true, ok: false });
      expect(JSON.parse(String(db.statements.at(-1)?.values?.[3]))).not.toHaveProperty('retried');
    }
  });

  it('runs the apply and the targets once, too, and takes once', async () => {
    for (const failing of ['apply', 'targets'] as const) {
      const r = redis();
      resetSocialCache(r.cache);
      const db = database({}, (name) => (name === failing ? deadlock() : undefined));
      const answer = await runCounts(REQUEST, deps(db, r.cache));
      expect(
        db.statements.filter((one) => one.name === failing),
        failing,
      ).toHaveLength(1);
      expect(r.takes).toHaveLength(1);
      expect(answer).toMatchObject({ ran: true, ok: false });
    }
  });
});
