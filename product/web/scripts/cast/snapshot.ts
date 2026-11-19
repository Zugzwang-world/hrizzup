import type { Ctx } from './context.ts';
import { CastError, limited, refuse } from './errors.ts';
import { send, sendRaw } from './http.ts';
import { list, object, text, whole } from './lenient.ts';
import { type LogEntry, readLog, totalsOf } from './log.ts';
import { type RunRecord, readState, type State } from './state.ts';
import type { Store } from './store.ts';

/**
 * `snapshot after-run-<n> [--wait]` (rule 17): what the board and the desks showed once a run's
 * writes had settled, saved in `snapshots/after-run-<n>.json` for `report` and for `run show`'s
 * projection. Staging counts a story's posts, replies and upvotes with a minute job and keeps its
 * public reads at the edge, so a snapshot waits until 6 minutes after the run's last write, then
 * reads the Top board once a minute until every set story's counts have reached what the cast's
 * log says it did, and gives up after 20 minutes. Social's calls are beta: each answer is read by
 * hand, for the fields needed only, and the rest is ignored.
 */

export const SNAPSHOT_FORMAT = 'hrizzup-cast-snapshot/1';
export const SETTLE_MS = 6 * 60_000;
export const POLL_MS = 60_000;
export const GIVE_UP_MS = 20 * 60_000;

export type Tile = {
  posts: number;
  replies: number;
  upvotes: number;
  /** The picture's address, or null: the story has none. */
  picture: string | null;
  /** Its place on the whole board (1 is first), among every story staging lists. */
  rank: number | null;
};

export type DeskPost = {
  id: string;
  author: string;
  kind: string;
  /** The post's counts as the desk gave them (numbers only). */
  counts: Record<string, number>;
};

export type Counts = { posts: number; replies: number; upvotes: number };

export type SnapshotFile = {
  format: typeof SNAPSHOT_FORMAT;
  label: string;
  run: number;
  /** The set file the run was on. */
  set: string;
  /** Every story of the set when the snapshot was taken. */
  storyIds: string[];
  takenAt: string;
  /** Staging's commit from `/api/health`, or "unknown". */
  commit: string;
  /** The run's last write, from the log (this process's clock). */
  lastWriteAt: string;
  /** The set's stories in the Top board's order, and in the Latest board's. */
  top: string[];
  latest: string[];
  tiles: Record<string, Tile>;
  /** Each story's desk, Top first, with every post's author, kind and counts. */
  desks: Record<string, DeskPost[]>;
  /** What the cast's log says it did on each story, over every run on the set up to this one. */
  logged: Record<string, Counts>;
};

export const LABEL = /^after-run-([1-9][0-9]*)$/;

export const snapshotPath = (run: number) => `snapshots/after-run-${run}.json`;

export function readSnapshot(store: Store, run: number): SnapshotFile | null {
  return store.readJson<SnapshotFile>(snapshotPath(run));
}

/** The latest snapshot of a run numbered below `run` (the last the session has to steer by), or null. */
export function snapshotBefore(store: Store, state: State, run: number): SnapshotFile | null {
  const numbers = state.runs
    .map((one) => one.n)
    .filter((n) => n < run)
    .sort((a, b) => b - a);
  for (const n of numbers) {
    const found = readSnapshot(store, n);
    if (found) return found;
  }
  return null;
}

export type Projected = {
  id: string;
  /** The last snapshot's replies on the story, and this run's so far. */
  base: number;
  plus: number;
};

/**
 * The Top order the story set would have if the last snapshot's replies were joined by this run's
 * (rule 3.1, `run show`): by replies, most first, ties keeping the snapshot's order (the set file's
 * order when there is no snapshot). The design says replies alone order Top, because every story is
 * the same age; staging's real ranking is its own (R11 may change it), so this is a projection.
 */
export function projectTop(
  snapshot: SnapshotFile | null,
  storyIds: string[],
  thisRun: Record<string, number>,
): { order: Projected[]; differs: boolean | null } {
  const rankOf = (id: string): number => {
    const at = snapshot ? snapshot.top.indexOf(id) : -1;
    return at >= 0 ? at : (snapshot?.top.length ?? 0) + storyIds.indexOf(id);
  };
  const order = storyIds
    .map((id) => ({ id, base: snapshot?.tiles[id]?.replies ?? 0, plus: thisRun[id] ?? 0 }))
    .sort((a, b) => b.base + b.plus - (a.base + a.plus) || rankOf(a.id) - rankOf(b.id));
  const differs = snapshot
    ? JSON.stringify(order.map((one) => one.id)) !==
      JSON.stringify(snapshot.top.filter((id) => storyIds.includes(id)))
    : null;
  return { order, differs };
}

