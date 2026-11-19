import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, harness, idOf, json, seedMember, seedSet } from './harness.ts';
import { inboxCommand } from './inbox.ts';
import { appendLog, type LogEntry, readLog, totalsOf } from './log.ts';
import { main } from './main.ts';
import { retireCommand } from './make.ts';
import { freshEntry, keyFile, MEMBERS, readCast, writeCast } from './members.ts';
import { readState } from './state.ts';

/** Test group 10: runs, the inbox, and `retire`. */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const STORY = idOf(10);
const POST = idOf(20);
/** `Omit` for each kind of log entry, not for what they have in common. */
type WithoutTime<T> = T extends unknown ? Omit<T, 't'> : never;
const run = (...argv: string[]) => main(argv, h.io, () => h.ctx);
const last = () => h.printed();

describe('runs', () => {
  it('start needs a set, one run is open at a time, and each is numbered', async () => {
    expect(await run('run', 'start')).toBe(2);
    expect(last()).toContain('No story set is loaded');
    seedSet(h, [STORY]);
    expect(await run('run', 'start')).toBe(0);
    expect(readState(h.store).runs).toMatchObject([
      { n: 1, set: 'set.json', open: true, endedAt: null },
    ]);
    expect(await run('run', 'start')).toBe(2);
    expect(last()).toContain('Run 1 is open');
    expect(await run('run', 'end')).toBe(0);
    expect(readState(h.store).runs[0]?.open).toBe(false);
    expect(await run('run', 'end')).toBe(2);
    expect(await run('run', 'start')).toBe(0);
    expect(readState(h.store).runs.map((one) => [one.n, one.open])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('refuses anything but start, end and show', async () => {
    expect(await run('run')).toBe(2);
    expect(await run('run', 'pause')).toBe(2);
    expect(await run('run', 'start', 'now')).toBe(2);
  });

  it('show names who is next, from the log, and gives the tally as distinct things', async () => {
    seedSet(h, [STORY, idOf(11), idOf(12)], { run: 1 });
    h.server.on('GET', '/api/v1/social/board', () =>
      json(200, {
        stories: [
          { id: STORY, picture: { url: 'https://media.example/a.webp' } },
          { id: idOf(11), picture: null },
          { id: idOf(99), picture: { url: 'https://media.example/b.webp' } },
        ],
        next: null,
      }),
    );
    const at = (entry: WithoutTime<LogEntry>) =>
      appendLog(h.store, 1, { t: 'x', ...entry } as LogEntry);
    at({ member: 'explainer', type: 'checkin', asOf: 'a', since: 's', inbox: [] });
    at({ member: 'explainer', type: 'checkin_done', seenUntil: 'a', at: 'b', noteLength: 3 });
    at({ member: 'source-checker', type: 'checkin', asOf: 'a', since: 's', inbox: [] });
    at({
      member: 'explainer',
      type: 'post',
      id: POST,
      storyId: STORY,
      kind: 'video',
      format: null,
      mediaId: idOf(60),
    });
    // The same post logged again (a command run again): it counts once.
    at({
      member: 'explainer',
      type: 'post',
      id: POST,
      storyId: STORY,
      kind: 'video',
      format: null,
      mediaId: idOf(60),
    });
    at({
      member: 'meme-maker',
      type: 'post',
      id: idOf(21),
      storyId: idOf(11),
      kind: 'image',
      format: 'meme',
      mediaId: idOf(61),
    });
    at({
      member: 'source-checker',
      type: 'reply',
      id: idOf(40),
      postId: POST,
      parentId: null,
      storyId: STORY,
      intent: 'ask',
      depth: 0,
    });
    at({
      member: 'source-checker',
      type: 'reply',
      id: idOf(40),
      postId: POST,
      parentId: null,
      storyId: STORY,
      intent: 'ask',
      depth: 0,
    });
    at({
      member: 'explainer',
      type: 'reply',
      id: idOf(41),
      postId: POST,
      parentId: idOf(40),
      storyId: STORY,
      intent: 'answer',
      depth: 1,
    });
    at({ member: 'analyst', type: 'upvote', postId: POST, storyId: STORY });
    at({ member: 'analyst', type: 'upvote', postId: POST, storyId: STORY });
    at({ member: 'translator', type: 'upvote', postId: POST, storyId: STORY });

    expect(await run('run', 'show')).toBe(0);
    const text = last();
    expect(text).toContain('run 1 (open) on set.json');
    expect(text).toContain('explainer: finished');
    expect(text).toContain('source-checker: checked in');
    expect(text).toContain('analyst: not started');
    expect(text).toContain('next: source-checker (checked in)');
    expect(text).toContain('posts: 2 (text 0, image 1, video 1, audio 0)');
    expect(text).toContain('replies: 2');
    expect(text).toContain('ask: d0 1, d1 0, d2 0, d3 0');
    expect(text).toContain('answer: d0 0, d1 1, d2 0, d3 0');
    expect(text).toContain('upvotes: 2');
    expect(text).toContain('stories with a picture: 1 of 3');
    expect(totalsOf(readLog(h.store, 1)).posts.size).toBe(2);
  });

  it('show says every member is done when all six finished, and that a closed run has no next', async () => {
    seedSet(h, [STORY], { run: 1 });
    h.server.on('GET', '/api/v1/social/board', () => json(200, { stories: [], next: null }));
    for (const member of MEMBERS) {
      appendLog(h.store, 1, {
        t: 'x',
        member: member.key,
        type: 'checkin_done',
        seenUntil: 'a',
        at: 'b',
        noteLength: 1,
      });
    }
    await run('run', 'show');
    expect(last()).toContain('all six members finished');
    await run('run', 'end');
    h.writes.length = 0;
    await run('run', 'show');
    expect(last()).toContain('run 1 (closed)');
    expect(last()).toContain('next: none, the run is closed');
  });

  it('show still works when the board cannot be read', async () => {
    seedSet(h, [STORY], { run: 1 });
    h.server.fault = { at: 0, apply: false };
    expect(await run('run', 'show')).toBe(0);
    expect(last()).toContain('stories with a picture: unknown');
  });

  it('show has nothing to show before a run', async () => {
    expect(await run('run', 'show')).toBe(2);
  });
});

describe('inbox', () => {
  const reply = (n: number, extra: Record<string, unknown> = {}) => ({
    id: idOf(100 + n),
    postId: POST,
    parentId: null,
    agent: { handle: 'hztest_analyst' },
    intent: 'ask',
    depth: 0,
    body: `Words of reply ${n}, which are another agent's and so data`,
    sources: [],
    createdAt: `2026-11-19T0${n}:00:00.000Z`,
    children: 0,
    ...extra,
  });
  let member: { handle: string; key: string };

  beforeEach(() => {
    member = seedMember(h, 'explainer');
    seedSet(h, [STORY], { run: 1 });
    h.server.on('GET', `/api/v1/social/posts/${POST}/replies`, () =>
      json(200, { replies: [], next: null }),
    );
  });

  const unanswered = () => {
    const printed = last();
    return JSON.parse(printed.slice(printed.indexOf('{'))) as {
      unanswered: number;
      replies: Array<{ id: string; status: string; body: string }>;
    };
  };

  it("lists the unanswered replies, oldest first, with their words as data, and reads the inbox with the member's key", async () => {
    h.server.on('GET', '/api/v1/social/me/inbox', () =>
      json(200, { replies: [reply(3), reply(1), reply(2)], next: null }),
    );
    await inboxCommand(h.ctx, 'explainer');
    const { replies, unanswered: count } = unanswered();
    expect(count).toBe(3);
    expect(replies.map((one) => one.id)).toEqual([idOf(101), idOf(102), idOf(103)]);
    expect(replies[0]?.body).toContain('another agent');
    expect(h.server.to('GET', /me\/inbox$/)[0]?.headers.authorization).toBe(`Bearer ${member.key}`);
    // The threads are read in public, with no key.
    for (const req of h.server.to('GET', /replies$/))
      expect(req.headers.authorization).toBeUndefined();
  });

  it('pages through the whole inbox', async () => {
    h.server.on('GET', '/api/v1/social/me/inbox', (req) =>
      req.query.get('cursor') === 'two'
        ? json(200, { replies: [reply(2)], next: null })
        : json(200, { replies: [reply(1)], next: 'two' }),
    );
    await inboxCommand(h.ctx, 'explainer');
    expect(unanswered().unanswered).toBe(2);
  });

  it('leaves out a reply the log shows the member answered', async () => {
    h.server.on('GET', '/api/v1/social/me/inbox', () =>
      json(200, { replies: [reply(1), reply(2)], next: null }),
    );
    appendLog(h.store, 1, {
      t: 'x',
      member: 'explainer',
      type: 'reply',
      id: idOf(200),
      postId: POST,
      parentId: idOf(101),
      storyId: STORY,
      intent: 'answer',
      depth: 1,
    });
    // Another member's reply to it is not the member's answer.
    appendLog(h.store, 1, {
      t: 'x',
      member: 'analyst',
      type: 'reply',
      id: idOf(201),
      postId: POST,
      parentId: idOf(102),
      storyId: STORY,
      intent: 'answer',
      depth: 1,
    });
    await inboxCommand(h.ctx, 'explainer');
    expect(unanswered().replies.map((one) => one.id)).toEqual([idOf(102)]);
  });

  it('leaves out a reply the public thread shows the member answered, and keeps one answered by someone else', async () => {
    h.server.on('GET', '/api/v1/social/me/inbox', () =>
      json(200, { replies: [reply(1), reply(2)], next: null }),
    );
    h.server.on('GET', `/api/v1/social/posts/${POST}/replies`, (req) => {
      const parent = req.query.get('parent');
      if (parent === idOf(101))
        return json(200, {
          replies: [{ id: idOf(300), agent: { handle: member.handle } }],
          next: null,
        });
      return json(200, {
        replies: [{ id: idOf(301), agent: { handle: 'hztest_analyst' } }],
        next: null,
      });
    });
    await inboxCommand(h.ctx, 'explainer');
    expect(unanswered().replies.map((one) => one.id)).toEqual([idOf(102)]);
  });

  it('shows a reply at depth 3 or deeper that is not an ask as "thread ended", and an ask there as open', async () => {
    h.server.on('GET', '/api/v1/social/me/inbox', () =>
      json(200, {
        replies: [
          reply(1, { depth: 2, intent: 'add' }),
          reply(2, { depth: 3, intent: 'add' }),
          reply(3, { depth: 4, intent: 'push-back' }),
          reply(4, { depth: 3, intent: 'ask' }),
        ],
        next: null,
      }),
    );
    await inboxCommand(h.ctx, 'explainer');
    expect(unanswered().replies.map((one) => [one.id, one.status])).toEqual([
      [idOf(101), 'open'],
      [idOf(102), 'thread ended'],
      [idOf(103), 'thread ended'],
      [idOf(104), 'open'],
    ]);
  });

  it('refuses a member that has not been made, or is not one', async () => {
    expect(await run('inbox', 'analyst')).toBe(2);
    expect(await run('inbox', 'nobody')).toBe(2);
    expect(await run('inbox')).toBe(2);
  });
});

describe('retire', () => {
  const withAgent = () => {
    const seeded = seedMember(h, 'explainer');
    return seeded;
  };

  it("revokes the keys and retires an agent, deletes the member's files, and moves it to its next number", async () => {
    const seeded = withAgent();
    const before = readCast(h.store).members.explainer;
    h.store.writeText(`codes/${seeded.handle}`, 'a code\n');
    h.server.on('POST', /^\/api\/v1\/admin\/social\/agents\/[0-9a-f-]{36}\/revoke-keys$/, () =>
      json(200, { state: 'retired' }),
    );
    await retireCommand(h.ctx, 'explainer');
    const [call] = h.server.to('POST', /revoke-keys$/);
    expect(call?.path).toContain(before?.agentId ?? 'missing');
    expect(call?.body).toEqual({ reason: 'Test cast: retired', retire: true });
    expect(call?.body).not.toHaveProperty('requestId');
    expect(h.store.exists(keyFile(seeded.handle))).toBe(false);
    expect(h.store.exists(`codes/${seeded.handle}`)).toBe(false);
    expect(readCast(h.store).members.explainer).toMatchObject({
      n: 2,
      handle: 'hztest_explainer_2',
      email: 'delivered+run-cast-explainer-2@resend.dev',
      inviteId: null,
      agentId: null,
      claimedAt: null,
    });
    expect(readCast(h.store).members.explainer?.retiredAt).not.toBeNull();
  });

  it('revokes only the invite when there is no agent yet, which retires its waiting agent', async () => {
    const cast = readCast(h.store);
    const entry = freshEntry(MEMBERS[0], 1);
    entry.inviteId = idOf(700);
    cast.members.explainer = entry;
    writeCast(h.store, cast);
    h.server.on('POST', `/api/v1/admin/social/invites/${idOf(700)}/revoke`, () =>
      json(200, { id: idOf(700) }),
    );
    await retireCommand(h.ctx, 'explainer');
    expect(h.server.to('POST', /revoke-keys$/)).toEqual([]);
    const [call] = h.server.to('POST', /invites\/[0-9a-f-]{36}\/revoke$/);
    expect(call?.body).toEqual({ reason: 'Test cast: retired' });
    expect(readCast(h.store).members.explainer).toMatchObject({
      n: 2,
      inviteId: null,
      agentId: null,
    });
  });

  it('makes no call for a member with neither, and only raises n', async () => {
    await retireCommand(h.ctx, 'translator');
    expect(h.server.requests).toEqual([]);
    expect(readCast(h.store).members.translator).toMatchObject({
      n: 2,
      handle: 'hztest_translator_2',
    });
    // Again: nothing more happens, and n is not raised twice.
    await retireCommand(h.ctx, 'translator');
    expect(readCast(h.store).members.translator?.n).toBe(2);
    expect(last()).toContain('already retired');
  });

  it('retires every member when none is named, and refuses a name that is not a member', async () => {
    await retireCommand(h.ctx);
    expect(Object.values(readCast(h.store).members).map((entry) => entry.n)).toEqual([
      2, 2, 2, 2, 2, 2,
    ]);
    expect(await run('retire', 'nobody')).toBe(2);
    expect(await run('retire', 'explainer', 'analyst')).toBe(2);
  });

  it('finds the agent by its handle when its invite turns out to be claimed', async () => {
    const cast = readCast(h.store);
    const entry = freshEntry(MEMBERS[0], 1);
    entry.inviteId = idOf(700);
    cast.members.explainer = entry;
    writeCast(h.store, cast);
    h.server.on('POST', `/api/v1/admin/social/invites/${idOf(700)}/revoke`, () => ({
      status: 409,
      body: { code: 'CONFLICT', data: { reason: 'invite_claimed' } },
    }));
    h.server.on('GET', '/api/v1/admin/social/agents', () =>
      json(200, { agents: [{ id: idOf(800), handle: 'hztest_explainer' }], next: null }),
    );
    h.server.on('POST', `/api/v1/admin/social/agents/${idOf(800)}/revoke-keys`, () =>
      json(200, {}),
    );
    await retireCommand(h.ctx, 'explainer');
    expect(h.server.to('POST', /revoke-keys$/)).toHaveLength(1);
    expect(readCast(h.store).members.explainer?.n).toBe(2);
  });

  it('can be run again after a stop between the call and the record', async () => {
    seedMember(h, 'explainer');
    h.server.on('POST', /revoke-keys$/, () => json(200, {}));
    h.store.hooks.beforeRename = (path) => {
      if (path.endsWith('cast.json')) throw new Error('the power went');
    };
    await expect(retireCommand(h.ctx, 'explainer')).rejects.toThrow('the power went');
    h.store.hooks.beforeRename = undefined;
    await retireCommand(h.ctx, 'explainer');
    expect(readCast(h.store).members.explainer?.n).toBe(2);
  });
});
