import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUERY_FIELDS, RULES, ruleFor, splitTarget } from './allow.ts';
import { callCommand } from './call.ts';
import { CastError } from './errors.ts';
import { type Harness, harness, idOf, json, seedMember, seedSet } from './harness.ts';
import { appendLog, readLog } from './log.ts';
import { main } from './main.ts';
import { readState } from './state.ts';

/** Test group 2: the allowlist (3.3) and the scope of what `call` sends. */

const STORY = idOf(10);
const OUTSIDE = idOf(11);
const POST = idOf(20);
const UUID = idOf(30);

/** One example path for each row of the table. */
const EXAMPLES: Array<[string, string, string]> = [
  ['GET', '/social/me', 'member'],
  ['GET', '/social/me/checkin', 'member'],
  ['GET', '/social/me/pins', 'member'],
  ['GET', '/social/me/inbox', 'member'],
  ['POST', '/social/me/checkin', 'member'],
  ['POST', '/social/me/pins', 'member'],
  ['POST', `/social/me/pins/${UUID}/unpin`, 'member'],
  ['POST', '/social/me/posts', 'member'],
  ['POST', '/social/me/posts/preview', 'member'],
  ['POST', '/social/me/replies', 'member'],
  ['POST', '/social/me/upvotes', 'member'],
  ['GET', '/social/board', 'none'],
  ['GET', '/social/lists', 'none'],
  ['GET', '/social/formats', 'none'],
  ['GET', '/social/basics', 'none'],
  ['GET', `/social/stories/${UUID}`, 'none'],
  ['GET', `/social/stories/${UUID}/updates`, 'none'],
  ['GET', `/social/stories/${UUID}/posts`, 'none'],
  ['GET', `/social/stories/${UUID}/brief`, 'none'],
  ['GET', `/social/posts/${UUID}`, 'none'],
  ['GET', `/social/posts/${UUID}/replies`, 'none'],
  ['GET', '/social/agents', 'none'],
  ['GET', '/social/agents/hztest_explainer', 'none'],
  ['GET', '/social/agents/hztest_explainer/posts', 'none'],
  ['GET', '/skill.md', 'none'],
];

describe('the table', () => {
  it('allows every row, with the key it names, and nothing else', () => {
    for (const rule of RULES) {
      expect(
        EXAMPLES.some(([method, path]) => method === rule.method && rule.pattern.test(path)),
        `a row of the table for ${rule.pattern}`,
      ).toBe(true);
    }
    for (const [method, path, key] of EXAMPLES) {
      const rule = ruleFor(method, path);
      expect(rule, `${method} ${path}`).not.toBeNull();
      expect(rule?.key).toBe(key);
      // The other method is refused, unless the table has a row for it (a check-in and the pins are read and written).
      const other = method === 'GET' ? 'POST' : 'GET';
      if (!EXAMPLES.some(([m, p]) => m === other && p === path)) {
        expect(ruleFor(other, path), `the other method of ${path}`).toBeNull();
      }
    }
  });

  it('takes a request ID on every write but the preview, and on no read', () => {
    for (const rule of RULES) {
      expect(rule.requestId).toBe(
        rule.method === 'POST' && !rule.pattern.test('/social/me/posts/preview'),
      );
    }
  });

  it.each([
    ['POST', '/social/me/profile'],
    ['POST', '/social/me/uploads'],
    ['POST', `/social/me/uploads/${UUID}/done`],
    ['GET', '/social/me/stats'],
    ['GET', '/me'],
    ['POST', '/trades'],
    ['POST', '/admin/social/invites'],
    ['GET', '/admin/social/agents'],
    ['POST', '/owner/claims'],
    ['POST', '/social/agents'],
    ['GET', '/social/stories/not-a-uuid'],
    ['GET', `/social/stories/${UUID}/other`],
    ['GET', `/social/posts/${UUID}/replies/x`],
    ['GET', '/social/agents/Bad-Handle'],
    ['GET', '/social/agents/ab'],
    ['GET', '/social/me/checkin/extra'],
    ['PUT', '/social/me'],
    ['DELETE', '/social/me'],
    ['GET', '/social/board/'],
  ])('refuses %s %s', (method, path) => {
    expect(ruleFor(method, path)).toBeNull();
  });
});

