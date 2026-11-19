import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Harness, harness, idOf, json, refusal } from './harness.ts';
import { appendLog, type LogEntry } from './log.ts';
import { main } from './main.ts';
import { MEMBERS } from './members.ts';
import {
  type Check,
  cellsFilled,
  evaluate,
  type ReportInput,
  type RunData,
  reportCommand,
  type ThreadReply,
  type Who,
  windowOf,
} from './report.ts';
import type { DeskPost, SnapshotFile } from './snapshot.ts';
import { readState, writeState } from './state.ts';

/**
 * Test group 11, `report` (rule 18): a passing fixture, and a failing one for each check R1 to R9. The
 * fixture is two runs of the six members on a set of six stories: run 1 from 10:00 to 10:40 and run 2
 * from 11:00 to 11:40 (the database's clock), each followed by a snapshot.
 */

vi.setConfig({ testTimeout: 60_000 });

const S = [1, 2, 3, 4, 5, 6].map((n) => idOf(10 + n));
const members: Who[] = MEMBERS.map((member) => ({ key: member.key, handle: member.handle }));
const handle = (key: string): string => members.find((member) => member.key === key)?.handle ?? key;
const OUTSIDER = 'someone_else';

const at = (hh: number, mm: number) => new Date(Date.UTC(2026, 10, 19, hh, mm, 0)).toISOString();

// The posts, as the desks show them after run 2.
const POSTS = {
  explainerVideo: idOf(101),
  checkerText: idOf(102),
  analystText: idOf(103),
  memeImage: idOf(104),
  audioBrief: idOf(105),
  translatorText: idOf(106),
};

function desks(): Record<string, DeskPost[]> {
  const post = (id: string, who: string, kind: string): DeskPost => ({
    id,
    author: handle(who),
    kind,
    counts: { replies: 1, upvotes: 1 },
  });
  return {
    [S[0] as string]: [
      post(POSTS.explainerVideo, 'explainer', 'video'),
      post(POSTS.checkerText, 'source-checker', 'text'),
    ],
    [S[1] as string]: [
      post(POSTS.analystText, 'analyst', 'text'),
      post(POSTS.memeImage, 'meme-maker', 'image'),
    ],
    [S[2] as string]: [
      post(POSTS.audioBrief, 'audio-brief', 'audio'),
      post(POSTS.translatorText, 'translator', 'text'),
    ],
    [S[3] as string]: [{ id: idOf(107), author: OUTSIDER, kind: 'text', counts: {} }],
    [S[4] as string]: [],
    [S[5] as string]: [],
  };
}

function snapshot(run: number, top: string[], pictures: number): SnapshotFile {
  const tiles: SnapshotFile['tiles'] = {};
  S.forEach((id, i) => {
    // The set's tiles hold more after the second run than after the first.
    tiles[id] = {
      posts: run,
      replies: run,
      upvotes: run,
      picture: i < pictures ? `https://media.example/${i}.webp` : null,
      rank: top.indexOf(id) + 1,
    };
  });
  return {
    format: 'hrizzup-cast-snapshot/1',
    label: `after-run-${run}`,
    run,
    set: 'set.json',
    storyIds: S,
    takenAt: at(run === 1 ? 10 : 11, 55),
    commit: 'abc1234',
    lastWriteAt: at(run === 1 ? 10 : 11, 40),
    top,
    latest: top,
    tiles,
    desks: desks(),
    logged: {},
  };
}

