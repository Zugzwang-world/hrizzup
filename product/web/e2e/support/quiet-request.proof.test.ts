import { createServer, type RequestListener, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo, Socket } from 'node:net';
import { inspect } from 'node:util';
import { type APIRequestContext, type APIResponse, type Route, request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  call,
  callWith,
  fetchThrough,
  type QuietResponse,
  quiet,
  quietRoute,
} from './quiet-request.ts';

/**
 * The proof that a request in a journey never prints a header when it fails (Round 6, R16, M5: the founder's
 * done-test of 18 November 2026). It drives a real Playwright request context, no browser, against a port that
 * is closed, a server that never answers and servers that answer, with a made-up key and a made-up cookie that
 * the context sends on every request. It proves both halves: the raw error holds the values (so the danger is
 * real in this Playwright, and the day a Playwright upgrade stops writing headers into its call log this half
 * fails and whoever upgrades turns it around, never the quiet half), and the quiet error holds only the method
 * and the path. Whether an error tells a value is asked as a boolean only, so a failure here prints neither.
 */

const KEY = 'made-up-key-for-the-proof';
const COOKIE = 'made-up-cookie-for-the-proof';

/** What an error says of the values, over everything a reporter or a log could print from it. */
function tells(error: unknown): { key: boolean; cookie: boolean } {
  const e = error as { message?: string; stack?: string; cause?: unknown; log?: unknown };
  const text = [
    e.message,
    e.stack,
    String(error),
    String(e.cause),
    inspect(error, { showHidden: true, depth: null }),
    JSON.stringify(e.log ?? null),
  ].join('\n');
  return { key: text.includes(KEY), cookie: text.includes(COOKIE) };
}

const TELLS_NOTHING = { key: false, cookie: false };
const TELLS_BOTH = { key: true, cookie: true };

/** What a thrown value is, or a failure of the test itself when nothing was thrown. */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('The request did not throw');
}

// The same `child_process` object Playwright's bundle reads when it starts a browser (`execSync` is left out:
// on a Mac Playwright runs `sw_vers` to build its user agent). Spied before any context is made, and the calls
// go through: a spy that stood in would hide a browser that started.
const childProcess = createRequire(import.meta.url)(
  'node:child_process',
) as typeof import('node:child_process');
const spies = (['spawn', 'fork', 'execFile'] as const).map((name) => vi.spyOn(childProcess, name));

const servers: Server[] = [];
const sockets = new Set<Socket>();
const contexts: APIRequestContext[] = [];

function serve(handler: RequestListener): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });
}

/** An address on this machine where nothing listens: a port that was just opened and closed. */
async function closedAddress(): Promise<string> {
  const address = await serve(() => {});
  const server = servers.pop();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  return address;
}

