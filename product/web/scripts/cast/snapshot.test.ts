import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Harness, harness, idOf, seedSet } from './harness.ts';
import { appendLog, type LogEntry } from './log.ts';
import { main } from './main.ts';
import {
  GIVE_UP_MS,
  loggedPerStory,
  POLL_MS,
  projectTop,
  readSnapshot,
  SETTLE_MS,
  type SnapshotFile,
  snapshotBefore,
  snapshotCommand,
  stoppingStories,
} from './snapshot.ts';
import { readState, writeState } from './state.ts';

/** Test group 10, the snapshot (rule 17): it waits, polls, gives up, and saves what the board and the desks showed. */

vi.setConfig({ testTimeout: 60_000 });

const STORIES = [idOf(10), idOf(11), idOf(12)];
const [S1, S2, S3] = STORIES as [string, string, string];
const POST1 = idOf(20);
const POST2 = idOf(21);

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const iso = (ms: number) => new Date(ms).toISOString();
const MINUTE = 60_000;

/** The set is loaded, run 1 was made and closed, and its last write was `agoMs` ago. */
function closedRun(options: { agoMs?: number; n?: number; entries?: LogEntry[] } = {}): void {
  const n = options.n ?? 1;
  seedSet(h, STORIES);
  const state = readState(h.store);
  state.runs.push({
    n,
    set: 'set.json',
    open: false,
    startedAt: iso(h.clock.now() - 60 * MINUTE),
    endedAt: iso(h.clock.now() - (options.agoMs ?? 0)),
  });
  writeState(h.store, state);
  const at = iso(h.clock.now() - (options.agoMs ?? 0));
  const entries: LogEntry[] = options.entries ?? [
    {
      t: at,
      member: 'explainer',
      type: 'post',
      id: POST1,
      storyId: S1,
      kind: 'video',
      format: null,
      mediaId: idOf(60),
    },
    {
      t: at,
      member: 'source-checker',
      type: 'reply',
      id: idOf(40),
      postId: POST1,
      parentId: null,
      storyId: S1,
      intent: 'ask',
      depth: 0,
    },
    { t: at, member: 'analyst', type: 'upvote', postId: POST1, storyId: S1 },
    {
      t: at,
      member: 'meme-maker',
      type: 'post',
      id: POST2,
      storyId: S2,
      kind: 'image',
      format: 'meme',
      mediaId: idOf(61),
    },
  ];
  for (const entry of entries) appendLog(h.store, n, entry);
}

/** The board once it has caught up with run 1's log: S1 has a post, a reply and an upvote; S2 a post. */
function settledBoard(): void {
  h.board.top = [
    { id: idOf(99), counts: { posts: 5 } },
    { id: S2, counts: { posts: 1 }, picture: { url: 'https://media.example/s2.webp' } },
    { id: S1, counts: { posts: 1, replies: 1, upvotes: 1 } },
    { id: S3 },
  ];
  h.board.latest = [{ id: S3 }, { id: S1 }, { id: S2 }];
  h.board.desks.set(S1, [
    {
      id: POST1,
      kind: 'video',
      agent: { handle: 'hztest_explainer' },
      counts: { replies: 1, upvotes: 1, views: 9 },
    },
  ]);
  h.board.desks.set(S2, [
    {
      id: POST2,
      kind: 'image',
      agent: { handle: 'hztest_meme_maker' },
      counts: { replies: 0, upvotes: 0 },
    },
  ]);
}

const snapshot = (...argv: string[]) => main(['snapshot', ...argv], h.io, () => h.ctx);
const printed = () => h.printed();

