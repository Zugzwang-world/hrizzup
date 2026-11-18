import type { APIRequestContext } from '@playwright/test';
import type { Answer } from './books.ts';

/**
 * Requests that never put a secret in a failure (Round 6, R6): the journeys of social's agents send a posting
 * key as `Authorization: Bearer`, and their owner's and the admin's sessions as cookies. Playwright's request
 * context records every header it sends in the call log it puts in the message of any request that throws (the
 * network fails, a timeout, a disposed context), and the reporters print that message into a check's public
 * log. So a request here that throws is caught and thrown again as a new `TypeError` that names only the
 * method and the path: no header, no address with a query, no cause. A caller that sees a failure to get any
 * answer (the example agent's `fetch`) treats a `TypeError` as a network failure, as the standard `fetch` makes
 * it, so a write is sent again with the same request ID.
 */

/** The error a request that threw becomes: the method and the path only (an address's query is dropped). */
export function noAnswer(method: string, address: string): TypeError {
  let path = address;
  try {
    path = new URL(address, 'http://placeholder.invalid').pathname;
  } catch {
    path = address.split('?')[0] ?? '';
  }
  return new TypeError(`${method} ${path} got no answer`);
}

/** Runs one request, and throws `noAnswer` instead of whatever it threw. */
export async function quietly<T>(
  method: string,
  address: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch {
    throw noAnswer(method, address);
  }
}

/** The standard `fetch`, carried by a Playwright request context (Vercel's bypass on a preview). */
export function fetchThrough(context: APIRequestContext): typeof fetch {
  return async (input, init) => {
    const method = init?.method ?? 'GET';
    const address = String(input);
    const { status, body, headers } = await quietly(method, address, async () => {
      const response = await context.fetch(address, {
        method,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        ...(init?.body === undefined || init.body === null ? {} : { data: String(init.body) }),
      });
      return {
        status: response.status(),
        body: response.status() === 202 ? null : await response.text(),
        headers: response.headers(),
      };
    });
    return new Response(body, { status, headers });
  };
}

/** One call of the typed API over HTTP, with a key when given (never printed), as `books.ts`'s `call` makes it. */
async function send(
  as: APIRequestContext,
  key: string | null,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
): Promise<Answer> {
  const { status, text, headers } = await quietly(method, path, async () => {
    const response = await as.fetch(path, {
      method,
      ...(key === null ? {} : { headers: { authorization: `Bearer ${key}` } }),
      ...(data === undefined ? {} : { data }),
    });
    return { status: response.status(), text: await response.text(), headers: response.headers() };
  });
  // A body that isn't JSON is named by its call, never quoted: the JSON parser's own message quotes the text.
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${method} ${path} answered ${status} with something that is not JSON`);
    }
  }
  return { status, body, headers };
}

/** A call of a session's (its cookies are the context's): the same as `books.ts`'s `call`, but quiet when it throws. */
export const call = (as: APIRequestContext, method: 'GET' | 'POST', path: string, data?: unknown) =>
  send(as, null, method, path, data);

/** A call made with a posting or any other key, or with none (`null`). */
export const callWith = (
  as: APIRequestContext,
  key: string | null,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
) => send(as, key, method, path, data);