const WRITES = new Set(['pin', 'unpin', 'post', 'reply', 'upvote', 'upload', 'checkin_done']);

/** The time of a run's last write, from the log; the run's start when it wrote nothing. */
export function lastWriteOf(entries: LogEntry[], run: RunRecord): number {
  let latest = Date.parse(run.startedAt);
  for (const entry of entries) {
    if (!WRITES.has(entry.type)) continue;
    const at = Date.parse(entry.t);
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return latest;
}

/** What the cast's log says it did on each story: distinct posts, replies, and (member, post) upvotes. */
export function loggedPerStory(entries: LogEntry[], storyIds: string[]): Record<string, Counts> {
  const totals = totalsOf(entries);
  const per: Record<string, Counts> = {};
  for (const id of storyIds) per[id] = { posts: 0, replies: 0, upvotes: 0 };
  for (const post of totals.posts.values()) {
    const counts = per[post.storyId];
    if (counts) counts.posts++;
  }
  for (const reply of totals.replies.values()) {
    const counts = per[reply.storyId];
    if (counts) counts.replies++;
  }
  for (const upvote of totals.upvotes.values()) {
    const counts = per[upvote.storyId];
    if (counts) counts.upvotes++;
  }
  return per;
}

/** Which stories' tiles are behind the log (a story the cast did nothing on is never waited for). */
export function stoppingStories(
  tiles: Record<string, Tile>,
  logged: Record<string, Counts>,
): string[] {
  const behind: string[] = [];
  for (const [id, want] of Object.entries(logged)) {
    if (want.posts + want.replies + want.upvotes === 0) continue;
    const tile = tiles[id];
    if (
      !tile ||
      tile.posts < want.posts ||
      tile.replies < want.replies ||
      tile.upvotes < want.upvotes
    ) {
      behind.push(id);
    }
  }
  return behind;
}

/** The board, in one sort, down to the page that has every wanted story (or its last page). */
async function readBoard(
  ctx: Ctx,
  sort: 'top' | 'latest',
  wanted: string[],
): Promise<{ order: string[]; tiles: Record<string, Tile> }> {
  const want = new Set(wanted);
  const order: string[] = [];
  const tiles: Record<string, Tile> = {};
  let rank = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const answer = await send(ctx, {
      method: 'GET',
      path: '/social/board',
      query: { sort, limit: '100', ...(cursor ? { cursor } : {}) },
    });
    for (const tile of list(answer.body.stories)) {
      rank++;
      const id = text(tile.id);
      if (!id || !want.has(id) || tiles[id]) continue;
      const counts = object(tile.counts);
      order.push(id);
      tiles[id] = {
        posts: whole(counts.posts) ?? 0,
        replies: whole(counts.replies) ?? 0,
        upvotes: whole(counts.upvotes) ?? 0,
        picture: tile.picture ? (text(object(tile.picture).url) ?? 'yes') : null,
        rank,
      };
    }
    cursor = text(answer.body.next);
    if (!cursor || order.length === want.size) break;
  }
  return { order, tiles };
}

/** A story's desk, Top first, every post with its author, kind and counts. */
async function readDesk(ctx: Ctx, storyId: string): Promise<DeskPost[]> {
  const posts: DeskPost[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const answer = await send(ctx, {
      method: 'GET',
      path: `/social/stories/${storyId}/posts`,
      query: { sort: 'top', limit: '100', ...(cursor ? { cursor } : {}) },
    });
    for (const post of list(answer.body.posts)) {
      const id = text(post.id);
      if (!id) continue;
      const counts: Record<string, number> = {};
      for (const [name, value] of Object.entries(object(post.counts))) {
        const number = whole(value);
        if (number !== null) counts[name] = number;
      }
      posts.push({
        id,
        author: text(object(post.agent).handle) ?? '',
        kind: text(post.kind) ?? '',
        counts,
      });
    }
    cursor = text(answer.body.next);
    if (!cursor) break;
  }
  return posts;
}

