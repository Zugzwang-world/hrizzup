import { DatabaseBusyError } from '@hrizzup/db';
import { socialRedis } from '@hrizzup/social/redis';
import { agentUniqueKey, TAKE_SCRIPT, utcDay } from '@hrizzup/social/views';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../access.ts';
import { COUNTS_RESERVE_MS } from './budget.ts';
import {
  APPLY,
  isDeadlock,
  onDeadlock,
  TAKE_WAIT_MS,
  TARGETS,
  takeAndApply,
  targetsOf,
  UNIQUES_WAIT_MS,
  withRetries,
} from './tally.ts';

/**
 * The take and the apply (docs/social/r11-design.md, section 3.5): the order of its four trips, what each sends,
 * what a Redis that fails or runs late does (never a failed run), what a database error does (a failed step),
 * and the one retry for a deadlock. Redis and the database are stood in for by recorders that put every call in
 * one list, so the order can be read; the functions' own rules are proven by the pgTAP tests
 * (`social_signals.test.sql`) and the real database test (`minute.db.test.ts`).
 */

const P1 = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c01';
const P2 = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c02';
const P3 = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c03';
const JUNK = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c0f';
const S1 = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e01';
const S2 = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e02';
const JUNK_STORY = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f';
const F1 = '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c01';
const JUNK_FILE = '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c0f';
const AX = '01a1e3a0-ab00-7ef9-810c-37c5772f5401';
const AY = '01a1e3a0-ab00-7ef9-810c-37c5772f5402';
const NOW = new Date('2026-11-19T12:00:00.000Z');
const PREFIX = 'stg';

/** Every trip of a run, in order: what the order test reads. */
let events: string[];

type Statement = { text: string; values: unknown[] | undefined; limits: unknown };

/** The database's stand-in: each function answers what `answers` gives it (or an error), and every statement is recorded. */
function database(
  answers: Partial<Record<'targets' | 'apply', unknown>> = {},
  fails: (name: 'targets' | 'apply', attempt: number) => Error | undefined = () => undefined,
) {
  const statements: Statement[] = [];
  const attempts = { targets: 0, apply: 0 };
  const run: Run = async (work, limits) =>
    work({
      query: async (text: string, values?: unknown[]) => {
        const name = text.includes('job_count_targets') ? 'targets' : 'apply';
        events.push(name);
        statements.push({ text, values, limits });
        attempts[name] += 1;
        const failure = fails(name, attempts[name]);
        if (failure) throw failure;
        return {
          rows: [{ answer: Object.hasOwn(answers, name) ? answers[name] : emptyAnswer(name) }],
        };
      },
    } as never);
  return { run, statements };
}

const emptyAnswer = (name: 'targets' | 'apply') =>
  name === 'targets'
    ? { posts: [], stories: [], files: [] }
    : { posts: [], stories: [], agents: [], files: [] };

type Redis = {
  /** What the take script answers: a flat list of fields and counts, or an error to throw, or `late`. */
  take?: unknown[] | Error | 'late';
  /** What each PFCOUNT answers, by key; 3 for any other. */
  counts?: Record<string, number>;
  /** What the uniques transaction does: its answers, an error to throw, or `late`. */
  multi?: Error | 'late';
};

/** Redis's stand-in: the take script, and a transaction that records its commands. */
function redis(options: Redis = {}) {
  const takes: { keys: string[]; args: string[] }[] = [];
  const transactions: unknown[][][] = [];
  const client = {
    createScript: vi.fn((script: string) => ({
      exec: vi.fn(async (keys: string[], args: string[]) => {
        if (script !== TAKE_SCRIPT) throw new Error('only the take runs here');
        events.push('take');
        takes.push({ keys, args });
        if (options.take instanceof Error) throw options.take;
        if (options.take === 'late') return new Promise(() => undefined);
        return options.take ?? [];
      }),
    })),
    multi: vi.fn(() => {
      const commands: unknown[][] = [];
      const record =
        (name: string) =>
        (...args: unknown[]) => {
          commands.push([name, ...args]);
          return pipeline;
        };
      const pipeline = {
        pfcount: record('pfcount'),
        pfmerge: record('pfmerge'),
        expire: record('expire'),
        del: record('del'),
        exec: vi.fn(async () => {
          events.push('uniques');
          transactions.push(commands);
          if (options.multi instanceof Error) throw options.multi;
          if (options.multi === 'late') return new Promise(() => undefined);
          return commands.map(([name, key]) =>
            name === 'pfcount' ? (options.counts?.[String(key)] ?? 3) : name === 'del' ? 1 : 'OK',
          );
        }),
      };
      return pipeline;
    }),
  };
  return { cache: { redis: client as never, prefix: PREFIX }, takes, transactions, client };
}