/** What a run's log holds: a check-in each (with its `asOf`), the posts, replies and upvotes, a finished check-in each with a note. */
function log(run: 1 | 2, counts: { posts: number; replies: number; upvotes: number }): LogEntry[] {
  const hh = run === 1 ? 10 : 11;
  const entries: LogEntry[] = [];
  members.forEach((member, i) => {
    entries.push({
      t: at(hh, i),
      member: member.key,
      type: 'checkin',
      asOf: at(hh, i * 5),
      since: at(hh - 1, 0),
      inbox: [],
    });
  });
  const base = run === 1 ? 200 : 300;
  for (let n = 0; n < counts.posts; n++) {
    entries.push({
      t: at(hh, 10),
      member: 'explainer',
      type: 'post',
      id: idOf(base + n),
      storyId: S[0] as string,
      kind: 'text',
      format: null,
      mediaId: null,
    });
  }
  for (let n = 0; n < counts.replies; n++) {
    entries.push({
      t: at(hh, 15),
      member: 'analyst',
      type: 'reply',
      id: idOf(base + 50 + n),
      postId: POSTS.explainerVideo,
      parentId: null,
      storyId: S[0] as string,
      intent: 'add',
      depth: 0,
    });
  }
  for (let n = 0; n < counts.upvotes; n++) {
    entries.push({
      t: at(hh, 20),
      member: members[n % 6]?.key ?? 'explainer',
      type: 'upvote',
      postId: idOf(base + 100 + n),
      storyId: S[1] as string,
    });
  }
  members.forEach((member, i) => {
    entries.push({
      t: at(hh, 30 + i),
      member: member.key,
      type: 'checkin_done',
      seenUntil: at(hh, i * 5),
      at: at(hh, 30 + i),
      noteLength: 40,
    });
  });
  return entries;
}

/** The replies of the two runs: asks, a push-back and an add at depth 0 in run 1, each answered in run 2, at depth 1. */
function threads(): ThreadReply[] {
  const reply = (
    id: number,
    post: string,
    parent: number | null,
    who: string,
    intent: string,
    depth: number,
    when: string,
  ): ThreadReply => ({
    id: idOf(id),
    postId: post,
    parentId: parent === null ? null : idOf(parent),
    author: who,
    intent,
    depth,
    createdAt: when,
  });
  return [
    // Run 1's window (10:00 to 10:35): replies to members, each of a different kind.
    reply(401, POSTS.explainerVideo, null, handle('source-checker'), 'ask', 0, at(10, 12)),
    reply(402, POSTS.explainerVideo, null, handle('analyst'), 'push-back', 0, at(10, 16)),
    reply(403, POSTS.analystText, null, handle('meme-maker'), 'add', 0, at(10, 22)),
    // Run 2's window (11:00 to 11:35): each answered by the member it was made to, directly under it.
    reply(411, POSTS.explainerVideo, 401, handle('explainer'), 'answer', 1, at(11, 5)),
    reply(412, POSTS.explainerVideo, 402, handle('explainer'), 'add', 1, at(11, 6)),
    reply(413, POSTS.analystText, 403, handle('analyst'), 'answer', 1, at(11, 8)),
    // And something from outside the cast, in run 2: nobody owes it an answer yet.
    reply(421, POSTS.checkerText, null, OUTSIDER, 'ask', 0, at(11, 20)),
  ];
}

function fixture(): ReportInput {
  const topA = [S[0], S[1], S[2], S[3], S[4], S[5]] as string[];
  const topB = [S[1], S[0], S[2], S[3], S[4], S[5]] as string[];
  const a: RunData = {
    n: 1,
    snapshot: snapshot(1, topA, 4),
    entries: log(1, { posts: 4, replies: 3, upvotes: 2 }),
  };
  const b: RunData = {
    n: 2,
    snapshot: snapshot(2, topB, 4),
    entries: log(2, { posts: 5, replies: 6, upvotes: 4 }),
  };
  return { a, b, members, replies: threads() };
}

const failing = (input: ReportInput): string[] =>
  evaluate(input)
    .checks.filter((check) => !check.pass)
    .map((check) => check.id);

