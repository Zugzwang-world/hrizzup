import type { Ctx } from './context.ts';
import { CastError, refuse } from './errors.ts';
import { type Call, refusedBy, sendRaw } from './http.ts';
import { list, object, text, whole } from './lenient.ts';
import { type LogEntry, readLog, totalsOf } from './log.ts';
import { MEMBERS, readCast } from './members.ts';
import { readSnapshot, type SnapshotFile } from './snapshot.ts';
import { readState } from './state.ts';

/**
 * `report [--runs a,b]` (rule 18): compares the snapshot after run *a* with the one after run *b*
 * (by default the last two runs on the current set) and prints PASS or FAIL for each of nine
 * checks, R1 to R9, exiting 0 only if every one passes. It reads every set post's thread in full,
 * so what the cast's replies were (their depth, their intent, who answered whom, and when) comes
 * from what readers see, not from the cast's own log alone. A run's window is measured on the
 * database's clock: from the first check-in's `asOf` to the last finished check-in's `at`.
 */

/** A reply as a thread gives it, for the fields the checks need. */
export type ThreadReply = {
  id: string;
  postId: string;
  parentId: string | null;
  author: string;
  intent: string;
  depth: number;
  createdAt: string;
};

export type RunData = { n: number; snapshot: SnapshotFile; entries: LogEntry[] };

export type Who = { key: string; handle: string };

export type ReportInput = {
  a: RunData;
  b: RunData;
  members: Who[];
  /** Every reply under every set post, read in full. */
  replies: ThreadReply[];
};

export type Check = { id: string; title: string; pass: boolean; evidence: string[] };

export type Grid = Record<string, [number, number, number]>;

export const INTENTS = ['ask', 'answer', 'add', 'push-back'] as const;
export const KINDS = ['text', 'image', 'video', 'audio'] as const;
/** A reply this deep that isn't an `ask` is a thread that has ended: nobody owes it an answer. */
const THREAD_ENDS_AT = 3;

type Window = { from: number; to: number };

/** From the first check-in's `asOf` to the last finished check-in's `at` (both the database's clock). */
export function windowOf(entries: LogEntry[]): Window | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const entry of entries) {
    if (entry.type === 'checkin') starts.push(Date.parse(entry.asOf));
    if (entry.type === 'checkin_done') ends.push(Date.parse(entry.at));
  }
  const from = Math.min(...starts.filter(Number.isFinite));
  const to = Math.max(...ends.filter(Number.isFinite));
  return Number.isFinite(from) && Number.isFinite(to) && from <= to ? { from, to } : null;
}

const within = (window: Window, time: string): boolean => {
  const at = Date.parse(time);
  return Number.isFinite(at) && at >= window.from && at <= window.to;
};

/** How many of the eight cells the protocol aims to fill (four intents at depth 0 and 1) are filled. */
export function cellsFilled(grid: Grid): number {
  let filled = 0;
  for (const intent of INTENTS) {
    const row = grid[intent];
    if (row?.[0]) filled++;
    if (row?.[1]) filled++;
  }
  return filled;
}

function gridOf(replies: ThreadReply[]): Grid {
  const grid: Grid = {};
  for (const intent of INTENTS) grid[intent] = [0, 0, 0];
  for (const reply of replies) {
    const row = grid[reply.intent];
    const column = Math.min(Math.max(reply.depth, 0), 2);
    if (row) row[column] = (row[column] ?? 0) + 1;
  }
  return grid;
}

const ids = (items: string[], most = 6) =>
  items.length <= most
    ? items.join(', ')
    : `${items.slice(0, most).join(', ')} and ${items.length - most} more`;