const uniq = (kind: 'post' | 'story' | 'file', id: string) =>
  socialRedis.unique.key(PREFIX, kind, id);
const seen = (kind: 'post' | 'story', id: string) =>
  socialRedis.seen.key(PREFIX, utcDay(NOW), kind, id);

/** The flat take answer for these fields and counts. */
const taken = (...pairs: [string, number][]) =>
  pairs.flatMap(([field, count]) => [field, String(count)]);

beforeEach(() => {
  events = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the budget', () => {
  it('adds up to no more than budget.ts’s reserve for the counts step', () => {
    expect(TAKE_WAIT_MS).toBe(750);
    expect(TARGETS).toEqual({ statementTimeoutMs: 500, lockTimeoutMs: 250 });
    expect(UNIQUES_WAIT_MS).toBe(750);
    expect(APPLY).toEqual({ statementTimeoutMs: 1_000, lockTimeoutMs: 500 });
    expect(COUNTS_RESERVE_MS).toBe(3_000);
    expect(
      TAKE_WAIT_MS + TARGETS.statementTimeoutMs + UNIQUES_WAIT_MS + APPLY.statementTimeoutMs,
    ).toBeLessThanOrEqual(COUNTS_RESERVE_MS);
  });
});

describe('the minute run: nothing to do', () => {
  it('makes no statement and no transaction for an empty take, and says {taken: 0}', async () => {
    const db = database();
    const r = redis({ take: [] });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(answer.ids).toEqual({ stories: [], posts: [], agents: [] });
    expect(answer.summary).toEqual({ taken: 0 });
    expect(db.statements).toEqual([]);
    expect(r.transactions).toEqual([]);
    expect(events).toEqual(['take']);
    // The whole hash was taken, by the script's own name for it.
    expect(r.takes[0]).toEqual({ keys: ['stg:count:social:v1'], args: ['all'] });
  });
});