const check = (input: ReportInput, id: string): Check => {
  const found = evaluate(input).checks.find((one) => one.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
};

describe('a passing fixture', () => {
  it('passes all nine checks, with evidence for each', () => {
    const { checks, grid } = evaluate(fixture());
    expect(checks.map((one) => one.id)).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R6',
      'R7',
      'R8',
      'R9',
    ]);
    expect(checks.filter((one) => !one.pass)).toEqual([]);
    for (const one of checks) expect(one.evidence.length).toBeGreaterThan(0);
    expect(check(fixture(), 'R1').evidence[0]).toContain('6 of 6');
    expect(check(fixture(), 'R2').evidence[0]).toContain('4 of 6');
    expect(check(fixture(), 'R4').evidence[0]).toContain('6 members');
    expect(check(fixture(), 'R8').evidence[0]).toContain('3 of 3');
    expect(grid.ask).toEqual([1, 0, 0]);
    expect(grid.answer).toEqual([0, 2, 0]);
    expect(grid.add).toEqual([1, 1, 0]);
    expect(grid['push-back']).toEqual([1, 0, 0]);
    expect(cellsFilled(grid)).toBe(5);
  });

  it("windows are measured from the first check-in's asOf to the last finished check-in's at", () => {
    const entries = log(1, { posts: 0, replies: 0, upvotes: 0 });
    expect(windowOf(entries)).toEqual({ from: Date.parse(at(10, 0)), to: Date.parse(at(10, 35)) });
    expect(windowOf([])).toBeNull();
    expect(windowOf(entries.filter((entry) => entry.type === 'checkin'))).toBeNull();
    expect(windowOf(entries.filter((entry) => entry.type === 'checkin_done'))).toBeNull();
  });
});

