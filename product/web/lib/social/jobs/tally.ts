import { socialRedis } from '@hrizzup/social/redis';
import { isUuid } from '@hrizzup/social/uuid';
import {
  agentUniqueKey,
  fieldOf,
  itemOf,
  takeCall,
  takenOf,
  UNIQUE_SECONDS,
  utcDay,
  visitorCapKey,
} from '@hrizzup/social/views';
import type { Run } from '../access.ts';
import type { SocialCache } from '../cache.ts';
import { reportFailure, scriptsOf, within } from '../counting.ts';
import { answerOf } from '../shape.ts';
import { checkedAnswer } from './answers.ts';
import type { Limits } from './budget.ts';
import { type Ids, noIds } from './types.ts';

/**
 * The take and the apply (docs/social/r11-design.md, decision 5 and section 3.5), shared by the minute job's
 * counts step and the counts door (`counts.ts`): four trips, one write.
 *
 * 1. **takes** the pending hash in one Redis script (the whole hash for the minute run, only a check run's own
 *    fields for the door);
 * 2. **reads its targets** in one database statement (`social.job_count_targets`): which items still count, and
 *    each post's and file's agent;
 * 3. **counts uniques** in one Redis transaction: `PFCOUNT` of each item, and `PFMERGE` of the changed posts' and
 *    files' HyperLogLogs into their agents';
 * 4. **applies** everything in one database statement (`social.job_apply_counts`).
 *
 * - **Redis is never the reason a run fails:** a take that fails or runs late takes nothing (the minute's `since`
 *   keeps moving); a uniques transaction that fails applies the totals with no unique counts, which catch up
 *   at the item's next count. A **database** statement that fails fails the step; what was taken is lost, as
 *   D7 accepts (at most a minute of views, never counted twice).
 * - **No retry of its own:** `transaction` (`@hrizzup/db`) already tries a statement again, up to three attempts, when
 *   the database ends it with a deadlock (40P01), a serialization failure (40001) or a lock wait that ran out
 *   (55P03); a statement rolled back counts nothing, so nothing here is counted twice. Past those attempts the
 *   error fails the step, and what was taken is lost, as above.
 * - **Its answer holds counts and flags only,** never an ID list, a device or an address.
 */

/** The take's wait for Redis. */
export const TAKE_WAIT_MS = 750;
/** The targets' read. */
export const TARGETS: Limits = { statementTimeoutMs: 500, lockTimeoutMs: 250 };
/** The uniques transaction's wait for Redis. */
export const UNIQUES_WAIT_MS = 750;
/** The apply's write. */
export const APPLY: Limits = { statementTimeoutMs: 1_000, lockTimeoutMs: 500 };

const TARGETS_FUNCTION = 'social.job_count_targets';
const APPLY_FUNCTION = 'social.job_apply_counts';

/** The IDs a check run asks about (`counts.ts`'s request). */
export type Wanted = { posts: string[]; stories: string[]; files: string[] };

/** What `job_count_targets` answers: the items that still count, with whose they are. */
export type Targets = {
  posts: { id: string; storyId: string; agentId: string }[];
  stories: string[];
  files: { id: string; agentId: string }[];
};

/** No target. */
export const noTargets = (): Targets => ({ posts: [], stories: [], files: [] });

/** What a take and apply answers. */
export type Tally = {
  /** What the apply changed (the recount takes it, the purge purges it), or none. */
  ids: Ids;
  /** The items that still count, of everything asked about. */
  targets: Targets;
  /** Counts and flags only. */
  summary: Record<string, unknown>;
};

// ---- The targets ----

const bad = (fn: string) =>
  new TypeError(
    `The database's answer to ${fn} isn't {posts, stories, files} as the counts step reads it`,
  );

function listOf(value: unknown, fn: string): unknown[] {
  if (!Array.isArray(value)) throw bad(fn);
  return value;
}

