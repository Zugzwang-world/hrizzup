import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, harness, json, refusal } from './harness.ts';
import { type Call, send, sendRaw, templateOf } from './http.ts';

/** Test group 5, retries (rule 6): each row of the table resends the same request, with the same ID. */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const call: Call = {
  method: 'POST',
  path: '/social/me/replies',
  key: 'a-key-for-the-test',
  body: { postId: '01900000-0000-7000-8000-000000000001', intent: 'add', body: 'Words' },
  id: { subject: 'hztest_analyst', run: 1, attempt: 1 },
};

/** Answers in turn, from a script: a status and body, or `drop` for no answer at all. */
function script(
  ...answers: Array<'drop' | { status: number; body?: unknown; headers?: Record<string, string> }>
) {
  let at = 0;
  h.server.on('POST', '/api/v1/social/me/replies', () => {
    const next = answers[Math.min(at++, answers.length - 1)];
    if (next === 'drop') throw new TypeError('fetch failed');
    return { status: next?.status ?? 500, body: next?.body ?? {}, headers: next?.headers ?? {} };
  });
}

/** Every request was the same one: same body, same ID. */
function allTheSame(): void {
  const bodies = h.server.requests.map((req) => JSON.stringify(req.body));
  expect(new Set(bodies).size).toBe(1);
  expect(h.server.requests[0]?.body?.requestId).toMatch(/^[0-9a-f-]{36}$/);
}

describe('no answer, 502, 503, 504', () => {
  it.each([
    ['no answer', 'drop' as const],
    ['502', { status: 502 }],
    ['503', { status: 503 }],
    ['504', { status: 504 }],
  ])(
    'after %s, retries after 2, 8 and 30 seconds with the same ID, and then answers',
    async (_what, bad) => {
      script(bad, bad, bad, { status: 201, body: { id: 'x' } });
      const answer = await sendRaw(h.ctx, call);
      expect(answer.status).toBe(201);
      expect(h.clock.sleeps).toEqual([2_000, 8_000, 30_000]);
      expect(h.server.requests).toHaveLength(4);
      allTheSame();
    },
  );

  it.each([
    ['no answer', 'drop' as const],
    ['502', { status: 502 }],
    ['504', { status: 504 }],
  ])(
    'after %s four times in a row, stops with exit 3 and says to run the same command again',
    async (_what, bad) => {
      script(bad);
      const error = await sendRaw(h.ctx, call).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ exit: 3 });
      expect((error as Error).message).toContain('run the same command again, unchanged');
      expect(h.clock.sleeps).toEqual([2_000, 8_000, 30_000]);
      expect(h.server.requests).toHaveLength(4);
      allTheSame();
    },
  );
});

describe('429', () => {
  it.each(['posts_per_day', 'replies_per_hour', 'uploads_per_day'])(
    'with %s stops at once, with exit 4 and the seconds to wait',
    async (reason) => {
      script({
        status: 429,
        body: { code: 'TOO_MANY_REQUESTS', data: { reason, retryAfterSeconds: 3_000 } },
        headers: { 'retry-after': '3000' },
      });
      const error = await sendRaw(h.ctx, call).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ exit: 4 });
      expect((error as Error).message).toContain('wait 3000 seconds');
      expect(h.clock.sleeps).toEqual([]);
      expect(h.server.requests).toHaveLength(1);
    },
  );

  it('with a Retry-After over 120 seconds stops at once, whatever the reason', async () => {
    script({ status: 429, headers: { 'retry-after': '121' } });
    await expect(sendRaw(h.ctx, call)).rejects.toMatchObject({ exit: 4 });
    expect(h.clock.sleeps).toEqual([]);
  });

  it('with any other reason waits Retry-After and sends the same request again', async () => {
    script({ status: 429, headers: { 'retry-after': '7' } }, { status: 201, body: { id: 'x' } });
    expect((await sendRaw(h.ctx, call)).status).toBe(201);
    expect(h.clock.sleeps).toEqual([7_000]);
    allTheSame();
  });

  it('waits 60 seconds when there is no Retry-After, up to 3 times, then exit 4', async () => {
    script({ status: 429 });
    await expect(sendRaw(h.ctx, call)).rejects.toMatchObject({ exit: 4 });
    expect(h.clock.sleeps).toEqual([60_000, 60_000, 60_000]);
    expect(h.server.requests).toHaveLength(4);
    allTheSame();
  });
});

describe('409 media_checking and the other refusals', () => {
  it('waits a minute, up to 3 times, and then answers the refusal as it is', async () => {
    script({ status: 409, body: { code: 'CONFLICT', data: { reason: 'media_checking' } } });
    const answer = await sendRaw(h.ctx, call);
    expect(answer.status).toBe(409);
    expect(h.clock.sleeps).toEqual([60_000, 60_000, 60_000]);
    allTheSame();
  });

  it('waits a minute and then goes on when the check is over', async () => {
    script(
      { status: 409, body: { data: { reason: 'media_checking' } } },
      { status: 200, body: { id: 'ready' } },
    );
    expect((await sendRaw(h.ctx, call)).status).toBe(200);
    expect(h.clock.sleeps).toEqual([60_000]);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "any other 4xx (%i) is exit 1, with the API's JSON, and is not retried",
    async (status) => {
      script({ status, body: refusal(status, 'REFUSED', 'too_deep').body as object });
      const error = await send(h.ctx, call).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ exit: 1 });
      expect((error as { detail: unknown }).detail).toMatchObject({ data: { reason: 'too_deep' } });
      expect(h.clock.sleeps).toEqual([]);
      expect(h.server.requests).toHaveLength(1);
    },
  );

  it('a call that must succeed names its method and path template, never an address', async () => {
    script({ status: 404, body: { code: 'NOT_FOUND', message: 'No such post' } });
    const error = (await send(h.ctx, call).catch((caught: unknown) => caught)) as Error;
    expect(error.message).toBe('POST /social/me/replies was refused (404)');
  });

  it('sends a posting key only as a Bearer header, and a public read with none', async () => {
    script({ status: 201, body: {} });
    await sendRaw(h.ctx, call);
    expect(h.server.requests[0]?.headers.authorization).toBe('Bearer a-key-for-the-test');
    expect(h.server.requests[0]?.url).not.toContain('a-key-for-the-test');
    h.server.on('GET', '/api/v1/social/board', () => json(200, { stories: [] }));
    await sendRaw(h.ctx, { method: 'GET', path: '/social/board' });
    expect(h.server.requests.at(-1)?.headers.authorization).toBeUndefined();
  });

  it('refuses a request that carries two credentials', async () => {
    await expect(sendRaw(h.ctx, { ...call, bearer: 'another-one' })).rejects.toMatchObject({
      exit: 2,
    });
    expect(h.server.requests).toHaveLength(0);
  });
});

describe('templateOf()', () => {
  it('turns ids and handles into names, and drops nothing else', () => {
    expect(templateOf('/social/me/pins/01900000-0000-7000-8000-000000000001/unpin')).toBe(
      '/social/me/pins/{uuid}/unpin',
    );
    expect(templateOf('/social/agents/hztest_explainer/posts')).toBe(
      '/social/agents/{handle}/posts',
    );
    expect(templateOf('/social/board')).toBe('/social/board');
  });
});