describe('the order and the payloads', () => {
  const targets = {
    posts: [
      { id: P1, story_id: S1, agent_id: AX },
      { id: P2, story_id: S1, agent_id: AX },
      { id: P3, story_id: S2, agent_id: AY },
    ],
    stories: [S1],
    files: [{ id: F1, agent_id: AY }],
  };
  const pairs = taken(
    [`post:${P1}`, 4],
    [`post:${P2}`, 1],
    [`post:${P3}`, 2],
    [`story:${S1}`, 7],
    [`story:${JUNK_STORY}`, 9],
    [`file:${F1}`, 5],
    [`file:${JUNK_FILE}`, 1],
    [`post:${JUNK}`, 6],
  );
  const applied = { posts: [P1, P2, P3], stories: [S1, S2], agents: [AX, AY], files: [F1] };

  it('runs the take, the targets, the uniques and the apply, in that order, each once', async () => {
    const db = database({ targets, apply: applied });
    const r = redis({ take: pairs });
    await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(events).toEqual(['take', 'targets', 'uniques', 'apply']);
  });

  it('asks the targets of every taken ID, with the statement limits the budget gives it', async () => {
    const db = database({ targets, apply: applied });
    const r = redis({ take: pairs });
    await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    const asked = db.statements[0];
    expect(asked?.text).toBe('select social.job_count_targets($1::jsonb) as answer');
    expect(asked?.limits).toEqual(TARGETS);
    expect(JSON.parse(String(asked?.values?.[0]))).toEqual({
      posts: [P1, P2, P3, JUNK],
      stories: [S1, JUNK_STORY],
      files: [F1, JUNK_FILE],
    });
  });

  it('counts the uniques in one transaction: each counting item, each agent’s union, and the dropped items’ keys deleted', async () => {
    const db = database({ targets, apply: applied });
    const r = redis({ take: pairs });
    await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(r.client.multi).toHaveBeenCalledTimes(1);
    expect(r.transactions).toEqual([
      [
        ['pfcount', uniq('post', P1)],
        ['pfcount', uniq('post', P2)],
        ['pfcount', uniq('post', P3)],
        ['pfcount', uniq('story', S1)],
        ['pfcount', uniq('file', F1)],
        // AX's two posts into its views union, AY's one; AY's one file into its reads union.
        ['pfmerge', agentUniqueKey(PREFIX, 'views', AX), uniq('post', P1), uniq('post', P2)],
        ['expire', agentUniqueKey(PREFIX, 'views', AX), 7_776_000],
        ['pfcount', agentUniqueKey(PREFIX, 'views', AX)],
        ['pfmerge', agentUniqueKey(PREFIX, 'views', AY), uniq('post', P3)],
        ['expire', agentUniqueKey(PREFIX, 'views', AY), 7_776_000],
        ['pfcount', agentUniqueKey(PREFIX, 'views', AY)],
        ['pfmerge', agentUniqueKey(PREFIX, 'reads', AY), uniq('file', F1)],
        ['expire', agentUniqueKey(PREFIX, 'reads', AY), 7_776_000],
        ['pfcount', agentUniqueKey(PREFIX, 'reads', AY)],
        // What no longer counts: a post's or story's HyperLogLog and today's day set, a file's HyperLogLog only.
        ['del', uniq('post', JUNK), seen('post', JUNK)],
        ['del', uniq('story', JUNK_STORY), seen('story', JUNK_STORY)],
        ['del', uniq('file', JUNK_FILE)],
      ],
    ]);
  });

  it('applies only what still counts, with the uniques, and the agents’ counts, in one statement', async () => {
    const db = database({ targets, apply: applied });
    const r = redis({
      take: pairs,
      counts: {
        [uniq('post', P1)]: 2,
        [uniq('post', P2)]: 1,
        [uniq('post', P3)]: 2,
        [uniq('story', S1)]: 6,
        [uniq('file', F1)]: 4,
        [agentUniqueKey(PREFIX, 'views', AX)]: 3,
        [agentUniqueKey(PREFIX, 'views', AY)]: 2,
        [agentUniqueKey(PREFIX, 'reads', AY)]: 4,
      },
    });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    const sent = db.statements[1];
    expect(sent?.text).toBe('select social.job_apply_counts($1::jsonb) as answer');
    expect(sent?.limits).toEqual(APPLY);
    expect(JSON.parse(String(sent?.values?.[0]))).toEqual({
      posts: [
        { id: P1, added: 4, uniq: 2 },
        { id: P2, added: 1, uniq: 1 },
        { id: P3, added: 2, uniq: 2 },
      ],
      stories: [{ id: S1, added: 7, uniq: 6 }],
      files: [{ id: F1, added: 5, uniq: 4 }],
      agents: [
        { id: AX, uniq_views: 3, uniq_reads: null },
        { id: AY, uniq_views: 2, uniq_reads: 4 },
      ],
    });
    // The dropped IDs are never sent.
    expect(String(sent?.values?.[0])).not.toContain(JUNK);
    expect(String(sent?.values?.[0])).not.toContain(JUNK_STORY);
    expect(String(sent?.values?.[0])).not.toContain(JUNK_FILE);
    // The answer: what the apply changed, what was asked, and counts only.
    expect(answer.ids).toEqual({ stories: [S1, S2], posts: [P1, P2, P3], agents: [AX, AY] });
    expect(answer.targets.posts.map((post) => post.id)).toEqual([P1, P2, P3]);
    expect(answer.summary).toEqual({
      taken: 8,
      dropped: 3,
      counted: { posts: 3, stories: 1, files: 1 },
      agents: 2,
      uniques: true,
    });
    expect(JSON.stringify(answer.summary)).not.toContain(P1);
  });

  it('counts a malformed field Redis held among the dropped, and takes the rest', async () => {
    const db = database({
      targets: { posts: [{ id: P1, story_id: S1, agent_id: AX }], stories: [], files: [] },
      apply: { posts: [P1], stories: [S1], agents: [AX], files: [] },
    });
    const r = redis({ take: [...taken([`post:${P1}`, 2]), 'agent:nope', '4', `post:${P2}`, 'x'] });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(answer.summary).toMatchObject({ taken: 1, dropped: 2, counted: { posts: 1 } });
    expect(JSON.parse(String(db.statements[0]?.values?.[0])).posts).toEqual([P1]);
  });

  it('cleans the keys of a take that was nothing but made-up IDs, and applies nothing', async () => {
    const db = database({ targets: emptyAnswer('targets') });
    const r = redis({ take: taken([`post:${JUNK}`, 3], [`story:${JUNK_STORY}`, 1]) });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(events).toEqual(['take', 'targets', 'uniques']);
    expect(r.transactions).toEqual([
      [
        ['del', uniq('post', JUNK), seen('post', JUNK)],
        ['del', uniq('story', JUNK_STORY), seen('story', JUNK_STORY)],
      ],
    ]);
    expect(answer.ids).toEqual({ stories: [], posts: [], agents: [] });
    expect(answer.summary).toMatchObject({
      taken: 2,
      dropped: 2,
      counted: { posts: 0, stories: 0, files: 0 },
    });
  });
});