/** A request context that carries the made-up key and cookie on every request, as a journey's contexts do. */
async function contextFor(baseURL: string): Promise<APIRequestContext> {
  const context = await request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${KEY}` },
    storageState: {
      cookies: [
        {
          name: 'session',
          value: COOKIE,
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  });
  contexts.push(context);
  return context;
}

/** One server for the answers: JSON, a refusal as HTML that quotes the key, a redirect, and an echo of what it got. */
const received: {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}[] = [];

const answers: RequestListener = (req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const path = (req.url ?? '').split('?')[0];
    const body = Buffer.concat(chunks).toString('utf8');
    received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    if (path === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, list: [1, 2, 3] }));
    } else if (path === '/html') {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end(`<html><body>Bad gateway for ${KEY}</body></html>`);
    } else if (path === '/redirect') {
      res.writeHead(303, { location: '/landed', 'set-cookie': 'seen=made-up; Path=/' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        }),
      );
    }
  });
};

let closed: APIRequestContext;
let closedBase: string;
let answering: APIRequestContext;
let answeringBase: string;
let waiting: APIRequestContext;

beforeAll(async () => {
  answeringBase = await serve(answers);
  answering = await contextFor(answeringBase);
  // Accepts the connection and never answers.
  waiting = await contextFor(await serve(() => {}));
  // Last, and no server is started after it (a test that needs one more uses `answeringBase`): a port that was
  // just freed can't be handed to another server, which would answer where the proof means nothing to.
  closedBase = await closedAddress();
  closed = await contextFor(closedBase);
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.dispose()));
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("a request's failure in Playwright, raw and quiet", () => {
  it('raw: a closed port gives an error that tells the key and the cookie, so the danger is real in this Playwright', async () => {
    const error = await failure(() => closed.get('/api/v1/x?made=up'));
    expect(tells(error)).toEqual(TELLS_BOTH);
  });

  const methods = [
    ['fetch', 'GET'],
    ['get', 'GET'],
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['delete', 'DELETE'],
    ['head', 'HEAD'],
  ] as const;

  for (const [name, method] of methods) {
    it(`quiet: ${name} on a closed port gives a TypeError naming only ${method} and the path`, async () => {
      const error = await failure(() => quiet(closed)[name]('/api/v1/x?made=up'));
      // First, so a leak fails on booleans and prints neither value.
      expect(tells(error)).toEqual(TELLS_NOTHING);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe(`${method} /api/v1/x got no answer`);
      expect(error.cause).toBeUndefined();
      expect('log' in error).toBe(false);
    });
  }

  it('quiet: fetch takes its method from its options, in capitals, and an address given in full is cut to its path', async () => {
    const error = await failure(() =>
      quiet(closed).fetch(`${closedBase}/auth/v1/verify?token=made-up-token`, {
        method: 'post',
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(tells(error)).toEqual(TELLS_NOTHING);
    expect(error.message).toBe('POST /auth/v1/verify got no answer');
    const empty = await failure(() => quiet(closed).get(''));
    expect(tells(empty)).toEqual(TELLS_NOTHING);
    expect(empty.message).toBe('GET / got no answer');
  });

  it("quiet: the call helpers (a session's call, a call with a key, the standard fetch) fail the same way", async () => {
    const sessions = await failure(() => call(closed, 'GET', '/api/v1/x?made=up'));
    const keyed = await failure(() => callWith(closed, KEY, 'POST', '/api/v1/x?made=up', {}));
    const standard = await failure(() =>
      fetchThrough(closed)('/api/v1/x?made=up', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${KEY}` },
        body: '{}',
      }),
    );
    for (const [error, message] of [
      [sessions, 'GET /api/v1/x got no answer'],
      [keyed, 'POST /api/v1/x got no answer'],
      [standard, 'PATCH /api/v1/x got no answer'],
    ] as const) {
      expect(tells(error)).toEqual(TELLS_NOTHING);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe(message);
      expect(error.cause).toBeUndefined();
      expect('log' in error).toBe(false);
    }
  });

  it('a request cut off by its timeout: raw tells the key and the cookie, quiet tells neither', async () => {
    const raw = await failure(() => waiting.get('/never?made=up', { timeout: 300 }));
    expect(tells(raw)).toEqual(TELLS_BOTH);
    const quiet300 = await failure(() => quiet(waiting).get('/never?made=up', { timeout: 300 }));
    expect(tells(quiet300)).toEqual(TELLS_NOTHING);
    expect(quiet300).toBeInstanceOf(TypeError);
    expect(quiet300.message).toBe('GET /never got no answer');
  });

  it('reading an answer once its context is gone says which call it was, and tells nothing', async () => {
    const own = await contextFor(answeringBase);
    const answer = await quiet(own).get('/json');
    expect(answer.status()).toBe(200);
    await own.dispose();
    for (const read of [() => answer.text(), () => answer.body(), () => answer.json()]) {
      const error = await failure(read);
      expect(tells(error)).toEqual(TELLS_NOTHING);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe('GET /json got no answer');
    }
  });

  it('an answer that is not JSON: json() names the call and what it answered, never the text, and text() still gives it', async () => {
    const answer = await quiet(answering).get('/html');
    expect(answer.status()).toBe(502);
    const error = await failure(() => answer.json());
    expect(tells(error)).toEqual(TELLS_NOTHING);
    expect(error.message).toBe('GET /html answered 502 with something that is not JSON');
    expect((await answer.text()).includes(KEY)).toBe(true);
  });

  it('inspecting a quiet context or a quiet answer prints neither value', async () => {
    const answer = await quiet(answering).get('/echo');
    for (const subject of [quiet(answering), answer]) {
      const text = inspect(subject, { showHidden: true, depth: null });
      expect(text.includes(KEY)).toBe(false);
      expect(text.includes(COOKIE)).toBe(false);
      expect(text.toLowerCase().includes('authorization')).toBe(false);
    }
  });
});

