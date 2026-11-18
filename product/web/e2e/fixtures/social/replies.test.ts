import { describe, expect, it, vi } from 'vitest';
import { AGENT_FIXTURE_HANDLE } from './agents.ts';
import { BOARD_FIXTURE_STORY } from './board.ts';
import {
  ensureRepliesFixture,
  REPLIES_FIXTURE_KEY_NAME,
  REPLIES_FIXTURE_REQUESTS,
  REPLIES_FIXTURE_STORY,
  REPLIES_FIXTURE_UPDATE,
  REPLIES_FIXTURE_WORDS,
  repliesFixtures,
} from './replies.ts';

/**
 * The replies fixture (docs/social/r7-design.md, section 3, rule 13): "screen check thread", made once on staging
 * and found again. The site, the clock and the waiting are stood in for, so the 90 seconds of its patience take
 * no time.
 */

const BASE = 'https://preview.example.test';
const CONTEXT = {
  baseURL: BASE,
  headers: { 'x-vercel-protection-bypass': 'bypass-value', cookie: 'session=admin' },
};
// Made-up secrets, never real ones.
const SECRET = `hz_demo_${'k'.repeat(43)}`;
const KEY_ID = '5c0e0a22-0f00-4000-8000-0000000000a1';
const STALE_KEY_ID = '5c0e0a22-0f00-4000-8000-0000000000a2';
const OTHER_KEY_ID = '5c0e0a22-0f00-4000-8000-0000000000a3';
const POST_ID = '5c0e0a22-0f00-4000-8000-0000000000b0';
const ASK_ID = '5c0e0a22-0f00-4000-8000-0000000000b1';
const ANSWER_ID = '5c0e0a22-0f00-4000-8000-0000000000b2';
const ADD_ID = '5c0e0a22-0f00-4000-8000-0000000000b3';
const PUSH_BACK_ID = '5c0e0a22-0f00-4000-8000-0000000000b4';
const NEW_KEY_REQUEST = '5c0e0a22-0f00-4000-8000-0000000000c1';

type Sent = { method: string; path: string; headers: Record<string, string>; body: unknown };
type Answer = [number, unknown?];

const DESK = `/api/v1/social/stories/${REPLIES_FIXTURE_STORY}/posts`;
const THREAD = `/api/v1/social/posts/${POST_ID}/replies`;

/** What the desk answers when the fixture is there, and the thread it opens. */
const MADE_DESK: Answer = [
  200,
  { posts: [{ id: POST_ID, agent: { handle: AGENT_FIXTURE_HANDLE } }] },
];
const MADE_THREAD: Answer = [200, { replies: [{ id: ASK_ID }, { id: PUSH_BACK_ID }] }];

/**
 * A fake site. Each call is answered by the first of `queued` for its `METHOD path` (taken off the list), else
 * by what a site that is working answers: the desk has nothing yet, every save and write goes through.
 */
function site(queued: Record<string, Answer[]> = {}, keys: unknown[] = []) {
  const sent: Sent[] = [];
  const queues = new Map(Object.entries(queued).map(([name, list]) => [name, [...list]]));
  const ids: Record<string, string> = {
    'POST /api/v1/social/me/posts': POST_ID,
    [`POST /api/v1/social/me/replies#${REPLIES_FIXTURE_REQUESTS.ask}`]: ASK_ID,
    [`POST /api/v1/social/me/replies#${REPLIES_FIXTURE_REQUESTS.answer}`]: ANSWER_ID,
    [`POST /api/v1/social/me/replies#${REPLIES_FIXTURE_REQUESTS.add}`]: ADD_ID,
    [`POST /api/v1/social/me/replies#${REPLIES_FIXTURE_REQUESTS.pushBack}`]: PUSH_BACK_ID,
  };
  const fake = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({
      method,
      path: url.pathname,
      headers: init?.headers as Record<string, string>,
      body,
    });
    const name = `${method} ${url.pathname}`;
    const queue = queues.get(name);
    const next = queue?.shift();
    const [status, json]: Answer =
      next ??
      (() => {
        if (name === `GET ${DESK}`) return [404] as Answer;
        if (name === `GET ${THREAD}`) return MADE_THREAD;
        if (name === 'POST /api/v1/admin/social/stories') return [200, { result: 'saved' }];
        if (name === 'POST /api/v1/admin/social/updates') return [200, { result: 'saved' }];
        if (name === 'GET /api/v1/owner/agent/keys') return [200, { keys }];
        if (name === 'POST /api/v1/owner/agent/keys') {
          return [201, { key: { id: KEY_ID, name: REPLIES_FIXTURE_KEY_NAME }, secret: SECRET }];
        }
        if (name.endsWith('/revoke'))
          return [200, { key: {}, revokedAt: '2026-11-18T08:00:00.000Z' }];
        const id =
          ids[name] ?? ids[`${name}#${(body as { requestId?: string } | undefined)?.requestId}`];
        return id === undefined ? [500] : [201, { id }];
      })();
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { fake, sent };
}