describe('a failing fixture for each check', () => {
  it('R1: a set story is missing from the Top board after the second run', () => {
    const input = fixture();
    input.b.snapshot.top = input.b.snapshot.top.filter((id) => id !== S[2]);
    expect(failing(input)).toEqual(['R1']);
    expect(check(input, 'R1').evidence.join(' ')).toContain('5 of 6');
    expect(check(input, 'R1').evidence.join(' ')).toContain(String(S[2]));
  });

  it('R2: no more than half of the tiles have a picture (exactly half is not more)', () => {
    const input = fixture();
    input.b.snapshot = snapshot(2, input.b.snapshot.top, 3);
    expect(failing(input)).toEqual(['R2']);
    input.b.snapshot = snapshot(2, input.b.snapshot.top, 0);
    expect(failing(input)).toEqual(['R2']);
    input.b.snapshot = snapshot(2, input.b.snapshot.top, 4);
    expect(failing(input)).toEqual([]);
  });

  it('R3: a kind of post is missing (here, the audio)', () => {
    const input = fixture();
    const desk = input.b.snapshot.desks[S[2] as string];
    const audio = desk?.find((post) => post.kind === 'audio');
    if (audio) audio.kind = 'text';
    expect(failing(input)).toEqual(['R3']);
    expect(check(input, 'R3').evidence.join(' ')).toContain('none of: audio');
    // Only the cast's posts count: another agent's audio is no help.
    const other = input.b.snapshot.desks[S[3] as string];
    other?.push({ id: idOf(190), author: OUTSIDER, kind: 'audio', counts: {} });
    expect(failing(input)).toEqual(['R3']);
  });

  it('R4: the posts come from four members, not five', () => {
    const input = fixture();
    for (const desk of Object.values(input.b.snapshot.desks)) {
      for (const post of desk)
        if (post.author === handle('translator')) post.author = handle('analyst');
    }
    for (const desk of Object.values(input.b.snapshot.desks)) {
      for (const post of desk)
        if (post.author === handle('audio-brief')) post.author = handle('analyst');
    }
    expect(failing(input)).toEqual(['R4']);
    expect(check(input, 'R4').evidence[0]).toContain('4 members');
  });

  it('R5: the replies stay at depth 0', () => {
    const input = fixture();
    for (const reply of input.replies) reply.depth = 0;
    expect(failing(input)).toContain('R5');
    expect(check(input, 'R5').evidence.join(' ')).toContain('deepest at depth 0');
  });

  it.each(['ask', 'answer', 'add', 'push-back'])('R5: no reply with the intent %s', (intent) => {
    const input = fixture();
    // Every cast reply of that intent becomes another intent that is not missing.
    for (const reply of input.replies) {
      if (reply.intent === intent) reply.intent = intent === 'add' ? 'answer' : 'add';
    }
    // `add` is replaced by `answer` and still needs to be among the others: only R5 changes.
    expect(check(input, 'R5').pass).toBe(false);
    expect(check(input, 'R5').evidence.join(' ')).toContain(`none of: ${intent}`);
  });

  it('R5: replies by anyone outside the cast do not count', () => {
    const input = fixture();
    for (const reply of input.replies) if (reply.intent === 'push-back') reply.author = OUTSIDER;
    expect(check(input, 'R5').pass).toBe(false);
  });

  /** Sets one count on every set tile of a snapshot. */
  const setTiles = (run: RunData, field: 'posts' | 'replies' | 'upvotes', value: number) => {
    for (const tile of Object.values(run.snapshot.tiles)) tile[field] = value;
  };

  it.each([
    [
      'posts',
      'after run 2 the set has fewer posts than after run 1',
      (input: ReportInput) => setTiles(input.b, 'posts', 0),
    ],
    [
      'replies',
      'after run 2 the set has no more replies than after run 1',
      (input: ReportInput) => setTiles(input.b, 'replies', 1),
    ],
    [
      'upvotes',
      'after run 2 the set has no more upvotes than after run 1',
      (input: ReportInput) => setTiles(input.b, 'upvotes', 1),
    ],
    [
      'posts',
      'after run 1 the set has no posts',
      (input: ReportInput) => setTiles(input.a, 'posts', 0),
    ],
    [
      'replies',
      'after run 1 the set has no replies',
      (input: ReportInput) => setTiles(input.a, 'replies', 0),
    ],
    [
      'upvotes',
      'after run 1 the set has no upvotes',
      (input: ReportInput) => setTiles(input.a, 'upvotes', 0),
    ],
  ])('R6 (%s): %s', (_field, _what, change) => {
    const input = fixture();
    change(input);
    expect(failing(input)).toEqual(['R6']);
    expect(check(input, 'R6').evidence).toHaveLength(3);
  });

  it("R6: reads the set's tiles, so equal posts are enough, and a second run that posts nothing new passes", () => {
    const input = fixture();
    setTiles(input.b, 'posts', 1);
    expect(check(input, 'R6').pass).toBe(true);
    // The cast's own log of run 2 may be quiet: the evidence says so, the verdict does not change.
    input.b.entries = log(2, { posts: 0, replies: 1, upvotes: 0 });
    expect(check(input, 'R6').pass).toBe(true);
    expect(check(input, 'R6').evidence[2]).toContain(
      'run 1 made 4 posts, 3 replies, 2 upvotes; run 2 made 0 posts, 1 replies, 0 upvotes',
    );
  });

  it("R6: the log's evidence counts a replayed entry once", () => {
    const input = fixture();
    input.b.entries.push(...input.b.entries.filter((entry) => entry.type === 'reply'));
    expect(check(input, 'R6').evidence[2]).toContain('run 2 made 5 posts, 6 replies, 4 upvotes');
  });

  it('R7: the Top order is the same after both runs', () => {
    const input = fixture();
    input.b.snapshot.top = [...input.a.snapshot.top];
    expect(failing(input)).toEqual(['R7']);
  });

  it('R7: a story added to the set between the runs, or lost from the board, moves nothing', () => {
    const added = fixture();
    const extra = idOf(77);
    added.b.snapshot.top = [extra, ...added.a.snapshot.top];
    added.b.snapshot.storyIds = [...S, extra];
    expect(check(added, 'R7').pass).toBe(false);

    const lost = fixture();
    lost.b.snapshot.top = lost.a.snapshot.top.filter((id) => id !== S[5]);
    expect(check(lost, 'R7').pass).toBe(false);
    expect(failing(lost)).toContain('R1');
  });

  it('R7: passes when the stories both hold change places, whatever was added', () => {
    const input = fixture();
    const extra = idOf(77);
    input.b.snapshot.top = [S[1] as string, extra, S[0] as string, ...S.slice(2)];
    expect(check(input, 'R7').pass).toBe(true);
  });

  it('R7: cannot pass with fewer than two stories on both boards', () => {
    const input = fixture();
    input.a.snapshot.top = [S[0] as string];
    input.b.snapshot.top = [S[0] as string, idOf(77)];
    expect(check(input, 'R7').pass).toBe(false);
    expect(check(input, 'R7').evidence.join(' ')).toContain('fewer than two stories');
  });

  it("R8: a reply made to a member in run 1's window is not answered by that member in run 2's", () => {
    const input = fixture();
    input.replies = input.replies.filter((reply) => reply.id !== idOf(411));
    expect(failing(input)).toEqual(['R8']);
    const evidence = check(input, 'R8').evidence;
    expect(evidence[0]).toContain('2 of 3');
    expect(evidence[1]).toContain(`reply ${idOf(401)} to ${handle('explainer')}`);
  });

  it("R8: an answer by someone else, one that is not directly under the reply, or one made outside run 2's window, does not do", () => {
    const wrongAuthor = fixture();
    const first = wrongAuthor.replies.find((reply) => reply.id === idOf(411));
    if (first) first.author = handle('analyst');
    expect(check(wrongAuthor, 'R8').pass).toBe(false);

    const notDirect = fixture();
    const second = notDirect.replies.find((reply) => reply.id === idOf(411));
    if (second) second.parentId = idOf(402);
    expect(check(notDirect, 'R8').pass).toBe(false);

    const early = fixture();
    const third = early.replies.find((reply) => reply.id === idOf(411));
    if (third) third.createdAt = at(10, 30);
    expect(check(early, 'R8').pass).toBe(false);

    const late = fixture();
    const fourth = late.replies.find((reply) => reply.id === idOf(411));
    if (fourth) fourth.createdAt = at(11, 59);
    expect(check(late, 'R8').pass).toBe(false);
  });

  it("R8: takes a post's author from the cast's log when the desks do not hold the post", () => {
    const input = fixture();
    // The log's first post of run 1 (id 200) is the explainer's and is on no desk.
    input.replies.push({
      id: idOf(460),
      postId: idOf(200),
      parentId: null,
      author: handle('analyst'),
      intent: 'ask',
      depth: 0,
      createdAt: at(10, 30),
    });
    expect(check(input, 'R8').pass).toBe(false);
    expect(check(input, 'R8').evidence.join(' ')).toContain(
      `reply ${idOf(460)} to ${handle('explainer')}`,
    );
    input.replies.push({
      id: idOf(461),
      postId: idOf(200),
      parentId: idOf(460),
      author: handle('explainer'),
      intent: 'answer',
      depth: 1,
      createdAt: at(11, 9),
    });
    expect(check(input, 'R8').pass).toBe(true);
  });

  it("R8: fails when no reply was made to a member in run 1's window at all", () => {
    const input = fixture();
    input.replies = input.replies.filter(
      (reply) => Date.parse(reply.createdAt) > Date.parse(at(10, 59)),
    );
    expect(check(input, 'R8').pass).toBe(false);
    expect(check(input, 'R8').evidence[0]).toContain('nothing that was followed up');
  });

  it('R8: fails when a run has no window', () => {
    const input = fixture();
    input.a.entries = input.a.entries.filter((entry) => entry.type !== 'checkin');
    expect(check(input, 'R8').pass).toBe(false);
    expect(check(input, 'R8').evidence[0]).toContain('has no window');
  });

  it('R8: a reply to a member by someone outside the cast must be answered too', () => {
    const input = fixture();
    input.replies.push({
      id: idOf(430),
      postId: POSTS.analystText,
      parentId: null,
      author: OUTSIDER,
      intent: 'ask',
      depth: 0,
      createdAt: at(10, 25),
    });
    expect(check(input, 'R8').pass).toBe(false);
    expect(check(input, 'R8').evidence.join(' ')).toContain(
      `reply ${idOf(430)} to ${handle('analyst')}`,
    );
    input.replies.push({
      id: idOf(431),
      postId: POSTS.analystText,
      parentId: idOf(430),
      author: handle('analyst'),
      intent: 'answer',
      depth: 1,
      createdAt: at(11, 10),
    });
    expect(check(input, 'R8').pass).toBe(true);
  });

  it("R8: leaves out a member's own replies, ended threads, and replies to someone who is not a member", () => {
    const input = fixture();
    input.replies.push(
      // The member replying under its own post, in run 1's window.
      {
        id: idOf(440),
        postId: POSTS.explainerVideo,
        parentId: null,
        author: handle('explainer'),
        intent: 'add',
        depth: 0,
        createdAt: at(10, 24),
      },
      // A thread that has ended (depth 3, not an ask) under a member's reply.
      {
        id: idOf(441),
        postId: POSTS.explainerVideo,
        parentId: idOf(411),
        author: handle('analyst'),
        intent: 'add',
        depth: 3,
        createdAt: at(10, 26),
      },
      // A reply to the outsider's post, which no member owes anything.
      {
        id: idOf(442),
        postId: idOf(107),
        parentId: null,
        author: handle('analyst'),
        intent: 'add',
        depth: 0,
        createdAt: at(10, 27),
      },
    );
    // An ask that deep is not an ended thread, so it is owed (and not answered here).
    expect(check(input, 'R8').pass).toBe(true);
    input.replies.push({
      id: idOf(443),
      postId: POSTS.explainerVideo,
      parentId: idOf(411),
      author: handle('analyst'),
      intent: 'ask',
      depth: 3,
      createdAt: at(10, 28),
    });
    expect(check(input, 'R8').pass).toBe(false);
  });

  it('R9: a member finished no check-in in run 2, or finished one with no note', () => {
    const none = fixture();
    none.b.entries = none.b.entries.filter(
      (entry) => !(entry.type === 'checkin_done' && entry.member === 'translator'),
    );
    expect(failing(none)).toEqual(['R9']);
    expect(check(none, 'R9').evidence.join(' ')).toContain('not: translator');

    const quiet = fixture();
    for (const entry of quiet.b.entries) {
      if (entry.type === 'checkin_done' && entry.member === 'analyst') entry.noteLength = 0;
    }
    expect(failing(quiet)).toEqual(['R9']);
    expect(check(quiet, 'R9').evidence[0]).toContain('5 of 6');
  });
});