describe('queries', () => {
  it('allow only limit, cursor, sort, category, place and parent', () => {
    expect([...QUERY_FIELDS].sort()).toEqual([
      'category',
      'cursor',
      'limit',
      'parent',
      'place',
      'sort',
    ]);
    expect(
      splitTarget(
        '/social/board?limit=5&sort=latest&category=general&place=india&cursor=abc&parent=x',
      ),
    ).toEqual({
      path: '/social/board',
      query: {
        limit: '5',
        sort: 'latest',
        category: 'general',
        place: 'india',
        cursor: 'abc',
        parent: 'x',
      },
    });
    expect(splitTarget('/social/board')).toEqual({ path: '/social/board', query: {} });
  });

  it.each([
    '?foo=1',
    '?limit=5&foo=1',
    '?limit=1&limit=2',
    '?cursor=a%00b',
    `?cursor=${'a'.repeat(601)}`,
    '?requestId=x',
    '?key=1',
  ])('refuses %s', (query) => {
    expect(() => splitTarget(`/social/board${query}`)).toThrow(CastError);
  });
});

describe('`call`', () => {
  let h: Harness;
  let member: { handle: string; key: string };
  beforeEach(() => {
    h = harness();
    member = seedMember(h, 'explainer');
    seedSet(h, [STORY], { run: 1 });
    h.server.on('GET', '/api/v1/social/board', () => json(200, { stories: [], next: null }));
    h.server.on('GET', '/api/v1/social/lists', () => json(200, { categories: [] }));
    h.server.on('POST', '/api/v1/social/me/posts/preview', () =>
      json(200, { card: {}, warnings: [] }),
    );
    h.server.on('GET', '/api/v1/social/me', () => json(200, { handle: member.handle }));
    h.server.on('POST', '/api/v1/social/me/pins', () =>
      json(200, { pin: { storyId: STORY }, brief: { markdown: 'A brief' } }),
    );
    h.server.on('POST', '/api/v1/social/me/posts', (req) =>
      json(201, {
        id: POST,
        storyId: (req.body as { storyId: string }).storyId,
        kind: 'text',
        format: null,
        media: null,
      }),
    );
    h.server.on('POST', '/api/v1/social/me/replies', (req) =>
      json(201, {
        id: idOf(40),
        postId: (req.body as { postId: string }).postId,
        parentId: null,
        intent: 'add',
        depth: 0,
      }),
    );
    h.server.on('POST', '/api/v1/social/me/upvotes', () =>
      json(200, { postId: POST, upvoted: true }),
    );
  });
  afterEach(() => h.cleanup());

  const run = (...argv: string[]) => main(['call', ...argv], h.io, () => h.ctx);
  const body = (value: unknown) => h.store.writeText('work/body.json', JSON.stringify(value));

  it('sends a public read with no key at all, and refuses to send one a member', async () => {
    expect(await run('-', 'GET', '/social/board?limit=5')).toBe(0);
    expect(h.server.requests[0]?.headers.authorization).toBeUndefined();
    expect(h.server.requests[0]?.url).toContain('limit=5');
    expect(await run('explainer', 'GET', '/social/board')).toBe(2);
    expect(h.server.requests).toHaveLength(1);
  });

  it("sends a member's call with its key as a Bearer header, and refuses one with member `-`", async () => {
    expect(await run('explainer', 'GET', '/social/me')).toBe(0);
    expect(h.server.requests[0]?.headers.authorization).toBe(`Bearer ${member.key}`);
    expect(await run('-', 'GET', '/social/me')).toBe(2);
    expect(await run('hztest_explainer', 'GET', '/social/me')).toBe(2);
    expect(await run('../x', 'GET', '/social/me')).toBe(2);
    expect(h.server.requests).toHaveLength(1);
  });

  it('prints the answer, with nothing it carries as a secret', async () => {
    h.server.on('GET', '/api/v1/social/me', () =>
      json(200, { handle: member.handle, secret: 'dropped', note: member.key }),
    );
    await run('explainer', 'GET', '/social/me');
    const printed = h.printed();
    expect(printed).toContain(member.handle);
    expect(printed).not.toContain('dropped');
    expect(printed).not.toContain(member.key);
  });

  it('refuses what is not on the list, a query field that is not allowed, and a GET with a body', async () => {
    expect(await run('explainer', 'POST', '/social/me/profile', '--body', 'body.json')).toBe(2);
    expect(await run('-', 'GET', '/social/board?foo=1')).toBe(2);
    expect(await run('-', 'DELETE', '/social/board')).toBe(2);
    expect(await run('-', 'GET', '/social/board', '--body', 'body.json')).toBe(2);
    expect(await run('-', 'GET', '//evil.example/x')).toBe(2);
    expect(await run('-', 'GET', '/social/../admin')).toBe(2);
    expect(h.server.requests).toEqual([]);
  });

  it('sends a write only while a run is open', async () => {
    body({ storyId: STORY });
    const state = readState(h.store);
    const open = state.runs[0];
    if (!open) throw new Error('no run');
    open.open = false;
    h.store.writeJson('state.json', state);
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'body.json')).toBe(2);
    expect(h.printed()).toContain('No run is open');
    expect(h.server.requests).toEqual([]);
    // Reads need none.
    expect(await run('explainer', 'GET', '/social/me')).toBe(0);
  });

  it('refuses a body that holds a requestId, one that is not a JSON object, and one outside work/', async () => {
    body({ storyId: STORY, requestId: idOf(1) });
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'body.json')).toBe(2);
    h.store.writeText('work/list.json', '[1]');
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'list.json')).toBe(2);
    h.store.writeText('stories/body.json', JSON.stringify({ storyId: STORY }));
    expect(
      await run('explainer', 'POST', '/social/me/pins', '--body', `${h.home}/stories/body.json`),
    ).toBe(2);
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', '../body.json')).toBe(2);
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'missing.json')).toBe(2);
    expect(h.server.requests).toEqual([]);
  });

  it('takes a body named by a path under work/, from where pnpm was run, as well as by its bare name', async () => {
    body({ storyId: STORY });
    h.ctx.cwd = h.home;
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'work/body.json')).toBe(0);
    expect(
      await run('explainer', 'POST', '/social/me/pins', '--body', `${h.home}/work/body.json`),
    ).toBe(0);
    h.ctx.cwd = '/somewhere/else';
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'work/body.json')).toBe(2);
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'body.json')).toBe(0);
  });

  it('reads a body from standard input when it is `-`', async () => {
    h.ctx.stdin = async () => JSON.stringify({ storyId: STORY });
    expect(await run('explainer', 'POST', '/social/me/pins', '--body', '-')).toBe(0);
    expect(h.server.requests[0]?.body).toMatchObject({ storyId: STORY });
    expect(h.server.requests[0]?.body?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe('scope', () => {
    it('lets a pin and a post name a story of the current set, and refuses any other', async () => {
      body({ storyId: STORY, kind: 'text', body: 'Words' });
      expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'body.json')).toBe(0);
      expect(await run('explainer', 'POST', '/social/me/posts', '--body', 'body.json')).toBe(0);
      expect(
        await run('explainer', 'POST', '/social/me/posts/preview', '--body', 'body.json'),
      ).toBe(0);
      body({ storyId: OUTSIDE, kind: 'text', body: 'Words' });
      const before = h.server.requests.length;
      expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'body.json')).toBe(2);
      expect(await run('explainer', 'POST', '/social/me/posts', '--body', 'body.json')).toBe(2);
      expect(
        await run('explainer', 'POST', '/social/me/posts/preview', '--body', 'body.json'),
      ).toBe(2);
      body({ kind: 'text', body: 'Words' });
      expect(await run('explainer', 'POST', '/social/me/posts', '--body', 'body.json')).toBe(2);
      expect(h.server.requests).toHaveLength(before);
    });

    it('refuses any story at all when no set is current', async () => {
      const state = readState(h.store);
      state.current = null;
      h.store.writeJson('state.json', state);
      body({ storyId: STORY });
      expect(await run('explainer', 'POST', '/social/me/pins', '--body', 'body.json')).toBe(2);
    });

    it('lets a reply and an upvote name a post known from the log, on a story of the set', async () => {
      appendLog(h.store, 1, {
        t: 'x',
        member: 'analyst',
        type: 'post',
        id: POST,
        storyId: STORY,
        kind: 'text',
        format: null,
        mediaId: null,
      });
      body({ postId: POST, intent: 'add', body: 'Words' });
      expect(await run('explainer', 'POST', '/social/me/replies', '--body', 'body.json')).toBe(0);
      body({ postId: POST });
      expect(await run('explainer', 'POST', '/social/me/upvotes', '--body', 'body.json')).toBe(0);
      expect(h.server.to('GET', /social\/posts/)).toEqual([]);
      const entries = readLog(h.store, 1);
      expect(
        entries.some(
          (entry) =>
            entry.type === 'reply' && entry.storyId === STORY && entry.member === 'explainer',
        ),
      ).toBe(true);
      expect(entries.some((entry) => entry.type === 'upvote' && entry.postId === POST)).toBe(true);
    });

    it('reads the post to find its story when the log does not know it, and refuses one outside the set', async () => {
      h.server.on('GET', `/api/v1/social/posts/${POST}`, () =>
        json(200, { id: POST, storyId: STORY }),
      );
      h.server.on('GET', `/api/v1/social/posts/${idOf(21)}`, () =>
        json(200, { id: idOf(21), storyId: OUTSIDE }),
      );
      body({ postId: POST });
      expect(await run('explainer', 'POST', '/social/me/upvotes', '--body', 'body.json')).toBe(0);
      const read = h.server.to('GET', /social\/posts\//)[0];
      expect(read?.headers.authorization).toBeUndefined();
      body({ postId: idOf(21) });
      expect(await run('explainer', 'POST', '/social/me/upvotes', '--body', 'body.json')).toBe(2);
      body({ postId: idOf(22) });
      // A post staging doesn't know is its own refusal (404), not the script's.
      expect(await run('explainer', 'POST', '/social/me/replies', '--body', 'body.json')).toBe(1);
      expect(h.server.to('POST', /upvotes$/)).toHaveLength(1);
      expect(h.server.to('POST', /replies$/)).toEqual([]);
    });
  });

  it('logs ids only: a pin, a post, a reply, an upvote and a finished check-in', async () => {
    h.server.on('POST', '/api/v1/social/me/checkin', () =>
      json(200, { seenUntil: '2026-11-19T10:00:00.000Z', at: '2026-11-19T10:00:01.000Z' }),
    );
    appendLog(h.store, 1, {
      t: 'x',
      member: 'analyst',
      type: 'post',
      id: POST,
      storyId: STORY,
      kind: 'text',
      format: null,
      mediaId: null,
    });
    body({ storyId: STORY });
    await run('explainer', 'POST', '/social/me/pins', '--body', 'body.json');
    body({ storyId: STORY, kind: 'text', body: 'Words that are never logged' });
    await run('explainer', 'POST', '/social/me/posts', '--body', 'body.json');
    body({ postId: POST, intent: 'add', body: 'Reply words never logged' });
    await run('explainer', 'POST', '/social/me/replies', '--body', 'body.json');
    const note = 'A note whose words are never logged, only its length';
    body({ seenUntil: '2026-11-19T10:00:00.000Z', note });
    await run('explainer', 'POST', '/social/me/checkin', '--body', 'body.json');
    const entries = readLog(h.store, 1);
    expect(entries.map((entry) => entry.type)).toEqual([
      'post',
      'pin',
      'post',
      'reply',
      'checkin_done',
    ]);
    expect(entries.at(-1)).toMatchObject({
      type: 'checkin_done',
      member: 'explainer',
      noteLength: note.length,
    });
    const text = h.store.readText('log/run-1.jsonl') ?? '';
    expect(text).not.toContain('never logged');
    expect(text).not.toContain('A note whose');
    expect(text).not.toContain(member.key);
  });

  it("logs a check-in's asOf, since and inbox, ids only", async () => {
    h.server.on('GET', '/api/v1/social/me/checkin', () =>
      json(200, {
        asOf: '2026-11-19T10:00:00.000Z',
        since: '2026-11-18T10:00:00.000Z',
        inbox: {
          replies: [
            {
              id: idOf(50),
              postId: POST,
              parentId: null,
              intent: 'ask',
              depth: 0,
              body: 'Words never logged',
              agent: { handle: 'hztest_analyst' },
              createdAt: '2026-11-19T09:00:00.000Z',
            },
          ],
          more: false,
        },
      }),
    );
    await run('explainer', 'GET', '/social/me/checkin');
    const [entry] = readLog(h.store, 1);
    expect(entry).toMatchObject({
      type: 'checkin',
      member: 'explainer',
      asOf: '2026-11-19T10:00:00.000Z',
      since: '2026-11-18T10:00:00.000Z',
      inbox: [
        {
          id: idOf(50),
          postId: POST,
          parentId: null,
          intent: 'ask',
          depth: 0,
          from: 'hztest_analyst',
        },
      ],
    });
    expect(h.store.readText('log/run-1.jsonl')).not.toContain('never logged');
  });

  it('reads the skill file at the origin root, with no key', async () => {
    expect(await run('-', 'GET', '/skill.md')).toBe(0);
    expect(h.server.requests[0]?.url).toBe('https://staging.hrizzup.com/skill.md');
    expect(h.server.requests[0]?.headers.authorization).toBeUndefined();
    expect(h.printed()).toContain('Hrizzup: a guide for agents');
  });

  it('answers a call function directly too', async () => {
    await callCommand(h.ctx, { member: '-', method: 'get', target: '/social/lists' });
    expect(h.server.requests[0]?.method).toBe('GET');
  });
});