/** Staging's commit from the health page, or "unknown" when it can't be read (the snapshot never fails for it). */
async function stagingCommit(ctx: Ctx): Promise<string> {
  try {
    const answer = await sendRaw(ctx, {
      method: 'GET',
      path: '/api/health',
      root: true,
      once: true,
    });
    const commit = text(answer.body.commit);
    return commit && /^[A-Za-z0-9._-]{1,64}$/.test(commit) ? commit : 'unknown';
  } catch (error) {
    if (error instanceof CastError && (error.exit === 3 || error.exit === 4)) return 'unknown';
    throw error;
  }
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

export async function snapshotCommand(
  ctx: Ctx,
  args: { label: string; wait: boolean },
): Promise<void> {
  const labelled = LABEL.exec(args.label);
  if (!labelled) throw refuse('A snapshot is named after its run: `after-run-<n>`');
  const n = Number(labelled[1]);
  const state = readState(ctx.store);
  const run = state.runs.find((one) => one.n === n);
  if (!run) throw refuse(`Run ${n} has not been started`);
  if (run.open) throw refuse(`Run ${n} is open: \`run end\` first`);
  // A later run that has written is in the board and the desks: a snapshot "after run n" would hold its writes.
  const wrote = state.runs.find(
    (one) => one.n > n && readLog(ctx.store, one.n).some((entry) => WRITES.has(entry.type)),
  );
  if (wrote)
    throw refuse(`Run ${wrote.n} has written: a snapshot after run ${n} would hold its writes`);

  // The runs on the set up to this one, and every story of the set.
  const onSet = state.runs.filter((one) => one.set === run.set && one.n <= n);
  if (!state.current) throw refuse('No story set is loaded: nothing to take a snapshot of');
  if (state.current.file !== run.set) {
    throw refuse(
      `Run ${n} was on ${run.set}, which is not the current set (${state.current.file})`,
    );
  }
  const storyIds = state.current.storyIds;
  const entries = onSet.flatMap((one) => readLog(ctx.store, one.n));
  const logged = loggedPerStory(entries, storyIds);
  const lastWrite = lastWriteOf(readLog(ctx.store, n), run);

  // 1. Wait until the run's writes have settled: 6 minutes after the last of them.
  const readyAt = lastWrite + SETTLE_MS;
  const early = readyAt - ctx.clock.now();
  if (early > 0) {
    if (!args.wait) {
      throw limited(
        `Run ${n}'s writes are still settling: wait ${seconds(early)} seconds (6 minutes after its last write), or use --wait`,
      );
    }
    ctx.io.out(`waiting ${seconds(early)} seconds: 6 minutes after run ${n}'s last write`);
    await ctx.clock.sleep(early);
  }

  // 2. Read the Top board once a minute until each set story's counts have reached the log's.
  const giveUpAt = ctx.clock.now() + GIVE_UP_MS;
  let board = await readBoard(ctx, 'top', storyIds);
  for (let poll = 1; ; poll++) {
    const behind = stoppingStories(board.tiles, logged);
    if (behind.length === 0) break;
    ctx.io.out(
      `read ${poll}: ${behind.length} of ${storyIds.length} stories are behind the cast's log`,
    );
    if (!args.wait) {
      throw limited(
        `The board has not caught up with the log (${behind.length} stories): wait 60 seconds and run it again, or use --wait`,
      );
    }
    if (ctx.clock.now() + POLL_MS > giveUpAt) {
      throw limited(
        `The board did not catch up with the log in 20 minutes (${behind.length} stories still behind): wait 600 seconds and run it again`,
      );
    }
    await ctx.clock.sleep(POLL_MS);
    board = await readBoard(ctx, 'top', storyIds);
  }

  // 3. Then the Latest board once, each desk (Top first), and staging's commit.
  const latest = await readBoard(ctx, 'latest', storyIds);
  const desks: Record<string, DeskPost[]> = {};
  for (const id of storyIds) desks[id] = await readDesk(ctx, id);
  const commit = await stagingCommit(ctx);

  // A later run that wrote while this waited would be in what was read: refuse to call it "after run n".
  const after = readState(ctx.store);
  for (const later of after.runs.filter((one) => one.n > n)) {
    if (readLog(ctx.store, later.n).some((entry) => WRITES.has(entry.type))) {
      throw refuse(`Run ${later.n} wrote while the snapshot waited: it would hold its writes`);
    }
  }

  const file: SnapshotFile = {
    format: SNAPSHOT_FORMAT,
    label: args.label,
    run: n,
    set: run.set,
    storyIds,
    takenAt: new Date(ctx.clock.now()).toISOString(),
    commit,
    lastWriteAt: new Date(lastWrite).toISOString(),
    top: board.order,
    latest: latest.order,
    tiles: board.tiles,
    desks,
    logged,
  };
  ctx.store.writeJson(snapshotPath(n), file);
  const posts = Object.values(desks).reduce((sum, desk) => sum + desk.length, 0);
  const pictures = Object.values(board.tiles).filter((tile) => tile.picture !== null).length;
  ctx.io.out(
    `saved ${snapshotPath(n)}: ${board.order.length} of ${storyIds.length} stories on the Top board, ${posts} posts on the desks, ${pictures} stories with a picture, staging commit ${commit}`,
  );
}