/** `report` itself: the snapshots and the logs it is given, the threads it reads in full, what it prints and the exit code. */
describe('the command', () => {
  let h: Harness;
  /** Every reply the fake staging holds, by post. */
  let held: ThreadReply[];
  let pageSize: number;
  beforeEach(() => {
    h = harness();
    held = threads();
    pageSize = 100;
    h.server.on('GET', /^\/api\/v1\/social\/posts\/([0-9a-f-]{36})\/replies$/, (req, match) => {
      const post = match[1] ?? '';
      const parent = req.query.get('parent');
      const level = held
        .filter(
          (reply) =>
            reply.postId === post && (parent ? reply.parentId === parent : reply.parentId === null),
        )
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      const from = Number(req.query.get('cursor') ?? 0);
      const page = level.slice(from, from + pageSize);
      return json(200, {
        replies: page.map((reply) => ({
          ...reply,
          agent: { handle: reply.author },
          children: held.filter((other) => other.parentId === reply.id).length,
        })),
        next: from + pageSize < level.length ? String(from + pageSize) : null,
      });
    });
  });
  afterEach(() => h.cleanup());

  /** The store as `run 1`, `snapshot`, `run 2`, `snapshot` leave it. */
  function seed(input: ReportInput = fixture()): void {
    const state = readState(h.store);
    state.current = { file: 'set.json', storyIds: S, loadedAt: at(9, 0) };
    state.runs = [
      { n: 1, set: 'set.json', open: false, startedAt: at(10, 0), endedAt: at(10, 40) },
      { n: 2, set: 'set.json', open: false, startedAt: at(11, 0), endedAt: at(11, 40) },
    ];
    writeState(h.store, state);
    for (const run of [input.a, input.b]) {
      h.store.writeJson(`snapshots/after-run-${run.n}.json`, run.snapshot);
      for (const entry of run.entries) appendLog(h.store, run.n, entry);
    }
  }
  const report = (...argv: string[]) => main(['report', ...argv], h.io, () => h.ctx);
  const out = () =>
    h.writes
      .filter((write) => write.stream === 'out')
      .map((write) => write.text)
      .join('');

  it('prints PASS for each check, the grid of intent by depth, and exits 0 when all nine pass', async () => {
    seed();
    expect(await report()).toBe(0);
    const text = out();
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'])
      expect(text).toContain(`PASS ${id}`);
    expect(text).not.toContain('FAIL');
    expect(text).toContain('report: after-run-1 against after-run-2, on set.json');
    expect(text).toContain(
      "staging's commit: abc1234 at the first snapshot, abc1234 at the second",
    );
    expect(text).toContain('ask: d0 1, d1 0, d2 or deeper 0');
    expect(text).toContain('answer: d0 0, d1 2, d2 or deeper 0');
    expect(text).toContain('push-back: d0 1, d1 0, d2 or deeper 0');
    expect(text).toContain('cells filled (four intents at depth 0 and 1): 5 of 8');
    expect(text).toContain('all 9 checks pass');
  });

  it("reads every set post's thread in full: each post of both desks, with no key, and every level down", async () => {
    seed();
    // A reply three levels down, under run 2's answer, and found because staging counts its children.
    held.push({
      id: idOf(450),
      postId: POSTS.explainerVideo,
      parentId: idOf(411),
      author: handle('source-checker'),
      intent: 'push-back',
      depth: 2,
      createdAt: at(11, 12),
    });
    held.push({
      id: idOf(451),
      postId: POSTS.explainerVideo,
      parentId: idOf(450),
      author: handle('explainer'),
      intent: 'add',
      depth: 3,
      createdAt: at(11, 14),
    });
    await report();
    const reads = h.server.to('GET', /replies$/);
    const posts = new Set(reads.map((req) => req.path.split('/')[5]));
    // Every post of both desks (the outsider's too), and any the cast's log knows.
    for (const post of [...Object.values(POSTS), idOf(107)]) expect(posts.has(post)).toBe(true);
    expect(posts.has(idOf(200))).toBe(true);
    for (const req of reads) expect(req.headers.authorization).toBeUndefined();
    const parents = reads.map((req) => req.query.get('parent')).filter(Boolean);
    expect(parents).toContain(idOf(411));
    expect(parents).toContain(idOf(450));
    // The depth-2 and depth-3 replies are in the grid: the deepest replies are read.
    expect(out()).toContain('push-back: d0 1, d1 0, d2 or deeper 1');
    expect(out()).toContain('add: d0 1, d1 1, d2 or deeper 1');
  });

  it("pages through a thread, and reads the replies under a reply that the cast's log says it answered even when staging's count says none", async () => {
    seed();
    pageSize = 1;
    const noChildren = structuredClone(held);
    h.server.on('GET', /^\/api\/v1\/social\/posts\/([0-9a-f-]{36})\/replies$/, (req, match) => {
      const post = match[1] ?? '';
      const parent = req.query.get('parent');
      const level = noChildren.filter(
        (reply) =>
          reply.postId === post && (parent ? reply.parentId === parent : reply.parentId === null),
      );
      const from = Number(req.query.get('cursor') ?? 0);
      return json(200, {
        replies: level
          .slice(from, from + 1)
          .map((reply) => ({ ...reply, agent: { handle: reply.author }, children: 0 })),
        next: from + 1 < level.length ? String(from + 1) : null,
      });
    });
    // The log says the explainer answered reply 401 in run 2.
    appendLog(h.store, 2, {
      t: at(11, 5),
      member: 'explainer',
      type: 'reply',
      id: idOf(411),
      postId: POSTS.explainerVideo,
      parentId: idOf(401),
      storyId: S[0] as string,
      intent: 'answer',
      depth: 1,
    });
    await report();
    const parents = h.server.to('GET', /replies$/).map((req) => req.query.get('parent'));
    expect(parents).toContain(idOf(401));
    // Pages of one reply each: the post's two replies took two reads.
    const own = h.server
      .to('GET', new RegExp(`${POSTS.explainerVideo}/replies$`))
      .filter((req) => !req.query.get('parent'));
    expect(own.length).toBe(2);
  });

  it('names a post whose thread is gone (404) and goes on; any other refusal stops it', async () => {
    seed();
    h.server.on('GET', new RegExp(`/social/posts/${idOf(107)}/replies$`), () =>
      refusal(404, 'NOT_FOUND'),
    );
    expect(await report()).toBe(0);
    expect(out()).toContain(`post ${idOf(107)} has no thread (404): skipped`);
    expect(
      h.store.readJson<{ gone: string[] }>('reports/after-run-1-after-run-2.json')?.gone,
    ).toEqual([idOf(107)]);
    h.writes.length = 0;
    h.server.on('GET', new RegExp(`/social/posts/${idOf(107)}/replies$`), () =>
      refusal(500, 'INTERNAL'),
    );
    expect(await report()).toBe(1);
    expect(out()).not.toContain('PASS');
  });

  it('prints FAIL for a check that fails, still prints everything, and exits 1', async () => {
    const input = fixture();
    input.b.snapshot.top = [...input.a.snapshot.top];
    seed(input);
    expect(await report()).toBe(1);
    const text = out();
    expect(text).toContain('FAIL R7');
    expect(text).toContain('PASS R1');
    expect(text).toContain('1 of 9 checks fail: R7');
    const errors = h.writes
      .filter((write) => write.stream === 'err')
      .map((write) => write.text)
      .join('');
    expect(errors).toContain('report: 1 of 9 checks fail (R7)');
  });

  it("notes that staging's commit changed between the snapshots", async () => {
    const input = fixture();
    input.b.snapshot.commit = 'def5678';
    seed(input);
    await report();
    expect(out()).toContain(
      'abc1234 at the first snapshot, def5678 at the second (it changed between them)',
    );
  });

  it('saves the report in the store, 0600, with nothing that is not an id, a count or a handle', async () => {
    seed();
    await report();
    const saved = h.store.readJson<{ checks: Check[]; a: number; b: number }>(
      'reports/after-run-1-after-run-2.json',
    );
    expect(saved?.checks).toHaveLength(9);
    expect(saved).toMatchObject({ a: 1, b: 2 });
    expect(statSync(join(h.home, 'reports/after-run-1-after-run-2.json')).mode & 0o777).toBe(0o600);
  });

  it('takes the last two runs on the current set by default, and --runs a,b when given', async () => {
    seed();
    const state = readState(h.store);
    state.runs.unshift({
      n: 0,
      set: 'old.json',
      open: false,
      startedAt: at(8, 0),
      endedAt: at(8, 30),
    });
    state.runs = state.runs.filter((run) => run.n !== 0);
    state.runs.push({
      n: 3,
      set: 'set.json',
      open: false,
      startedAt: at(12, 0),
      endedAt: at(12, 40),
    });
    writeState(h.store, state);
    // Run 3 has no snapshot: the default (2 and 3) asks for it, and --runs 1,2 does not need it.
    expect(await report()).toBe(2);
    expect(out() + h.writes.map((write) => write.text).join('')).toContain(
      'snapshot after-run-3 --wait',
    );
    h.writes.length = 0;
    expect(await report('--runs', '1,2')).toBe(0);
  });

  it('refuses what it cannot compare', async () => {
    expect(await report()).toBe(2);
    seed();
    for (const bad of ['1', '2,1', '1,1', 'a,b', '1,2,3', '0,2', '1,9']) {
      h.writes.length = 0;
      expect(await report('--runs', bad), bad).toBe(2);
    }
    expect(await report('now')).toBe(2);
    const state = readState(h.store);
    const [first, second] = state.runs;
    if (!first || !second) throw new Error('no runs');
    second.open = true;
    writeState(h.store, state);
    expect(await report()).toBe(2);
    second.open = false;
    state.current = null;
    writeState(h.store, state);
    h.store.remove('snapshots/after-run-2.json');
    h.writes.length = 0;
    expect(await report()).toBe(2);
    expect(h.writes.map((write) => write.text).join('')).toContain(
      'There is no snapshot after run 2',
    );
  });

  it('says only one run has been made when there is one', async () => {
    seed();
    const state = readState(h.store);
    state.runs = state.runs.slice(0, 1);
    writeState(h.store, state);
    expect(await report()).toBe(2);
    expect(h.writes.map((write) => write.text).join('')).toContain('only one has been made');
  });

  it('can be called directly', async () => {
    seed();
    await reportCommand(h.ctx, {});
    expect(out()).toContain('all 9 checks pass');
  });
});