describe('what it refuses', () => {
  it("a label that is not a run's, a run that has not been made, an open one, and one that is not the last", async () => {
    closedRun();
    expect(await snapshot('after-run-x')).toBe(2);
    expect(await snapshot('today')).toBe(2);
    expect(await snapshot('after-run-0')).toBe(2);
    expect(await snapshot()).toBe(2);
    expect(await snapshot('after-run-1', 'after-run-2')).toBe(2);
    expect(await snapshot('after-run-2')).toBe(2);
    expect(printed()).toContain('Run 2 has not been started');

    const state = readState(h.store);
    const [only] = state.runs;
    if (!only) throw new Error('no run');
    only.open = true;
    writeState(h.store, state);
    expect(await snapshot('after-run-1', '--wait')).toBe(2);
    expect(printed()).toContain('Run 1 is open');

    only.open = false;
    state.runs.push({
      n: 2,
      set: 'set.json',
      open: true,
      startedAt: iso(h.clock.now()),
      endedAt: null,
    });
    writeState(h.store, state);
    // A later run that has started but written nothing is no hindrance; one that has written is.
    appendLog(h.store, 2, { t: iso(h.clock.now()), member: 'explainer', type: 'pin', storyId: S1 });
    expect(await snapshot('after-run-1', '--wait')).toBe(2);
    expect(printed()).toContain('Run 2 has written');
    expect(h.server.requests).toEqual([]);
  });

  it('a run on a set that is not the current one, and any snapshot with no set loaded', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    const state = readState(h.store);
    state.current = { file: 'other.json', storyIds: STORIES, loadedAt: iso(h.clock.now()) };
    writeState(h.store, state);
    expect(await snapshot('after-run-1')).toBe(2);
    expect(printed()).toContain('not the current set');
    state.current = null;
    writeState(h.store, state);
    expect(await snapshot('after-run-1')).toBe(2);
    expect(printed()).toContain('No story set is loaded');
  });
});

describe('waiting for the writes to settle', () => {
  it("without --wait, says how long until 6 minutes after the run's last write (exit 4), and reads nothing", async () => {
    closedRun({ agoMs: 2 * MINUTE });
    settledBoard();
    expect(await snapshot('after-run-1')).toBe(4);
    expect(printed()).toContain('wait 240 seconds');
    expect(h.server.requests).toEqual([]);
    expect(h.store.exists('snapshots/after-run-1.json')).toBe(false);
  });

  it('with --wait, sleeps until then and reads the board once it is caught up', async () => {
    closedRun({ agoMs: 2 * MINUTE });
    settledBoard();
    expect(await snapshot('after-run-1', '--wait')).toBe(0);
    expect(h.clock.sleeps).toEqual([4 * MINUTE]);
    expect(h.board.topReads).toBe(1);
    expect(printed()).toContain('waiting 240 seconds');
    expect(readSnapshot(h.store, 1)).not.toBeNull();
  });

  it('measures the last write from the log: a pin, a post, a reply, an upvote or a finished check-in, never a read', async () => {
    const old = iso(h.clock.now() - 20 * MINUTE);
    const recent = iso(h.clock.now() - 1 * MINUTE);
    closedRun({
      agoMs: 20 * MINUTE,
      entries: [
        {
          t: old,
          member: 'explainer',
          type: 'post',
          id: POST1,
          storyId: S1,
          kind: 'text',
          format: null,
          mediaId: null,
        },
        // A check-in's read a minute ago is no write.
        { t: recent, member: 'explainer', type: 'checkin', asOf: recent, since: old, inbox: [] },
      ],
    });
    settledBoard();
    h.board.top = [{ id: S1, counts: { posts: 1 } }, { id: S2 }, { id: S3 }];
    expect(await snapshot('after-run-1')).toBe(0);
    expect(h.clock.sleeps).toEqual([]);
  });

  it('is ready at once when the run wrote nothing and started long ago', async () => {
    closedRun({ entries: [] });
    expect(await snapshot('after-run-1')).toBe(0);
    expect(readSnapshot(h.store, 1)?.top).toEqual([]);
  });
});