/** What `job_count_targets` answered, checked; any other shape is a TypeError naming the function, never quoting it. */
export function targetsOf(answer: unknown): Targets {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    throw bad(TARGETS_FUNCTION);
  }
  const record = answer as Record<string, unknown>;
  const posts = listOf(record.posts, TARGETS_FUNCTION).map((one) => {
    const row = one as { id?: unknown; story_id?: unknown; agent_id?: unknown } | null;
    if (!isUuid(row?.id) || !isUuid(row?.story_id) || !isUuid(row?.agent_id)) {
      throw bad(TARGETS_FUNCTION);
    }
    return { id: row.id, storyId: row.story_id, agentId: row.agent_id };
  });
  const stories = listOf(record.stories, TARGETS_FUNCTION).map((id) => {
    if (!isUuid(id)) throw bad(TARGETS_FUNCTION);
    return id;
  });
  const files = listOf(record.files, TARGETS_FUNCTION).map((one) => {
    const row = one as { id?: unknown; agent_id?: unknown } | null;
    if (!isUuid(row?.id) || !isUuid(row?.agent_id)) throw bad(TARGETS_FUNCTION);
    return { id: row.id, agentId: row.agent_id };
  });
  return { posts, stories, files };
}

/** One database statement of the job, in its own transaction. */
async function statement(
  run: Run,
  limits: Limits,
  text: string,
  payload: unknown,
): Promise<unknown> {
  return run(
    async (tx) => answerOf((await tx.query(text, [JSON.stringify(payload)])).rows),
    limits,
  );
}

/**
 * Which of these IDs still count, and whose they are: one statement (`social.job_count_targets`). Nothing is
 * asked, and no statement made, when there is no ID.
 */
export async function readTargets(run: Run, wanted: Wanted): Promise<Targets> {
  if (wanted.posts.length + wanted.stories.length + wanted.files.length === 0) return noTargets();
  const answer = await statement(run, TARGETS, `select ${TARGETS_FUNCTION}($1::jsonb) as answer`, {
    posts: wanted.posts,
    stories: wanted.stories,
    files: wanted.files,
  });
  return targetsOf(answer);
}

// ---- The take and the apply ----

/** What was taken, by kind: each ID with the views or reads counted since the last take. */
type TakenIds = {
  posts: Map<string, number>;
  stories: Map<string, number>;
  files: Map<string, number>;
};

const noneTaken = (): TakenIds => ({ posts: new Map(), stories: new Map(), files: new Map() });

const KINDS = [
  ['posts', 'post'],
  ['stories', 'story'],
  ['files', 'file'],
] as const;

/** The pending hash's fields of a check run's own IDs. */
function fieldsOf(wanted: Wanted): string[] {
  return [
    ...wanted.posts.map((id) => fieldOf('post', id)),
    ...wanted.stories.map((id) => fieldOf('story', id)),
    ...wanted.files.map((id) => fieldOf('file', id)),
  ];
}

type Taken = { ids: TakenIds; taken: number; dropped: number; failed: boolean };

/** Step 1: the take. A failure or a late answer takes nothing (`failed`), never throws. */
async function take(cache: SocialCache, request: Wanted | null): Promise<Taken> {
  const nothing: Taken = { ids: noneTaken(), taken: 0, dropped: 0, failed: false };
  const call = takeCall(cache.prefix, request ? fieldsOf(request) : 'all');
  if (call === null) return nothing;
  try {
    const answer = await within(
      scriptsOf(cache.redis).take.exec(call.keys, call.args),
      TAKE_WAIT_MS,
    );
    if ('late' in answer) return { ...nothing, failed: true };
    const { taken, dropped } = takenOf(answer.value);
    const ids = noneTaken();
    for (const [field, added] of taken) {
      const item = itemOf(field);
      const found = KINDS.find(([, kind]) => kind === item?.kind);
      if (item !== null && found) ids[found[0]].set(item.id, added);
    }
    return { ids, taken: taken.size, dropped, failed: false };
  } catch (error) {
    reportFailure('social counts: the take failed', error);
    return { ...nothing, failed: true };
  }
}