describe('Redis failing is never the reason a run fails', () => {
  const targets = {
    posts: [{ id: P1, story_id: S1, agent_id: AX }],
    stories: [],
    files: [],
  };

  it('a take that throws takes nothing: no statement, no IDs, and the run stays healthy', async () => {
    const db = database();
    const r = redis({
      take: Object.assign(new Error('Redis is down: it quotes a command'), {
        name: 'UpstashError',
        code: 'ECONNRESET',
      }),
    });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(answer.ids).toEqual({ stories: [], posts: [], agents: [] });
    expect(answer.summary).toEqual({ taken: 0, redis: false });
    expect(db.statements).toEqual([]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('quotes a command');
  });

  it('a take that is late (after 750 ms) takes nothing', async () => {
    vi.useFakeTimers();
    const db = database();
    const r = redis({ take: 'late' });
    const running = takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    await vi.advanceTimersByTimeAsync(TAKE_WAIT_MS - 1);
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await expect(running).resolves.toMatchObject({ summary: { taken: 0, redis: false } });
    expect(db.statements).toEqual([]);
  });

  it('a take that is not a list is a Redis failure too', async () => {
    const db = database();
    const r = redis({ take: 'OK' as never });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(answer.summary).toEqual({ taken: 0, redis: false });
  });

  it('a uniques transaction that fails applies the totals with no unique counts and no agents', async () => {
    const db = database({
      targets,
      apply: { posts: [P1], stories: [S1], agents: [AX], files: [] },
    });
    const r = redis({ take: taken([`post:${P1}`, 2]), multi: new Error('boom') });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(JSON.parse(String(db.statements[1]?.values?.[0]))).toEqual({
      posts: [{ id: P1, added: 2, uniq: null }],
      stories: [],
      files: [],
    });
    expect(answer.summary).toMatchObject({ uniques: false, counted: { posts: 1 } });
    expect(answer.ids.posts).toEqual([P1]);
  });

  it('a uniques transaction that is late (after 750 ms) applies the same way', async () => {
    vi.useFakeTimers();
    const db = database({
      targets,
      apply: { posts: [P1], stories: [S1], agents: [AX], files: [] },
    });
    const r = redis({ take: taken([`post:${P1}`, 2]), multi: 'late' });
    const running = takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    await vi.advanceTimersByTimeAsync(UNIQUES_WAIT_MS + 1);
    const answer = await running;
    expect(JSON.parse(String(db.statements[1]?.values?.[0])).posts).toEqual([
      { id: P1, added: 2, uniq: null },
    ]);
    expect(answer.summary).toMatchObject({ uniques: false });
  });

  it('a uniques answer that does not fit its commands is a failure of the transaction, not of the run', async () => {
    const db = database({
      targets,
      apply: { posts: [P1], stories: [S1], agents: [AX], files: [] },
    });
    const r = redis({ take: taken([`post:${P1}`, 2]) });
    r.client.multi.mockImplementationOnce(() => {
      const pipeline: Record<string, unknown> = {};
      for (const name of ['pfcount', 'pfmerge', 'expire', 'del']) pipeline[name] = () => pipeline;
      pipeline.exec = async () => [1];
      return pipeline as never;
    });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(answer.summary).toMatchObject({ uniques: false });
  });
});

describe('the database failing fails the step', () => {
  const targets = {
    posts: [{ id: P1, story_id: S1, agent_id: AX }],
    stories: [],
    files: [],
  };

  it('throws the error of the targets, the take already lost', async () => {
    const db = database({}, (name) => (name === 'targets' ? new Error('boom') : undefined));
    const r = redis({ take: taken([`post:${P1}`, 2]) });
    await expect(
      takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null),
    ).rejects.toThrow('boom');
    expect(events).toEqual(['take', 'targets']);
  });

  it('throws the error of the apply', async () => {
    const db = database({ targets }, (name) => (name === 'apply' ? new Error('boom') : undefined));
    const r = redis({ take: taken([`post:${P1}`, 2]) });
    await expect(
      takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null),
    ).rejects.toThrow('boom');
  });

  it('throws a TypeError that names the function and quotes nothing for an answer it cannot read', async () => {
    for (const answer of [
      null,
      [],
      { posts: 'x', stories: [], files: [] },
      { posts: [{ id: P1 }], stories: [], files: [] },
      { posts: [], stories: ['x'], files: [] },
      { posts: [], stories: [] },
    ]) {
      const db = database({ targets: answer });
      const r = redis({ take: taken([`post:${P1}`, 2]) });
      await expect(
        takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null),
        JSON.stringify(answer),
      ).rejects.toThrow(/social\.job_count_targets/);
    }
    const db = database({ targets, apply: { posts: ['not-an-id'], stories: [], agents: [] } });
    const r = redis({ take: taken([`post:${P1}`, 2]) });
    const failure = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TypeError);
    expect(String((failure as Error).message)).toContain('social.job_apply_counts');
    expect(String((failure as Error).message)).not.toContain('not-an-id');
  });

  it('reads the targets’ answer into camelCase', () => {
    expect(
      targetsOf({
        posts: [{ id: P1, story_id: S1, agent_id: AX }],
        stories: [S1],
        files: [{ id: F1, agent_id: AY }],
        extra: 'ignored',
      }),
    ).toEqual({
      posts: [{ id: P1, storyId: S1, agentId: AX }],
      stories: [S1],
      files: [{ id: F1, agentId: AY }],
    });
  });
});

