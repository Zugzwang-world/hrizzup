import type { APIRequestContext, APIResponse, Route } from '@playwright/test';

/**
 * Requests that never put a secret in a failure (Round 6, R6): the journeys of social's agents send a posting
 * key as `Authorization: Bearer`, and their owner's and the admin's sessions as cookies. Playwright's request
 * context records every header it sends in the call log it puts in the message of any request that throws (the
 * network fails, a timeout, a disposed context), and the reporters print that message into a check's public
 * log. So a request here that throws is caught and thrown again as a new `TypeError` that names only the
 * method and the path: no header, no address with a query, no cause. A caller that sees a failure to get any
 * answer (the example agent's `fetch`) treats a `TypeError` as a network failure, as the standard `fetch` makes
 * it, so a write is sent again with the same request ID.
 *
 * Every journey's request goes through here (Round 6, R16, M5): `quiet(context)` and `quietRoute(route)` give a
 * request context's and a route's sending methods, with Playwright's own arguments and answers read as
 * Playwright's are, and `call`, `callWith` and `fetchThrough` serve the calls of the typed API. The guard
 * (e2e/quiet-requests.test.ts) fails on a send that doesn't, and the proof (support/quiet-request.proof.test.ts)
 * drives a real request context to show a failure names only its method and path.
 */

/** What a call of the typed API answers: its status, its body read as JSON (`{}` for none) and its headers. */
export type Answer = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

/** The path of an address, its host and its query dropped (an empty address is `/`). */
export function pathOf(address: string): string {
  try {
    return new URL(address, 'http://placeholder.invalid').pathname;
  } catch {
    return address.split('?')[0] ?? '';
  }
}

/** The error a request that threw becomes: the method and the path only (an address's query is dropped). */
export function noAnswer(method: string, address: string): TypeError {
  return new TypeError(`${method} ${pathOf(address)} got no answer`);
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

/** One call of the typed API over HTTP, with a key when given (never printed), as any client makes it. */
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

/** A call of a session's (its cookies are the context's), quiet when it throws; `books.ts` hands it on to the journeys that trade. */
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

/**
 * What `quiet(…)` answers: the reads of Playwright's own `APIResponse`, with the same signatures, so a journey
 * reads `answer.status()`, `await answer.json()` and `answer.headers().location` as it always did. It is a type
 * of its own, never an `APIResponse`, so the guard (e2e/quiet-requests.test.ts) tells a quiet call from a raw one
 * by type alone, and a quiet answer can't be handed to a matcher that prints Playwright's call log.
 */
export type QuietResponse = Pick<
  APIResponse,
  | 'url'
  | 'ok'
  | 'status'
  | 'statusText'
  | 'headers'
  | 'headersArray'
  | 'body'
  | 'text'
  | 'json'
  | 'dispose'
>;

type Sends = 'fetch' | 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head';

/** The seven sending methods of a request context, taking Playwright's own arguments, failing quietly. */
export type QuietRequest = {
  [M in Sends]: (...args: Parameters<APIRequestContext[M]>) => Promise<QuietResponse>;
};

/** A route's `fetch`, taking Playwright's own arguments, failing quietly. */
export type QuietRoute = { fetch: (...args: Parameters<Route['fetch']>) => Promise<QuietResponse> };

/**
 * A raw answer, read the quiet way. The raw answer lives only in this closure, never as a property: inspecting
 * it (`util.inspect`) would print its headers. Reading a body can fail too (a disposed context), so each read
 * goes through `quietly`; `json` parses the text as Playwright's own does and names the call, never the text.
 */
function quietResponse(method: string, address: string, response: APIResponse): QuietResponse {
  return {
    url: () => response.url(),
    ok: () => response.ok(),
    status: () => response.status(),
    statusText: () => response.statusText(),
    headers: () => response.headers(),
    headersArray: () => response.headersArray(),
    body: () => quietly(method, address, () => response.body()),
    text: () => quietly(method, address, () => response.text()),
    json: async () => {
      const text = await quietly(method, address, () => response.text());
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          `${method} ${pathOf(address)} answered ${response.status()} with something that is not JSON`,
        );
      }
    },
    dispose: () => quietly(method, address, () => response.dispose()),
  };
}

/** Sends one request through `send`, quietly, and gives back its answer, read the quiet way. */
async function answer(
  method: string,
  address: string,
  send: () => Promise<APIResponse>,
): Promise<QuietResponse> {
  const response = await quietly(method, address, send);
  return quietResponse(method, address, response);
}

/**
 * A request context whose requests fail quietly. Each method passes its caller's own arguments, unchanged, to the
 * same method of the context, so a journey changes one receiver (`request.get(…)` becomes `quiet(request).get(…)`)
 * and keeps reading the answer as before. The seven methods are written out one by one: the guard counts them.
 */
export function quiet(context: APIRequestContext): QuietRequest {
  return {
    fetch: (urlOrRequest, options) =>
      answer(
        (
          options?.method ?? (typeof urlOrRequest === 'string' ? 'GET' : urlOrRequest.method())
        ).toUpperCase(),
        typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url(),
        () => context.fetch(urlOrRequest, options),
      ),
    get: (url, options) => answer('GET', url, () => context.get(url, options)),
    post: (url, options) => answer('POST', url, () => context.post(url, options)),
    put: (url, options) => answer('PUT', url, () => context.put(url, options)),
    patch: (url, options) => answer('PATCH', url, () => context.patch(url, options)),
    delete: (url, options) => answer('DELETE', url, () => context.delete(url, options)),
    head: (url, options) => answer('HEAD', url, () => context.head(url, options)),
  };
}

/** A route's `fetch` (the request the browser made, sent on by the test) that fails quietly. */
export function quietRoute(route: Route): QuietRoute {
  return {
    fetch: (options) =>
      answer(
        (options?.method ?? route.request().method()).toUpperCase(),
        options?.url ?? route.request().url(),
        () => route.fetch(options),
      ),
  };
}