/** The nine checks, from what was read. Pure: nothing here reads or writes anything. */
export function evaluate(input: ReportInput): { checks: Check[]; grid: Grid } {
  const { a, b, members, replies } = input;
  const handles = new Set(members.map((member) => member.handle));
  const castReplies = replies.filter((reply) => handles.has(reply.author));
  const grid = gridOf(castReplies);
  const checks: Check[] = [];
  const add = (id: string, title: string, pass: boolean, ...evidence: string[]) =>
    checks.push({ id, title, pass, evidence });

  // The cast's posts, as the desks show them after run b.
  const castPosts = Object.values(b.snapshot.desks)
    .flat()
    .filter((post) => handles.has(post.author));

  // R1. Every set story is on the Top board.
  const missing = b.snapshot.storyIds.filter((id) => !b.snapshot.top.includes(id));
  add(
    'R1',
    'every set story is on the Top board',
    missing.length === 0,
    `${b.snapshot.storyIds.length - missing.length} of ${b.snapshot.storyIds.length} set stories are on the Top board after run ${b.n}`,
    ...(missing.length > 0 ? [`not on it: ${ids(missing)}`] : []),
  );

  // R2. More than half of the set's tiles have a picture.
  const pictures = b.snapshot.storyIds.filter((id) => b.snapshot.tiles[id]?.picture).length;
  add(
    'R2',
    "more than half of the set's tiles have a picture",
    pictures * 2 > b.snapshot.storyIds.length,
    `${pictures} of ${b.snapshot.storyIds.length} tiles have a picture after run ${b.n}`,
  );

  // R3. The cast's posts include text, image, video and audio.
  const kinds = new Map<string, number>(KINDS.map((kind) => [kind, 0]));
  for (const post of castPosts) kinds.set(post.kind, (kinds.get(post.kind) ?? 0) + 1);
  const lacking = KINDS.filter((kind) => !kinds.get(kind));
  add(
    'R3',
    "the cast's posts include text, image, video and audio",
    lacking.length === 0,
    `${castPosts.length} posts on the desks: ${KINDS.map((kind) => `${kind} ${kinds.get(kind) ?? 0}`).join(', ')}`,
    ...(lacking.length > 0 ? [`none of: ${lacking.join(', ')}`] : []),
  );

  // R4. The cast's posts come from five or more members.
  const authors = new Set(castPosts.map((post) => post.author));
  add(
    'R4',
    "the cast's posts come from five or more members",
    authors.size >= 5,
    `${authors.size} members posted: ${[...authors].sort().join(', ') || 'none'}`,
  );

  // R5. The cast's replies reach depth 1 and include ask, answer, add and push-back.
  const deepest = castReplies.reduce((most, reply) => Math.max(most, reply.depth), -1);
  const intents = new Set(castReplies.map((reply) => reply.intent));
  const noIntent = INTENTS.filter((intent) => !intents.has(intent));
  add(
    'R5',
    "the cast's replies reach depth 1 and include ask, answer, add and push-back",
    deepest >= 1 && noIntent.length === 0,
    `${castReplies.length} replies by the cast, the deepest at depth ${Math.max(deepest, 0)}`,
    ...(noIntent.length > 0 ? [`none of: ${noIntent.join(', ')}`] : []),
    `cells filled (four intents at depth 0 and 1): ${cellsFilled(grid)} of 8`,
  );

  // R6. After run b the set's tiles hold at least a's posts and more replies and upvotes than after run a, and a had some of each.
  const sums = (snapshot: SnapshotFile) => {
    const total = { posts: 0, replies: 0, upvotes: 0 };
    for (const id of snapshot.storyIds) {
      const tile = snapshot.tiles[id];
      total.posts += tile?.posts ?? 0;
      total.replies += tile?.replies ?? 0;
      total.upvotes += tile?.upvotes ?? 0;
    }
    return total;
  };
  const [tilesA, tilesB] = [sums(a.snapshot), sums(b.snapshot)];
  const loggedOf = (run: RunData) => {
    const totals = totalsOf(run.entries);
    return `${totals.posts.size} posts, ${totals.replies.size} replies, ${totals.upvotes.size} upvotes`;
  };
  add(
    'R6',
    'after run b the set has at least as many posts as after run a, and more replies and more upvotes, and after run a it had some of each',
    tilesA.posts > 0 &&
      tilesA.replies > 0 &&
      tilesA.upvotes > 0 &&
      tilesB.posts >= tilesA.posts &&
      tilesB.replies > tilesA.replies &&
      tilesB.upvotes > tilesA.upvotes,
    `after run ${a.n}, on the set's tiles: ${tilesA.posts} posts, ${tilesA.replies} replies, ${tilesA.upvotes} upvotes`,
    `after run ${b.n}, on the set's tiles: ${tilesB.posts} posts, ${tilesB.replies} replies, ${tilesB.upvotes} upvotes`,
    `the cast's own log: run ${a.n} made ${loggedOf(a)}; run ${b.n} made ${loggedOf(b)}`,
  );

  // R7. The set's Top order differs between a and b: the order of the stories both snapshots hold, so a story added or lost in between moves nothing.
  const inB = new Set(b.snapshot.top);
  const inA = new Set(a.snapshot.top);
  const orderA = a.snapshot.top.filter((id) => inB.has(id));
  const orderB = b.snapshot.top.filter((id) => inA.has(id));
  add(
    'R7',
    "the set's Top order differs between the two snapshots",
    orderA.length >= 2 && JSON.stringify(orderA) !== JSON.stringify(orderB),
    `after run ${a.n}: ${orderA.map((id) => id.slice(-4)).join(' ') || 'none'}`,
    `after run ${b.n}: ${orderB.map((id) => id.slice(-4)).join(' ') || 'none'}`,
    ...(orderA.length < 2 ? ['fewer than two stories are on the Top board in both snapshots'] : []),
  );

  // R8. Every reply made to a member in a's window has a direct child by that member, made in b's window.
  const windowA = windowOf(a.entries);
  const windowB = windowOf(b.entries);
  const byId = new Map(replies.map((reply) => [reply.id, reply]));
  const postAuthor = new Map<string, string>();
  for (const snapshot of [a.snapshot, b.snapshot]) {
    for (const desk of Object.values(snapshot.desks)) {
      for (const post of desk) postAuthor.set(post.id, post.author);
    }
  }
  // A post the desks don't hold (the cast's log knows it) has its member's handle.
  for (const entry of [...a.entries, ...b.entries]) {
    const author = members.find((member) => member.key === entry.member)?.handle;
    if (entry.type === 'post' && author && !postAuthor.has(entry.id))
      postAuthor.set(entry.id, author);
  }
  if (!windowA || !windowB) {
    add(
      'R8',
      "every reply made to a member in run a's window is answered by that member in run b's window",
      false,
      `run ${windowA ? b.n : a.n} has no window: it has no check-in with an asOf and a finished one with an at`,
    );
  } else {
    const owed: Array<{ reply: ThreadReply; addressee: string }> = [];
    for (const reply of replies) {
      if (!within(windowA, reply.createdAt)) continue;
      const addressee = reply.parentId
        ? byId.get(reply.parentId)?.author
        : postAuthor.get(reply.postId);
      if (!addressee || !handles.has(addressee) || addressee === reply.author) continue;
      if (reply.depth >= THREAD_ENDS_AT && reply.intent !== 'ask') continue;
      owed.push({ reply, addressee });
    }
    const unanswered = owed.filter(
      ({ reply, addressee }) =>
        !replies.some(
          (child) =>
            child.parentId === reply.id &&
            child.author === addressee &&
            within(windowB, child.createdAt),
        ),
    );
    add(
      'R8',
      "every reply made to a member in run a's window is answered by that member in run b's window",
      owed.length > 0 && unanswered.length === 0,
      owed.length === 0
        ? `no reply was made to a member in run ${a.n}'s window, so there is nothing that was followed up`
        : `${owed.length - unanswered.length} of ${owed.length} replies made to a member in run ${a.n}'s window were answered by that member in run ${b.n}'s window`,
      ...unanswered
        .slice(0, 8)
        .map(({ reply, addressee }) => `not answered: reply ${reply.id} to ${addressee}`),
    );
  }

  // R9. All six members finished a check-in in run b, with a note.
  const unfinished = members.filter(
    (member) =>
      !b.entries.some(
        (entry) =>
          entry.type === 'checkin_done' && entry.member === member.key && entry.noteLength > 0,
      ),
  );
  add(
    'R9',
    `all ${members.length} members finished a check-in in run b, with a note`,
    unfinished.length === 0,
    `${members.length - unfinished.length} of ${members.length} members finished a check-in with a note in run ${b.n}`,
    ...(unfinished.length > 0 ? [`not: ${unfinished.map((member) => member.key).join(', ')}`] : []),
  );

  return { checks, grid };
}