describe('a check run’s request', () => {
  const request = { posts: [P1], stories: [S1], files: [F1] };

  it('takes only its own fields (`some`), and nothing at all for no IDs', async () => {
    const db = database({
      targets: {
        posts: [{ id: P1, story_id: S1, agent_id: AX }],
        stories: [S1],
        files: [{ id: F1, agent_id: AY }],
      },
      apply: { posts: [P1], stories: [S1], agents: [AX, AY], files: [F1] },
    });
    const r = redis({ take: taken([`post:${P1}`, 2]) });
    await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, request);
    expect(r.takes).toEqual([
      {
        keys: ['stg:count:social:v1'],
        args: ['some', `post:${P1}`, `story:${S1}`, `file:${F1}`],
      },
    ]);

    const none = database();
    const quiet = redis();
    const answer = await takeAndApply(
      { run: none.run, cache: quiet.cache, now: () => NOW },
      { posts: [], stories: [], files: [] },
    );
    expect(quiet.takes).toEqual([]);
    expect(quiet.client.createScript).not.toHaveBeenCalled();
    expect(none.statements).toEqual([]);
    expect(answer.summary).toEqual({ taken: 0 });
  });

  it('reads the targets of every requested ID even when nothing was taken, for the recount', async () => {
    const targets = {
      posts: [{ id: P1, story_id: S1, agent_id: AX }],
      stories: [S1],
      files: [{ id: F1, agent_id: AY }],
    };
    const db = database({ targets });
    const r = redis({ take: [] });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, request);
    expect(db.statements).toHaveLength(1);
    expect(JSON.parse(String(db.statements[0]?.values?.[0]))).toEqual({
      posts: [P1],
      stories: [S1],
      files: [F1],
    });
    expect(answer.targets).toEqual(targetsOf(targets));
    expect(answer.ids).toEqual({ stories: [], posts: [], agents: [] });
  });

  it('still reads the targets when Redis fails the take, and says so', async () => {
    const db = database({
      targets: { posts: [{ id: P1, story_id: S1, agent_id: AX }], stories: [], files: [] },
    });
    const r = redis({ take: new Error('down') });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, request);
    expect(answer.summary).toEqual({ taken: 0, redis: false });
    expect(answer.targets.posts.map((post) => post.id)).toEqual([P1]);
    expect(db.statements).toHaveLength(1);
  });
});