describe('polling the Top board', () => {
  it("reads once a minute until each set story has reached the log's totals, then goes on", async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    const real = structuredClone(h.board.top);
    // The minute job is behind for the first three reads.
    h.board.top = real.map((tile) => ({ ...tile, counts: { posts: 0, replies: 0, upvotes: 0 } }));
    h.board.onTopRead = (reads) => {
      if (reads >= 4) h.board.top = real;
    };
    expect(await snapshot('after-run-1', '--wait')).toBe(0);
    expect(h.board.topReads).toBe(4);
    expect(h.clock.sleeps).toEqual([POLL_MS, POLL_MS, POLL_MS]);
    expect(printed()).toContain('read 1: 2 of 3 stories are behind');
    expect(printed()).toContain('saved snapshots/after-run-1.json');
  });

  it('gives up after 20 minutes with exit 4, saving nothing', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    h.board.top = [{ id: S1 }, { id: S2 }, { id: S3 }];
    expect(await snapshot('after-run-1', '--wait')).toBe(4);
    expect(h.board.topReads).toBe(GIVE_UP_MS / POLL_MS + 1);
    expect(h.clock.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(GIVE_UP_MS);
    expect(printed()).toContain('did not catch up with the log in 20 minutes');
    expect(printed()).toContain('wait 600 seconds');
    expect(h.store.exists('snapshots/after-run-1.json')).toBe(false);
    expect(h.board.latestReads).toBe(0);
  });

  it('without --wait, refuses (exit 4) while the board is behind, and saves when it is not', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    const real = structuredClone(h.board.top);
    h.board.top = [{ id: S1 }, { id: S2 }, { id: S3 }];
    expect(await snapshot('after-run-1')).toBe(4);
    expect(printed()).toContain('wait 60 seconds');
    expect(h.clock.sleeps).toEqual([]);
    h.board.top = real;
    expect(await snapshot('after-run-1')).toBe(0);
  });

  it('counts a replayed post, reply or upvote once, so the wait still ends', async () => {
    const at = iso(h.clock.now() - 10 * MINUTE);
    const post: LogEntry = {
      t: at,
      member: 'explainer',
      type: 'post',
      id: POST1,
      storyId: S1,
      kind: 'text',
      format: null,
      mediaId: null,
    };
    const reply: LogEntry = {
      t: at,
      member: 'analyst',
      type: 'reply',
      id: idOf(40),
      postId: POST1,
      parentId: null,
      storyId: S1,
      intent: 'add',
      depth: 0,
    };
    const upvote: LogEntry = {
      t: at,
      member: 'analyst',
      type: 'upvote',
      postId: POST1,
      storyId: S1,
    };
    closedRun({ agoMs: 10 * MINUTE, entries: [post, post, reply, reply, reply, upvote, upvote] });
    h.board.top = [
      { id: S1, counts: { posts: 1, replies: 1, upvotes: 1 } },
      { id: S2 },
      { id: S3 },
    ];
    expect(await snapshot('after-run-1', '--wait')).toBe(0);
    expect(h.board.topReads).toBe(1);
    expect(readSnapshot(h.store, 1)?.logged[S1]).toEqual({ posts: 1, replies: 1, upvotes: 1 });
  });

  it('never waits for a story the cast did nothing on, even one that is not on the board', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    h.board.top = h.board.top.filter((tile) => tile.id !== S3);
    expect(await snapshot('after-run-1', '--wait')).toBe(0);
    expect(readSnapshot(h.store, 1)?.top).toEqual([S2, S1]);
  });

  it('waits for a story with logged activity that is missing from the board', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    h.board.top = h.board.top.filter((tile) => tile.id !== S1);
    expect(await snapshot('after-run-1', '--wait')).toBe(4);
  });

  it("accepts counts above the log's: other agents post too", async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    h.board.top = [
      { id: S1, counts: { posts: 4, replies: 9, upvotes: 12 } },
      { id: S2, counts: { posts: 2 } },
      { id: S3 },
    ];
    expect(await snapshot('after-run-1')).toBe(0);
  });

  it('counts the logged totals over every run on the set up to this one', async () => {
    const at = iso(h.clock.now() - 10 * MINUTE);
    closedRun({ n: 1, agoMs: 30 * MINUTE });
    closedRun({
      n: 2,
      agoMs: 10 * MINUTE,
      entries: [
        {
          t: at,
          member: 'explainer',
          type: 'post',
          id: idOf(22),
          storyId: S1,
          kind: 'text',
          format: null,
          mediaId: null,
        },
        {
          t: at,
          member: 'explainer',
          type: 'post',
          id: POST1,
          storyId: S1,
          kind: 'video',
          format: null,
          mediaId: idOf(60),
        },
      ],
    });
    // Run 1 made POST1 and POST2 and one reply and one upvote; run 2 made another post on S1 (and logged POST1 again).
    h.board.top = [
      { id: S1, counts: { posts: 1, replies: 1, upvotes: 1 } },
      { id: S2, counts: { posts: 1 } },
      { id: S3 },
    ];
    expect(await snapshot('after-run-2')).toBe(4);
    h.board.top = [
      { id: S1, counts: { posts: 2, replies: 1, upvotes: 1 } },
      { id: S2, counts: { posts: 1 } },
      { id: S3 },
    ];
    expect(await snapshot('after-run-2')).toBe(0);
    expect(readSnapshot(h.store, 2)?.logged[S1]).toEqual({ posts: 2, replies: 1, upvotes: 1 });
  });

  it('finds set stories that are beyond the first page of the board', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    h.board.pageSize = 1;
    expect(await snapshot('after-run-1')).toBe(0);
    expect(readSnapshot(h.store, 1)?.top).toEqual([S2, S1, S3]);
    expect(readSnapshot(h.store, 1)?.tiles[S1]?.rank).toBe(3);
    // Paging stops at the page that has the last wanted story.
    expect(
      h.server.to('GET', /social\/board$/).filter((req) => req.query.get('sort') === 'top'),
    ).toHaveLength(4);
  });
});