/** What a thread's reply is, for the fields the checks need. */
function replyOf(raw: Record<string, unknown>, postId: string): ThreadReply | null {
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    postId: text(raw.postId) ?? postId,
    parentId: text(raw.parentId),
    author: text(object(raw.agent).handle) ?? '',
    intent: text(raw.intent) ?? '',
    depth: whole(raw.depth) ?? 0,
    createdAt: text(raw.createdAt) ?? '',
  };
}

const MOST_READS = 3_000;

/**
 * Every reply under a post, a level at a time: the post's own, then the replies under each reply that
 * has any (by staging's count, or because the cast's log says it answered it).
 */
async function readThread(
  ctx: Ctx,
  postId: string,
  answeredInLog: Set<string>,
  budget: { reads: number },
  gone: string[],
): Promise<ThreadReply[]> {
  const found = new Map<string, ThreadReply>();
  async function level(parent: string | null, depth: number): Promise<void> {
    let cursor: string | null = null;
    const here: Record<string, unknown>[] = [];
    for (let page = 0; page < 20; page++) {
      if (++budget.reads > MOST_READS) {
        throw refuse('The threads are too big to read in full: refused');
      }
      const call: Call = {
        method: 'GET',
        path: `/social/posts/${postId}/replies`,
        query: { limit: '100', ...(parent ? { parent } : {}), ...(cursor ? { cursor } : {}) },
      };
      const answer = await sendRaw(ctx, call);
      // A post staging no longer has (404) has no thread to read: it is named in the report, and the rest go on.
      if (answer.status === 404) {
        if (!gone.includes(postId)) gone.push(postId);
        return;
      }
      if (!answer.ok) throw refusedBy(call, answer);
      here.push(...list(answer.body.replies));
      cursor = text(answer.body.next);
      if (!cursor) break;
    }
    for (const raw of here) {
      const reply = replyOf(raw, postId);
      if (!reply || found.has(reply.id)) continue;
      found.set(reply.id, reply);
      if (((whole(raw.children) ?? 0) > 0 || answeredInLog.has(reply.id)) && depth < 8) {
        await level(reply.id, depth + 1);
      }
    }
  }
  await level(null, 0);
  return [...found.values()];
}