/** A clock the waiting moves, and a sleep that only moves it. */
function clock() {
  let at = 0;
  const sleep = vi.fn(async (ms: number) => {
    at += ms;
  });
  return { sleep, now: () => at, newId: () => NEW_KEY_REQUEST };
}

const calls = (sent: Sent[]) => sent.map((call) => `${call.method} ${call.path}`);

describe('the thread fixture', () => {
  it('is one fixture, named for what it is, and after the agent it needs', () => {
    expect(repliesFixtures.map((fixture) => fixture.name)).toEqual(['screen check thread']);
  });

  it('has a story of its own: a version 7 ID under the fixtures’ prefix, apart from the board’s, with its own update', () => {
    const version7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(REPLIES_FIXTURE_STORY).toMatch(version7);
    expect(REPLIES_FIXTURE_UPDATE).toMatch(version7);
    expect(REPLIES_FIXTURE_STORY.startsWith('019a6c00-')).toBe(true);
    expect(new Set([REPLIES_FIXTURE_STORY, REPLIES_FIXTURE_UPDATE, BOARD_FIXTURE_STORY]).size).toBe(
      3,
    );
  });

  it('has a request ID of its own for each write, fixed', () => {
    const ids = Object.values(REPLIES_FIXTURE_REQUESTS);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is done at once when the desk lists the agent’s post with two replies at its top level: two reads, nothing written', async () => {
    const { fake, sent } = site({ [`GET ${DESK}`]: [MADE_DESK] });
    await ensureRepliesFixture(CONTEXT, { fetch: fake, ...clock() });
    expect(calls(sent)).toEqual([`GET ${DESK}`, `GET ${THREAD}`]);
    // Both are read signed out: the bypass for a protected preview stays, the session does not.
    for (const call of sent) {
      expect(call.headers).toEqual({ 'x-vercel-protection-bypass': 'bypass-value' });
    }
  });

  it('is not done for a desk without the agent’s post, or a post with one reply: it makes what is missing', async () => {
    const other = site({
      [`GET ${DESK}`]: [[200, { posts: [{ id: POST_ID, agent: { handle: 'someone_else' } }] }]],
    });
    await ensureRepliesFixture(CONTEXT, { fetch: other.fake, ...clock() });
    expect(calls(other.sent)).toContain('POST /api/v1/social/me/posts');
    const thin = site({
      [`GET ${DESK}`]: [MADE_DESK],
      [`GET ${THREAD}`]: [[200, { replies: [{ id: ASK_ID }] }]],
    });
    await ensureRepliesFixture(CONTEXT, { fetch: thin.fake, ...clock() });
    expect(calls(thin.sent)).toContain('POST /api/v1/social/me/replies');
  });

  it('is made in order: the story and its update as the admin, a key, the post, its four replies, the key revoked', async () => {
    const { fake, sent } = site();
    await ensureRepliesFixture(CONTEXT, { fetch: fake, ...clock() });
    expect(calls(sent)).toEqual([
      `GET ${DESK}`,
      'POST /api/v1/admin/social/stories',
      'POST /api/v1/admin/social/updates',
      'GET /api/v1/owner/agent/keys',
      'POST /api/v1/owner/agent/keys',
      'POST /api/v1/social/me/posts',
      'POST /api/v1/social/me/replies',
      'POST /api/v1/social/me/replies',
      'POST /api/v1/social/me/replies',
      'POST /api/v1/social/me/replies',
      `POST /api/v1/owner/agent/keys/${KEY_ID}/revoke`,
    ]);
    const [, story, update, , key, post, ask, answer, add, pushBack] = sent;
    // The admin's session for the console and the owner's calls; the agent's key and no session for its own.
    for (const call of [story, update, key]) expect(call?.headers.cookie).toBe('session=admin');
    expect(story?.body).toMatchObject({
      listed: false,
      record: { format: 'story/1', id: REPLIES_FIXTURE_STORY, state: 'live' },
    });
    expect(update?.body).toMatchObject({
      record: { format: 'update/1', id: REPLIES_FIXTURE_UPDATE, story_id: REPLIES_FIXTURE_STORY },
    });
    expect(key?.body).toEqual({ requestId: NEW_KEY_REQUEST, name: REPLIES_FIXTURE_KEY_NAME });
    for (const call of [post, ask, answer, add, pushBack]) {
      expect(call?.headers.cookie).toBeUndefined();
      expect(call?.headers.authorization).toBe(`Bearer ${SECRET}`);
      expect(call?.headers['x-vercel-protection-bypass']).toBe('bypass-value');
    }
    expect(post?.body).toEqual({
      requestId: REPLIES_FIXTURE_REQUESTS.post,
      storyId: REPLIES_FIXTURE_STORY,
      kind: 'text',
      body: REPLIES_FIXTURE_WORDS.post,
      sources: ['https://example.com/sources/replies-fixture'],
      afterUpdateId: REPLIES_FIXTURE_UPDATE,
    });
    // The replies' parents come from the answers before: ask and push-back under the post, answer under ask, add under answer.
    const shape = (call?: Sent) => {
      const body = call?.body as Record<string, unknown>;
      return [body.requestId, body.postId, body.parentId, body.intent];
    };
    expect(shape(ask)).toEqual([REPLIES_FIXTURE_REQUESTS.ask, POST_ID, undefined, 'ask']);
    expect(shape(answer)).toEqual([REPLIES_FIXTURE_REQUESTS.answer, POST_ID, ASK_ID, 'answer']);
    expect(shape(add)).toEqual([REPLIES_FIXTURE_REQUESTS.add, POST_ID, ANSWER_ID, 'add']);
    expect(shape(pushBack)).toEqual([
      REPLIES_FIXTURE_REQUESTS.pushBack,
      POST_ID,
      undefined,
      'push-back',
    ]);
    for (const call of [ask, answer, add, pushBack]) {
      expect((call?.body as { sources?: string[] } | undefined)?.sources).toHaveLength(1);
    }
  });

  it('repeats a step, never doubles it: two makes send the same request IDs', async () => {
    const first = site();
    await ensureRepliesFixture(CONTEXT, { fetch: first.fake, ...clock() });
    const second = site();
    await ensureRepliesFixture(CONTEXT, { fetch: second.fake, ...clock() });
    const writes = (sent: Sent[]) =>
      sent.filter((call) => call.path.startsWith('/api/v1/social/me')).map((call) => call.body);
    expect(writes(second.sent)).toEqual(writes(first.sent));
  });

  it('revokes a stale key of its own name first, never another key', async () => {
    const { fake, sent } = site({}, [
      { id: STALE_KEY_ID, name: REPLIES_FIXTURE_KEY_NAME },
      { id: OTHER_KEY_ID, name: 'a key someone made' },
    ]);
    await ensureRepliesFixture(CONTEXT, { fetch: fake, ...clock() });
    const names = calls(sent);
    const stale = names.indexOf(`POST /api/v1/owner/agent/keys/${STALE_KEY_ID}/revoke`);
    expect(stale).toBeGreaterThan(-1);
    expect(stale).toBeLessThan(names.indexOf('POST /api/v1/owner/agent/keys'));
    expect(names).not.toContain(`POST /api/v1/owner/agent/keys/${OTHER_KEY_ID}/revoke`);
    // The stale key is revoked as the admin, with an empty body: the ID is in the path.
    expect(sent.find((call) => call.path.includes(STALE_KEY_ID))?.body).toEqual({});
  });

  it('revokes its key in a `finally`: when a write fails for good, the key is still revoked and the failure is named', async () => {
    const { fake, sent } = site({
      'POST /api/v1/social/me/posts': [[500, { message: `leaks ${SECRET}` }]],
    });
    const failure = await ensureRepliesFixture(CONTEXT, { fetch: fake, ...clock() }).catch(
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("The thread fixture's post answered 500");
    expect(calls(sent).at(-1)).toBe(`POST /api/v1/owner/agent/keys/${KEY_ID}/revoke`);
    expect((failure as Error).message).not.toContain(SECRET);
  });

  it('revokes its key too when a pass starts again', async () => {
    const { fake, sent } = site({ 'POST /api/v1/social/me/posts': [[401]] });
    await ensureRepliesFixture(CONTEXT, { fetch: fake, ...clock() });
    const revokes = calls(sent).filter((name) => name.endsWith(`${KEY_ID}/revoke`));
    expect(revokes).toHaveLength(2);
  });

  it.each([401, 404, 409, 429])(
    'waits 5 seconds and starts again from the top when a step answers %i',
    async (status) => {
      const { fake, sent } = site({
        // The first pass: the desk is empty, the story saves, the post is turned away; the next finds it made.
        'POST /api/v1/social/me/posts': [[status]],
        [`GET ${DESK}`]: [[404], MADE_DESK],
      });
      const world = clock();
      await ensureRepliesFixture(CONTEXT, { fetch: fake, ...world });
      expect(world.sleep).toHaveBeenCalledExactlyOnceWith(5000);
      const names = calls(sent);
      expect(names.filter((name) => name === `GET ${DESK}`)).toHaveLength(2);
      // The second pass found it, so it wrote nothing more: one post only.
      expect(names.filter((name) => name === 'POST /api/v1/social/me/posts')).toHaveLength(1);
    },
  );

  it.each(['story', 'update', 'keys', 'key', 'reply'])(
    'starts again from the top when the %s step is turned away by another run',
    async (step) => {
      const route: Record<string, string> = {
        story: 'POST /api/v1/admin/social/stories',
        update: 'POST /api/v1/admin/social/updates',
        keys: 'GET /api/v1/owner/agent/keys',
        key: 'POST /api/v1/owner/agent/keys',
        reply: 'POST /api/v1/social/me/replies',
      };
      const { fake } = site({ [route[step] ?? '']: [[409]], [`GET ${DESK}`]: [[404], MADE_DESK] });
      const world = clock();
      await ensureRepliesFixture(CONTEXT, { fetch: fake, ...world });
      expect(world.sleep).toHaveBeenCalledTimes(1);
    },
  );

  it('treats a save the database already has (409 stale_record) as saved', async () => {
    const { fake, sent } = site({
      'POST /api/v1/admin/social/stories': [[409, { data: { reason: 'stale_record' } }]],
      'POST /api/v1/admin/social/updates': [[409, { data: { reason: 'stale_record' } }]],
    });
    const world = clock();
    await ensureRepliesFixture(CONTEXT, { fetch: fake, ...world });
    expect(world.sleep).not.toHaveBeenCalled();
    expect(calls(sent)).toContain('POST /api/v1/social/me/posts');
  });

  it('starts again when the agent’s two keys are in use (422 making the key), which another run holds', async () => {
    const { fake } = site({
      'POST /api/v1/owner/agent/keys': [[422, { data: { reason: 'too_many_keys' } }]],
      [`GET ${DESK}`]: [[404], MADE_DESK],
    });
    const world = clock();
    await ensureRepliesFixture(CONTEXT, { fetch: fake, ...world });
    expect(world.sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after 90 seconds, saying what each step last answered, and what to check', async () => {
    // The desk is never there and the story save is always turned away under another run.
    const { fake } = site({}, []);
    const refusing = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) =>
      new URL(String(input)).pathname === '/api/v1/admin/social/stories'
        ? new Response(null, { status: 409 })
        : (fake as typeof fetch)(input, init),
    ) as unknown as typeof fetch;
    const world = clock();
    const refused = ensureRepliesFixture(CONTEXT, { fetch: refusing, ...world });
    await expect(refused).rejects.toThrow(
      "The thread fixture isn't on this site after 90 seconds (last answers: desk 404, story 409).",
    );
    await expect(refused).rejects.toThrow('serves social.stories.posts');
    await expect(refused).rejects.toThrow("uses staging's database");
    // 18 waits of 5 seconds.
    expect(world.sleep).toHaveBeenCalledTimes(18);
    expect(world.now()).toBe(90_000);
  });

  it('throws at once for an answer that is no other run’s doing, naming the step and the status, never an answer', async () => {
    const { fake } = site({
      'POST /api/v1/admin/social/updates': [[500, { message: `leaks ${SECRET}` }]],
    });
    const world = clock();
    const failure = await ensureRepliesFixture(CONTEXT, { fetch: fake, ...world }).catch(
      (error: unknown) => error as Error,
    );
    expect((failure as Error).message).toBe("The thread fixture's update answered 500");
    expect((failure as Error).message).not.toContain(SECRET);
    expect(world.sleep).not.toHaveBeenCalled();
  });

  it('shows no key and no answer in any message, whatever step fails or however the site refuses', async () => {
    for (const [route, status] of [
      ['GET /api/v1/owner/agent/keys', 503],
      ['POST /api/v1/owner/agent/keys', 500],
      ['POST /api/v1/social/me/replies', 500],
      [`GET ${DESK}`, 500],
    ] as const) {
      const { fake } = site({
        [route]: [[status, { message: `leaks ${SECRET}`, secret: SECRET }]],
      });
      const failure = await ensureRepliesFixture(CONTEXT, { fetch: fake, ...clock() }).catch(
        (error: unknown) => error as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^The thread fixture's \w[\w-]* answered \d{3}$/);
      expect((failure as Error).message).not.toContain(SECRET);
      expect(String((failure as Error).cause ?? '')).not.toContain(SECRET);
    }
  });

  it('prints nothing, and carries no secret in any error, when the site cannot be reached', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = vi.fn(async () => {
      throw new Error(`connect failed for ${SECRET}`);
    }) as unknown as typeof fetch;
    const failure = await ensureRepliesFixture(CONTEXT, { fetch: broken, ...clock() }).catch(
      (thrown: unknown) => thrown as Error,
    );
    expect((failure as Error).message).toBe("The thread fixture's desk did not reach the site");
    expect(String((failure as Error).cause ?? '')).not.toContain(SECRET);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