describe('the one retry, for a deadlock only', () => {
  const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const targets = {
    posts: [{ id: P1, story_id: S1, agent_id: AX }],
    stories: [],
    files: [],
  };
  const apply = { posts: [P1], stories: [S1], agents: [AX], files: [] };

  it('tries the apply again after a deadlock, with the same payload, and never takes again', async () => {
    const db = database({ targets, apply }, (name, attempt) =>
      name === 'apply' && attempt === 1 ? deadlock() : undefined,
    );
    const r = redis({ take: taken([`post:${P1}`, 2]) });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(events).toEqual(['take', 'targets', 'uniques', 'apply', 'apply']);
    const [first, second] = db.statements.filter((one) => one.text.includes('apply'));
    expect(second?.values).toEqual(first?.values);
    expect(second?.limits).toEqual(APPLY);
    expect(r.takes).toHaveLength(1);
    expect(r.transactions).toHaveLength(1);
    expect(answer.ids.posts).toEqual([P1]);
    expect(answer.summary).toMatchObject({ retried: ['apply'] });
  });

  it('tries the targets again after a deadlock too, and notes it', async () => {
    const db = database({ targets, apply }, (name, attempt) =>
      name === 'targets' && attempt === 1 ? deadlock() : undefined,
    );
    const r = redis({ take: taken([`post:${P1}`, 2]) });
    const answer = await takeAndApply({ run: db.run, cache: r.cache, now: () => NOW }, null);
    expect(events).toEqual(['take', 'targets', 'targets', 'uniques', 'apply']);
    expect(answer.summary).toMatchObject({ retried: ['targets'] });
  });

  it('throws a second deadlock, and any other error is not tried again', async () => {
    const twice = database({ targets, apply }, (name) =>
      name === 'apply' ? deadlock() : undefined,
    );
    await expect(
      takeAndApply(
        { run: twice.run, cache: redis({ take: taken([`post:${P1}`, 2]) }).cache, now: () => NOW },
        null,
      ),
    ).rejects.toMatchObject({ code: '40P01' });
    expect(twice.statements.filter((one) => one.text.includes('apply'))).toHaveLength(2);

    for (const code of ['40001', '55P03', '57014', '23505', undefined]) {
      events = [];
      const other = database({ targets, apply }, (name) =>
        name === 'apply' ? Object.assign(new Error('x'), code ? { code } : {}) : undefined,
      );
      await expect(
        takeAndApply(
          {
            run: other.run,
            cache: redis({ take: taken([`post:${P1}`, 2]) }).cache,
            now: () => NOW,
          },
          null,
        ),
      ).rejects.toThrow('x');
      expect(
        events.filter((event) => event === 'apply'),
        String(code),
      ).toHaveLength(1);
    }
  });

  it('knows a deadlock by its code, itself or as `transaction` wraps it once its own attempts are used up', () => {
    expect(isDeadlock(deadlock())).toBe(true);
    expect(isDeadlock(new DatabaseBusyError({ cause: deadlock() }))).toBe(true);
    expect(
      isDeadlock(
        new DatabaseBusyError({ cause: Object.assign(new Error('x'), { code: '55P03' }) }),
      ),
    ).toBe(false);
    expect(
      isDeadlock(
        new DatabaseBusyError({ cause: Object.assign(new Error('x'), { code: '40001' }) }),
      ),
    ).toBe(false);
    expect(isDeadlock(new DatabaseBusyError())).toBe(false);
    expect(isDeadlock(Object.assign(new Error('x'), { code: '40001' }))).toBe(false);
    expect(isDeadlock(Object.assign(new Error('x'), { cause: deadlock() }))).toBe(false);
    for (const nothing of [null, undefined, 'text', 5, {}]) expect(isDeadlock(nothing)).toBe(false);
  });

  it('onDeadlock runs the statement once, or twice after a deadlock, and notes its name', async () => {
    const retried: string[] = [];
    await expect(onDeadlock('apply', retried, async () => 'done')).resolves.toBe('done');
    expect(retried).toEqual([]);
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new DatabaseBusyError({ cause: deadlock() }))
      .mockResolvedValueOnce('again');
    await expect(onDeadlock('recount', retried, attempt)).resolves.toBe('again');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(retried).toEqual(['recount']);
    expect(withRetries({ taken: 1 }, retried)).toEqual({ taken: 1, retried: ['recount'] });
    expect(withRetries({ taken: 1, retried: ['apply'] }, retried)).toEqual({
      taken: 1,
      retried: ['apply', 'recount'],
    });
    expect(withRetries({ taken: 1 }, [])).toEqual({ taken: 1 });
  });
});