/** The two runs to compare: `--runs a,b`, or the last two runs on the current set. */
function pickRuns(ctx: Ctx, given: string | undefined): [number, number] {
  const state = readState(ctx.store);
  if (given !== undefined) {
    const parts = given.split(',');
    const [a, b] = parts.map((part) => (/^[1-9][0-9]*$/.test(part) ? Number(part) : Number.NaN));
    if (parts.length !== 2 || a === undefined || b === undefined || !(a < b)) {
      throw refuse('Use `report --runs <a>,<b>`: two run numbers, the earlier first');
    }
    for (const n of [a, b]) {
      if (!state.runs.some((run) => run.n === n)) throw refuse(`Run ${n} has not been started`);
    }
    return [a, b];
  }
  const set = state.current?.file ?? state.runs.at(-1)?.set;
  const onSet = state.runs.filter((run) => run.set === set).map((run) => run.n);
  const [a, b] = onSet.slice(-2);
  if (a === undefined || b === undefined) {
    throw refuse('The report compares two runs on the set: only one has been made');
  }
  return [a, b];
}

const need = (ctx: Ctx, n: number): SnapshotFile => {
  const snapshot = readSnapshot(ctx.store, n);
  if (!snapshot) {
    throw refuse(`There is no snapshot after run ${n}: \`snapshot after-run-${n} --wait\` first`);
  }
  return snapshot;
};