describe('what a quiet request sends and reads is what a raw one does', () => {
  it('maxRedirects: 0 gives the 303 and its location, as the raw call does', async () => {
    const raw = await answering.get('/redirect', { maxRedirects: 0 });
    const quietly = await quiet(answering).get('/redirect', { maxRedirects: 0 });
    expect(quietly.status()).toBe(303);
    expect(quietly.status()).toBe(raw.status());
    expect(quietly.headers().location).toBe('/landed');
    expect(quietly.headers().location).toBe(raw.headers().location);
  });

  type Options = NonNullable<Parameters<APIRequestContext['get']>[1]>;
  type Sender = (
    context: APIRequestContext,
    path: string,
    options: Options,
  ) => Promise<QuietResponse>;

  /** Each of the seven methods, sent raw and through quiet(); `fetch` names its own method (the server must see it). */
  const SEVEN: { name: string; method: string; body: boolean; raw: Sender; quieted: Sender }[] = [
    {
      name: 'fetch',
      method: 'OPTIONS',
      body: true,
      raw: (c, path, o) => c.fetch(path, { ...o, method: 'OPTIONS' }),
      quieted: (c, path, o) => quiet(c).fetch(path, { ...o, method: 'OPTIONS' }),
    },
    {
      name: 'get',
      method: 'GET',
      body: false,
      raw: (c, path, o) => c.get(path, o),
      quieted: (c, path, o) => quiet(c).get(path, o),
    },
    {
      name: 'post',
      method: 'POST',
      body: true,
      raw: (c, path, o) => c.post(path, o),
      quieted: (c, path, o) => quiet(c).post(path, o),
    },
    {
      name: 'put',
      method: 'PUT',
      body: true,
      raw: (c, path, o) => c.put(path, o),
      quieted: (c, path, o) => quiet(c).put(path, o),
    },
    {
      name: 'patch',
      method: 'PATCH',
      body: true,
      raw: (c, path, o) => c.patch(path, o),
      quieted: (c, path, o) => quiet(c).patch(path, o),
    },
    {
      name: 'delete',
      method: 'DELETE',
      body: true,
      raw: (c, path, o) => c.delete(path, o),
      quieted: (c, path, o) => quiet(c).delete(path, o),
    },
    {
      name: 'head',
      method: 'HEAD',
      body: false,
      raw: (c, path, o) => c.head(path, o),
      quieted: (c, path, o) => quiet(c).head(path, o),
    },
  ];

  for (const { name, method, body, raw, quieted } of SEVEN) {
    it(`${name} sends ${method}, a body and the headers a browser sets as the raw call does, and reads the same`, async () => {
      const path = `/echo/${name}?a=1`;
      const options: Options = {
        headers: {
          origin: 'https://made-up.invalid',
          'sec-fetch-site': 'cross-site',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        // A "{" that is not JSON, with a JSON content type: handed to Playwright as given.
        ...(body ? { data: '{' } : {}),
      };
      const before = received.length;
      const direct = await raw(answering, path, options);
      const through = await quieted(answering, path, options);
      const saw = received.slice(before);
      expect(saw.length, 'the server got each request once').toBe(2);
      const [sawDirect, sawThrough] = saw;
      // The server's own record: the method it was sent, and byte for byte what the raw call sent.
      expect(sawDirect?.method).toBe(method);
      expect(sawThrough?.method).toBe(method);
      expect(sawThrough?.body).toBe(sawDirect?.body);
      expect(sawThrough?.headers).toEqual(sawDirect?.headers);
      expect(sawThrough?.headers.origin).toBe('https://made-up.invalid');
      expect(sawThrough?.headers['sec-fetch-site']).toBe('cross-site');
      // What it reads back is the raw answer's.
      expect(through.status()).toBe(direct.status());
      expect(through.statusText()).toBe(direct.statusText());
      expect(through.ok()).toBe(direct.ok());
      expect(through.url()).toBe(direct.url());
      expect(through.headersArray().length).toBe(direct.headersArray().length);
      const { date: _directDate, ...directHeaders } = direct.headers();
      const { date: _throughDate, ...throughHeaders } = through.headers();
      expect(throughHeaders).toEqual(directHeaders);
      expect(await through.text()).toBe(await direct.text());
      expect((await through.body()).equals(await direct.body())).toBe(true);
      // (A HEAD answer has no body to read as JSON.)
      if (method !== 'HEAD') expect(await through.json()).toEqual(await direct.json());
    });
  }

  it('each method passes its arguments on to the context unchanged: the same address and the very same options object', async () => {
    const response = { status: () => 200 } as unknown as APIResponse;
    const calls: { name: string; args: unknown[] }[] = [];
    const record =
      (name: string) =>
      async (...args: unknown[]) => {
        calls.push({ name, args });
        return response;
      };
    const stand = {
      fetch: record('fetch'),
      get: record('get'),
      post: record('post'),
      put: record('put'),
      patch: record('patch'),
      delete: record('delete'),
      head: record('head'),
    } as unknown as APIRequestContext;
    const through = quiet(stand);
    for (const name of ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'] as const) {
      const options = { data: { a: 1 }, headers: { 'x-made-up': 'yes' } };
      const answer = await through[name]('/x', options);
      expect(calls.at(-1)?.name).toBe(name);
      expect(calls.at(-1)?.args[0]).toBe('/x');
      expect(calls.at(-1)?.args[1]).toBe(options);
      expect(answer.status()).toBe(200);
    }
    expect(calls.length).toBe(7);
  });
});

describe("a route's fetch, with a stand-in route (a real one needs a browser)", () => {
  const ADDRESS = 'https://x.test/auth/google?next=made-up';
  const failing = (method: string) => {
    const fetch = vi.fn(async (..._args: unknown[]) => {
      throw new Error(
        `route.fetch: socket hang up\nCall log:\n  - → ${method} ${ADDRESS}\n  - authorization: Bearer ${KEY}\n  - cookie: session=${COOKIE}`,
      );
    });
    const route = { request: () => ({ method: () => method, url: () => ADDRESS }), fetch };
    return { route: route as unknown as Route, fetch };
  };

  it('fails naming only the method and the path, and passes the options on unchanged', async () => {
    const { route, fetch } = failing('GET');
    const options = { maxRedirects: 0 };
    const error = await failure(() => quietRoute(route).fetch(options));
    expect(tells(error)).toEqual(TELLS_NOTHING);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('GET /auth/google got no answer');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(options);
  });

  it("takes the method from the options when they name one, and the request's own otherwise", async () => {
    const posted = await failure(() => quietRoute(failing('GET').route).fetch({ method: 'post' }));
    const own = await failure(() => quietRoute(failing('PUT').route).fetch());
    const elsewhere = await failure(() =>
      quietRoute(failing('GET').route).fetch({ url: 'https://y.test/auth/other?made=up' }),
    );
    for (const error of [posted, own, elsewhere]) expect(tells(error)).toEqual(TELLS_NOTHING);
    expect(posted.message).toBe('POST /auth/google got no answer');
    expect(own.message).toBe('PUT /auth/google got no answer');
    expect(elsewhere.message).toBe('GET /auth/other got no answer');
  });
});

describe('no browser', () => {
  it('no process was started by any of this: no spawn, no fork, no execFile', () => {
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