describe('what is saved', () => {
  it("the set's Top and Latest orders, each tile's counts and picture, each desk's order with every post's author, kind and counts", async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    expect(await snapshot('after-run-1', '--wait')).toBe(0);
    const saved = readSnapshot(h.store, 1) as SnapshotFile;
    expect(saved.format).toBe('hrizzup-cast-snapshot/1');
    expect(saved).toMatchObject({
      label: 'after-run-1',
      run: 1,
      set: 'set.json',
      storyIds: STORIES,
      commit: 'abc1234',
    });
    // The other agent's story (99) is on the board but not the set's: it is not in the order.
    expect(saved.top).toEqual([S2, S1, S3]);
    expect(saved.latest).toEqual([S3, S1, S2]);
    expect(saved.tiles[S2]).toEqual({
      posts: 1,
      replies: 0,
      upvotes: 0,
      picture: 'https://media.example/s2.webp',
      rank: 2,
    });
    expect(saved.tiles[S1]).toMatchObject({
      posts: 1,
      replies: 1,
      upvotes: 1,
      picture: null,
      rank: 3,
    });
    expect(saved.desks[S1]).toEqual([
      {
        id: POST1,
        author: 'hztest_explainer',
        kind: 'video',
        counts: { replies: 1, upvotes: 1, views: 9 },
      },
    ]);
    expect(saved.desks[S3]).toEqual([]);
    expect(saved.logged[S1]).toEqual({ posts: 1, replies: 1, upvotes: 1 });
    expect(saved.lastWriteAt).toBe(iso(h.clock.now() - 10 * MINUTE));
    expect(Date.parse(saved.takenAt)).toBe(h.clock.now());
    expect(statSync(join(h.home, 'snapshots/after-run-1.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.home, 'snapshots')).mode & 0o777).toBe(0o700);
  });

  it('reads the Top board, then the Latest board, then each desk Top first, then the health page; every read with no key', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    await snapshot('after-run-1');
    const reads = h.server.requests.map(
      (req) =>
        `${req.path.replace(/[0-9a-f-]{36}/g, '{id}')}${req.query.get('sort') ? `?${req.query.get('sort')}` : ''}`,
    );
    expect(reads).toEqual([
      '/api/v1/social/board?top',
      '/api/v1/social/board?latest',
      '/api/v1/social/stories/{id}/posts?top',
      '/api/v1/social/stories/{id}/posts?top',
      '/api/v1/social/stories/{id}/posts?top',
      '/api/health',
    ]);
    for (const req of h.server.requests) expect(req.headers.authorization).toBeUndefined();
  });

  it('records staging\'s commit from /api/health, read leniently, and "unknown" when it cannot be read', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    h.board.health = { status: 503, body: { status: 'error', commit: 'def5678', services: {} } };
    await snapshot('after-run-1');
    expect(readSnapshot(h.store, 1)?.commit).toBe('def5678');

    for (const health of [
      { status: 200, body: { status: 'ok' } },
      { status: 200, body: { commit: 12 } },
      { status: 200, body: { commit: 'a b/c;d' } },
      { status: 404, body: {} },
      { status: 429, body: {} },
      null,
    ]) {
      h.board.health = health;
      // A minute on, so the pacing window (40 requests in a minute) is not what is being counted.
      h.clock.advance(2 * MINUTE);
      h.clock.sleeps.length = 0;
      expect(await snapshot('after-run-1'), JSON.stringify(health)).toBe(0);
      expect(readSnapshot(h.store, 1)?.commit).toBe('unknown');
      // The health read is asked once: no waiting for a page that only tells the commit.
      expect(h.clock.sleeps).toEqual([]);
    }
  });

  it('takes the snapshot again and replaces the old one', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    await snapshot('after-run-1');
    h.board.health = { status: 200, body: { commit: 'newer00' } };
    await snapshot('after-run-1');
    expect(readSnapshot(h.store, 1)?.commit).toBe('newer00');
  });

  it('refuses to save when a later run wrote while it waited, and holds nothing secret', async () => {
    closedRun({ agoMs: 2 * MINUTE });
    settledBoard();
    h.board.onTopRead = () => {
      const state = readState(h.store);
      state.runs.push({
        n: 2,
        set: 'set.json',
        open: true,
        startedAt: iso(h.clock.now()),
        endedAt: null,
      });
      writeState(h.store, state);
      appendLog(h.store, 2, {
        t: iso(h.clock.now()),
        member: 'explainer',
        type: 'pin',
        storyId: S1,
      });
    };
    expect(await snapshot('after-run-1', '--wait')).toBe(2);
    expect(printed()).toContain('Run 2 wrote while the snapshot waited');
    expect(h.store.exists('snapshots/after-run-1.json')).toBe(false);
  });

  it('can be called directly', async () => {
    closedRun({ agoMs: 10 * MINUTE });
    settledBoard();
    await snapshotCommand(h.ctx, { label: 'after-run-1', wait: false });
    expect(readSnapshot(h.store, 1)).not.toBeNull();
    expect(SETTLE_MS).toBe(6 * MINUTE);
  });
});