export async function reportCommand(ctx: Ctx, args: { runs?: string }): Promise<void> {
  const [a, b] = pickRuns(ctx, args.runs);
  const state = readState(ctx.store);
  for (const n of [a, b]) {
    if (state.runs.find((run) => run.n === n)?.open)
      throw refuse(`Run ${n} is open: \`run end\` first`);
  }
  const snapshotA = need(ctx, a);
  const snapshotB = need(ctx, b);
  const runA: RunData = { n: a, snapshot: snapshotA, entries: readLog(ctx.store, a) };
  const runB: RunData = { n: b, snapshot: snapshotB, entries: readLog(ctx.store, b) };

  const cast = readCast(ctx.store);
  const members: Who[] = MEMBERS.map((member) => ({
    key: member.key,
    handle: cast.members[member.key]?.handle ?? member.handle,
  }));

  // Every set post: those on the desks at either snapshot, and any the cast's log knows.
  const postIds = new Set<string>();
  for (const snapshot of [snapshotA, snapshotB]) {
    for (const desk of Object.values(snapshot.desks)) for (const post of desk) postIds.add(post.id);
  }
  const answeredInLog = new Set<string>();
  for (const entry of [...runA.entries, ...runB.entries]) {
    if (entry.type === 'post') postIds.add(entry.id);
    if (entry.type === 'reply' && entry.parentId) answeredInLog.add(entry.parentId);
  }
  ctx.io.out(
    `reading ${postIds.size} posts' threads in full (staging allows 40 reads a minute here)...`,
  );
  const budget = { reads: 0 };
  const gone: string[] = [];
  const replies: ThreadReply[] = [];
  for (const postId of [...postIds].sort()) {
    replies.push(...(await readThread(ctx, postId, answeredInLog, budget, gone)));
  }

  const { checks, grid } = evaluate({ a: runA, b: runB, members, replies });

  const failed = checks.filter((check) => !check.pass);
  const lines: string[] = [
    `report: after-run-${a} against after-run-${b}, on ${snapshotB.set}`,
    `staging's commit: ${snapshotA.commit} at the first snapshot, ${snapshotB.commit} at the second${snapshotA.commit === snapshotB.commit ? '' : ' (it changed between them)'}`,
    `read ${postIds.size - gone.length} posts' threads in full: ${replies.length} replies`,
    ...gone.map((id) => `post ${id} has no thread (404): skipped`),
  ];
  for (const check of checks) {
    lines.push(`${check.pass ? 'PASS' : 'FAIL'} ${check.id} ${check.title}`);
    for (const line of check.evidence) lines.push(`       ${line}`);
  }
  lines.push("the cast's replies, intent by depth:");
  for (const intent of INTENTS) {
    const [d0, d1, deeper] = grid[intent] ?? [0, 0, 0];
    lines.push(`  ${intent}: d0 ${d0}, d1 ${d1}, d2 or deeper ${deeper}`);
  }
  lines.push(`  cells filled (four intents at depth 0 and 1): ${cellsFilled(grid)} of 8`);
  lines.push(
    failed.length === 0
      ? `all ${checks.length} checks pass`
      : `${failed.length} of ${checks.length} checks fail: ${failed.map((check) => check.id).join(', ')}`,
  );
  for (const line of lines) ctx.io.out(line);

  ctx.store.writeJson(`reports/after-run-${a}-after-run-${b}.json`, {
    format: 'hrizzup-cast-report/1',
    createdAt: new Date(ctx.clock.now()).toISOString(),
    a,
    b,
    commits: [snapshotA.commit, snapshotB.commit],
    checks,
    grid,
    posts: postIds.size,
    gone,
    replies: replies.length,
  });
  if (failed.length > 0) {
    throw new CastError(
      1,
      `report: ${failed.length} of ${checks.length} checks fail (${failed.map((check) => check.id).join(', ')})`,
    );
  }
}
