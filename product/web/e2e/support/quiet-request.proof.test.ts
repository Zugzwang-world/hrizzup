import { createServer, type RequestListener, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo, Socket } from 'node:net';
import { inspect } from 'node:util';
import { type APIRequestContext, type Route, request } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { call, callWith, fetchThrough, quiet, quietRoute } from './quiet-request.ts';

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
const answers: RequestListener = (req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const path = (req.url ?? '').split('?')[0];
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
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    }
  });
};

let closed: APIRequestContext;
let answering: APIRequestContext;
let waiting: APIRequestContext;

beforeAll(async () => {
  closed = await contextFor(await closedAddress());
  answering = await contextFor(await serve(answers));
  // Accepts the connection and never answers.
  waiting = await contextFor(await serve(() => {}));
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
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe(`${method} /api/v1/x got no answer`);
      expect(error.cause).toBeUndefined();
      expect('log' in error).toBe(false);
      expect(tells(error)).toEqual(TELLS_NOTHING);
    });
  }

  it('quiet: fetch takes its method from its options, in capitals, and an address given in full is cut to its path', async () => {
    const error = await failure(() =>
      quiet(closed).fetch('https://made-up.invalid/auth/v1/verify?token=made-up-token', {
        method: 'post',
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(error.message).toBe('POST /auth/v1/verify got no answer');
    expect(tells(error)).toEqual(TELLS_NOTHING);
    const empty = await failure(() => quiet(closed).get(''));
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
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe(message);
      expect(error.cause).toBeUndefined();
      expect('log' in error).toBe(false);
      expect(tells(error)).toEqual(TELLS_NOTHING);
    }
  });

  it('a request cut off by its timeout: raw tells the key and the cookie, quiet tells neither', async () => {
    const raw = await failure(() => waiting.get('/never?made=up', { timeout: 300 }));
    expect(tells(raw)).toEqual(TELLS_BOTH);
    const quiet300 = await failure(() => quiet(waiting).get('/never?made=up', { timeout: 300 }));
    expect(quiet300).toBeInstanceOf(TypeError);
    expect(quiet300.message).toBe('GET /never got no answer');
    expect(tells(quiet300)).toEqual(TELLS_NOTHING);
  });

  it('reading an answer once its context is gone says which call it was, and tells nothing', async () => {
    const own = await contextFor(await serve(answers));
    const answer = await quiet(own).get('/json');
    expect(answer.status()).toBe(200);
    await own.dispose();
    for (const read of [() => answer.text(), () => answer.body(), () => answer.json()]) {
      const error = await failure(read);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe('GET /json got no answer');
      expect(tells(error)).toEqual(TELLS_NOTHING);
    }
  });

  it('an answer that is not JSON: json() names the call and what it answered, never the text, and text() still gives it', async () => {
    const answer = await quiet(answering).get('/html');
    expect(answer.status()).toBe(502);
    const error = await failure(() => answer.json());
    expect(error.message).toBe('GET /html answered 502 with something that is not JSON');
    expect(tells(error)).toEqual(TELLS_NOTHING);
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

  it('a body of "{" with a JSON content type reaches the server byte for byte as the raw call sends it, and the headers a browser sets are kept', async () => {
    const options = {
      data: '{',
      headers: {
        'content-type': 'application/json',
        origin: 'https://made-up.invalid',
        'sec-fetch-site': 'cross-site',
      },
    };
    const raw = await answering.post('/echo', options);
    const quietly = await quiet(answering).post('/echo', options);
    const rawSaw = (await raw.json()) as { body: string; headers: Record<string, string> };
    const quietSaw = (await quietly.json()) as { body: string; headers: Record<string, string> };
    expect(quietSaw.body).toBe(rawSaw.body);
    expect(quietSaw.headers.origin).toBe('https://made-up.invalid');
    expect(quietSaw.headers['sec-fetch-site']).toBe('cross-site');
    expect(quietSaw.headers['content-type']).toBe(rawSaw.headers['content-type']);
    expect(quietSaw.headers['content-length']).toBe(rawSaw.headers['content-length']);
  });

  it('text() equals the raw text() byte for byte, json() the raw json(), and headers() the raw headers (date aside)', async () => {
    for (const path of ['/json', '/echo?a=1']) {
      const raw = await answering.get(path);
      const quietly = await quiet(answering).get(path);
      expect(await quietly.text()).toBe(await raw.text());
      expect(await quietly.json()).toEqual(await raw.json());
      expect((await quietly.body()).equals(await raw.body())).toBe(true);
      const { date: _rawDate, ...rawHeaders } = raw.headers();
      const { date: _quietDate, ...quietHeaders } = quietly.headers();
      expect(quietHeaders).toEqual(rawHeaders);
      expect(quietly.headersArray().length).toBe(raw.headersArray().length);
      expect(quietly.url()).toBe(raw.url());
      expect(quietly.ok()).toBe(raw.ok());
      expect(quietly.statusText()).toBe(raw.statusText());
    }
  });

  it('a quiet request sends what it was given, and the options object reaches the context unchanged', async () => {
    const options = { data: { a: 1 }, headers: { 'x-made-up': 'yes' } };
    const seen: unknown[] = [];
    const stand = {
      post: async (...args: unknown[]) => {
        seen.push(...args);
        return await answering.post('/echo', options);
      },
    } as unknown as APIRequestContext;
    const answer = await quiet(stand).post('/echo', options);
    expect(seen[0]).toBe('/echo');
    expect(seen[1]).toBe(options);
    expect(answer.status()).toBe(200);
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
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('GET /auth/google got no answer');
    expect(tells(error)).toEqual(TELLS_NOTHING);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(options);
  });

  it("takes the method from the options when they name one, and the request's own otherwise", async () => {
    const posted = await failure(() => quietRoute(failing('GET').route).fetch({ method: 'post' }));
    expect(posted.message).toBe('POST /auth/google got no answer');
    const own = await failure(() => quietRoute(failing('PUT').route).fetch());
    expect(own.message).toBe('PUT /auth/google got no answer');
    const elsewhere = await failure(() =>
      quietRoute(failing('GET').route).fetch({ url: 'https://y.test/auth/other?made=up' }),
    );
    expect(elsewhere.message).toBe('GET /auth/other got no answer');
  });
});

describe('no browser', () => {
  it('no process was started by any of this: no spawn, no fork, no execFile', () => {
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