describe('the helpers', () => {
  it('stoppingStories() names the stories behind the log, and none the cast did nothing on', () => {
    const tiles = {
      [S1]: { posts: 1, replies: 0, upvotes: 0, picture: null, rank: 1 },
      [S2]: { posts: 0, replies: 0, upvotes: 0, picture: null, rank: 2 },
    };
    const logged = {
      [S1]: { posts: 1, replies: 1, upvotes: 0 },
      [S2]: { posts: 0, replies: 0, upvotes: 0 },
      [S3]: { posts: 0, replies: 0, upvotes: 1 },
    };
    expect(stoppingStories(tiles, logged)).toEqual([S1, S3]);
    expect(stoppingStories({}, { [S2]: { posts: 0, replies: 0, upvotes: 0 } })).toEqual([]);
  });

  it("loggedPerStory() counts distinct things on the set's stories only", () => {
    const at = 'x';
    const entries: LogEntry[] = [
      {
        t: at,
        member: 'a',
        type: 'post',
        id: POST1,
        storyId: S1,
        kind: 'text',
        format: null,
        mediaId: null,
      },
      {
        t: at,
        member: 'a',
        type: 'post',
        id: POST1,
        storyId: S1,
        kind: 'text',
        format: null,
        mediaId: null,
      },
      {
        t: at,
        member: 'a',
        type: 'post',
        id: POST2,
        storyId: idOf(77),
        kind: 'text',
        format: null,
        mediaId: null,
      },
      { t: at, member: 'a', type: 'upvote', postId: POST1, storyId: S1 },
      { t: at, member: 'b', type: 'upvote', postId: POST1, storyId: S1 },
    ];
    expect(loggedPerStory(entries, STORIES)).toEqual({
      [S1]: { posts: 1, replies: 0, upvotes: 2 },
      [S2]: { posts: 0, replies: 0, upvotes: 0 },
      [S3]: { posts: 0, replies: 0, upvotes: 0 },
    });
  });

  it('snapshotBefore() is the latest snapshot of an earlier run', () => {
    closedRun({ n: 1, agoMs: 30 * MINUTE });
    closedRun({ n: 2, agoMs: 20 * MINUTE });
    const state = readState(h.store);
    expect(snapshotBefore(h.store, state, 1)).toBeNull();
    const base = {
      format: 'hrizzup-cast-snapshot/1',
      set: 'set.json',
      storyIds: STORIES,
      takenAt: '',
      commit: 'x',
      lastWriteAt: '',
      top: [],
      latest: [],
      tiles: {},
      desks: {},
      logged: {},
    };
    h.store.writeJson('snapshots/after-run-1.json', { ...base, label: 'after-run-1', run: 1 });
    expect(snapshotBefore(h.store, state, 2)?.label).toBe('after-run-1');
    expect(snapshotBefore(h.store, state, 1)).toBeNull();
    h.store.writeJson('snapshots/after-run-2.json', { ...base, label: 'after-run-2', run: 2 });
    expect(snapshotBefore(h.store, state, 3)?.label).toBe('after-run-2');
  });

  it("projectTop() orders by replies, keeps ties in the snapshot's order, and says whether the order changed", () => {
    const tile = (replies: number, rank: number) => ({
      posts: 0,
      replies,
      upvotes: 0,
      picture: null,
      rank,
    });
    const base = {
      format: 'hrizzup-cast-snapshot/1' as const,
      label: 'after-run-1',
      run: 1,
      set: 'set.json',
      storyIds: STORIES,
      takenAt: '',
      commit: 'x',
      lastWriteAt: '',
      top: [S1, S2, S3],
      latest: [],
      tiles: { [S1]: tile(5, 1), [S2]: tile(4, 2), [S3]: tile(4, 3) },
      desks: {},
      logged: {},
    };
    // Nothing more: the same order.
    expect(projectTop(base, STORIES, {})).toMatchObject({ differs: false });
    expect(projectTop(base, STORIES, {}).order.map((one) => one.id)).toEqual([S1, S2, S3]);
    // One more reply on S3 ties it with S1 on 5 and 5, so S1 stays above it (the snapshot's order), and S2 falls below.
    const tied = projectTop(base, STORIES, { [S3]: 1 });
    expect(tied.order.map((one) => one.id)).toEqual([S1, S3, S2]);
    expect(tied.differs).toBe(true);
    // Two more on S3 passes S1.
    expect(
      projectTop(base, STORIES, { [S3]: 2 }).order.map((one) => [one.id, one.base, one.plus]),
    ).toEqual([
      [S3, 4, 2],
      [S1, 5, 0],
      [S2, 4, 0],
    ]);
    // No snapshot: this run's replies alone, ties in the set's order, and no verdict on a change.
    const alone = projectTop(null, STORIES, { [S2]: 1 });
    expect(alone.order.map((one) => one.id)).toEqual([S2, S1, S3]);
    expect(alone.differs).toBeNull();
  });
});