/** The uniques transaction's answers: each item's count, and each agent's. */
type Uniques = {
  posts: Map<string, number>;
  stories: Map<string, number>;
  files: Map<string, number>;
  agents: Map<string, { views: number | null; reads: number | null }>;
};

const count = (result: unknown): number | null => {
  const n = Number(result);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** The taken items that still count (the database's say), each with the views or reads taken. */
type Counting = {
  posts: Map<string, number>;
  stories: Map<string, number>;
  files: Map<string, number>;
};

/**
 * Step 3: one Redis transaction. `PFCOUNT` of each item that still counts, and, for each agent that gained
 * posts' views or files' reads, `PFMERGE` of those HyperLogLogs into the agent's and `PFCOUNT` of that; and
 * `DEL` of an item's HyperLogLog (and, for a post or story, today's day set) for each item that no longer
 * counts, so a made-up ID's keys are gone within the minute. A failure or a late answer is null.
 */
async function uniques(
  cache: SocialCache,
  taken: TakenIds,
  counting: Counting,
  targets: Targets,
  at: Date,
): Promise<Uniques | null> {
  const { redis, prefix } = cache;
  const pipeline = redis.multi();
  // What to do with each command's answer, in the order the commands were queued.
  const readers: ((result: unknown) => void)[] = [];
  const queue = (reader: (result: unknown) => void = () => undefined) => readers.push(reader);
  const answers: Uniques = {
    posts: new Map(),
    stories: new Map(),
    files: new Map(),
    agents: new Map(),
  };

  for (const [kind, itemKind] of KINDS) {
    for (const id of counting[kind].keys()) {
      pipeline.pfcount(socialRedis.unique.key(prefix, itemKind, id));
      queue((result) => {
        const n = count(result);
        if (n !== null) answers[kind].set(id, n);
      });
    }
  }

  const unions = (what: 'views' | 'reads') => {
    const sources = new Map<string, string[]>();
    const rows =
      what === 'views'
        ? targets.posts.filter((post) => counting.posts.has(post.id))
        : targets.files.filter((file) => counting.files.has(file.id));
    for (const row of rows) {
      const keys = sources.get(row.agentId) ?? [];
      keys.push(socialRedis.unique.key(prefix, what === 'views' ? 'post' : 'file', row.id));
      sources.set(row.agentId, keys);
    }
    for (const [agentId, keys] of sources) {
      const union = agentUniqueKey(prefix, what, agentId);
      pipeline.pfmerge(union, ...keys);
      queue();
      pipeline.expire(union, UNIQUE_SECONDS);
      queue();
      pipeline.pfcount(union);
      queue((result) => {
        const held = answers.agents.get(agentId) ?? { views: null, reads: null };
        answers.agents.set(agentId, { ...held, [what]: count(result) });
      });
    }
  };
  unions('views');
  unions('reads');

  // The taken items that no longer count: a post or story's HyperLogLog, today's day set and today's visitors' hash; a
  // file's HyperLogLog and today's visitors' hash (a file has no day set: it counts at every note, up to the cap per
  // address). A made-up ID's keys live about a minute.
  const day = utcDay(at);
  for (const [kind, itemKind] of KINDS) {
    for (const id of taken[kind].keys()) {
      if (counting[kind].has(id)) continue;
      const keys = [socialRedis.unique.key(prefix, itemKind, id)];
      if (itemKind !== 'file') keys.push(socialRedis.seen.key(prefix, day, itemKind, id));
      keys.push(visitorCapKey(prefix, day, itemKind, id));
      pipeline.del(...keys);
      queue();
    }
  }

  if (readers.length === 0) return answers;
  try {
    const waited = await within(pipeline.exec(), UNIQUES_WAIT_MS);
    if ('late' in waited) return null;
    const results: unknown = waited.value;
    if (!Array.isArray(results) || results.length !== readers.length) {
      throw new TypeError("Redis's answer to the uniques transaction isn't one answer a command");
    }
    results.forEach((result, n) => {
      readers[n]?.(result);
    });
    return answers;
  } catch (error) {
    reportFailure('social counts: the uniques were not counted', error);
    return null;
  }
}

/**
 * One take and apply (see the file's header). `request` is null for the minute run (the whole pending hash is
 * taken), or a check run's own IDs (only their fields are taken, and the targets of every one of them are
 * read, taken or not, for the recount). Throws only for a database statement that failed.
 */
export async function takeAndApply(
  deps: { run: Run; cache: SocialCache; now?: () => Date },
  request: Wanted | null,
): Promise<Tally> {
  const { run, cache } = deps;
  // 1. The take. A request with no IDs takes nothing at all.
  const got = await take(cache, request);
  const taken = got.ids;
  const base = { taken: got.taken, ...(got.failed ? { redis: false } : {}) };

  // 2. The targets, when there is any ID to ask about: what was taken, and a check run's own IDs.
  const targets = await readTargets(run, {
    posts: [...new Set([...taken.posts.keys(), ...(request?.posts ?? [])])],
    stories: [...new Set([...taken.stories.keys(), ...(request?.stories ?? [])])],
    files: [...new Set([...taken.files.keys(), ...(request?.files ?? [])])],
  });
  if (got.taken === 0 && got.dropped === 0) {
    return { ids: noIds(), targets, summary: base };
  }
  const live = {
    posts: new Set(targets.posts.map((post) => post.id)),
    stories: new Set(targets.stories),
    files: new Set(targets.files.map((file) => file.id)),
  };
  const counting: Counting = {
    posts: new Map([...taken.posts].filter(([id]) => live.posts.has(id))),
    stories: new Map([...taken.stories].filter(([id]) => live.stories.has(id))),
    files: new Map([...taken.files].filter(([id]) => live.files.has(id))),
  };
  const counted = counting.posts.size + counting.stories.size + counting.files.size;
  const summaryParts = (extra: Record<string, unknown>) => ({
    ...base,
    dropped: got.dropped + (got.taken - counted),
    counted: {
      posts: counting.posts.size,
      stories: counting.stories.size,
      files: counting.files.size,
    },
    ...extra,
  });

  // 3. The uniques (and the junk keys' clean-up, which a take of nothing but made-up IDs needs too).
  const found = await uniques(cache, taken, counting, targets, (deps.now ?? (() => new Date()))());
  if (counted === 0) {
    return { ids: noIds(), targets, summary: summaryParts({ agents: 0, uniques: found !== null }) };
  }

  // 4. The apply: only the items the database says still count, with the uniques where they were counted.
  const uniqOf = (kind: keyof Counting, id: string): number | null => found?.[kind].get(id) ?? null;
  const rowsOf = (kind: keyof Counting) =>
    [...counting[kind]].map(([id, added]) => ({ id, added, uniq: uniqOf(kind, id) }));
  const payload = {
    posts: rowsOf('posts'),
    stories: rowsOf('stories'),
    files: rowsOf('files'),
    ...(found
      ? {
          agents: [...found.agents].map(([id, held]) => ({
            id,
            uniq_views: held.views,
            uniq_reads: held.reads,
          })),
        }
      : {}),
  };
  const answer = await statement(
    run,
    APPLY,
    `select ${APPLY_FUNCTION}($1::jsonb) as answer`,
    payload,
  );
  const { stories, posts, agents } = checkedAnswer(APPLY_FUNCTION, answer, [
    'stories',
    'posts',
    'agents',
  ]);
  return {
    ids: { stories, posts, agents },
    targets,
    summary: summaryParts({ agents: agents.length, uniques: found !== null }),
  };
}
