import type { APIRequestContext, APIResponse } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { answerOf, consoleCall, jsonOf } from './social-calls.ts';

/**
 * R5's journeys' requests (social-calls.ts): one that throws names only its method and path, never a header. Playwright's
 * request context puts every header it sent (a session's cookies, a key) in the message of a request that throws, and
 * the reporters print it into a check's public log, so the message here is the whole error: no cause, no query.
 */

const SECRET = 'sb-access-token=SECRET-COOKIE-VALUE; authorization: Bearer hz_demo_SECRETKEYTEXT';
const leak = () =>
  new Error(
    `apiRequestContext.fetch: socket hang up\nCall log:\n  - sending request\n  - Cookie: ${SECRET}`,
  );

/** A request context whose `fetch` throws what Playwright throws, carrying the headers it sent. */
const failing = { fetch: async () => Promise.reject(leak()) } as unknown as APIRequestContext;

/** A response whose body can't be read (the context was disposed mid-answer). */
const unreadable = {
  status: () => 200,
  headers: () => ({}),
  text: async () => Promise.reject(leak()),
} as unknown as APIResponse;

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('It did not throw');
}

describe('a request of R5’s journeys that throws', () => {
  it('names only its method and path, whatever the context’s error held', async () => {
    const error = await thrownBy(() =>
      consoleCall(failing, 'POST', '/api/v1/admin/social/invites', { email: 'a@b.test' }),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('POST /api/v1/admin/social/invites got no answer');
    expect((error as Error).cause).toBeUndefined();
    expect(String((error as Error).stack)).not.toContain('SECRET');
  });

  it('drops the query of the address, which may hold a cursor', async () => {
    const error = await thrownBy(() =>
      consoleCall(failing, 'GET', '/api/v1/admin/social/invites?cursor=SECRETCURSOR&limit=5'),
    );
    expect((error as Error).message).toBe('GET /api/v1/admin/social/invites got no answer');
  });

  it('is the same when the answer’s body can’t be read', async () => {
    const error = await thrownBy(() =>
      answerOf('GET', '/api/v1/social/stories/x', async () => unreadable),
    );
    expect((error as Error).message).toBe('GET /api/v1/social/stories/x got no answer');
    expect(JSON.stringify(error)).not.toContain('SECRET');
  });

  it('is not a failure when the call answers: the status, the text, the cache header and the steady headers', async () => {
    const answered = {
      fetch: async () => ({
        status: () => 409,
        text: async () => '{"code":"CONFLICT"}',
        headers: () => ({ 'cache-control': 'private, no-store', date: 'now', etag: 'a' }),
      }),
    } as unknown as APIRequestContext;
    const answer = await consoleCall(answered, 'POST', '/api/v1/x', {});
    expect(answer).toEqual({
      status: 409,
      text: '{"code":"CONFLICT"}',
      body: { code: 'CONFLICT' },
      caching: 'private, no-store',
      headers: { 'cache-control': 'private, no-store', etag: 'a' },
    });
  });

  it('reads a body that is not an object as empty', () => {
    expect(jsonOf('<html>')).toEqual({});
    expect(jsonOf('[1]')).toEqual({});
    expect(jsonOf('null')).toEqual({});
    expect(jsonOf('{"a":1}')).toEqual({ a: 1 });
  });
});
