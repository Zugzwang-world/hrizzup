import { emptyProfile } from '@hrizzup/social/reading-profile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readerAi, stubProvider } from './index.ts';
import { buildPrompt } from './prompt.ts';
import { TIMEOUT_MS } from './workers-ai.ts';

/** Nothing here reaches Cloudflare: every request goes to a stand-in `fetch`, and a test that sets none fails if one is made. */
const FAKE_TOKEN = 'test-token-not-a-real-one';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const MODEL = '@cf/meta/llama-3.2-3b-instruct';
const env = { WORKERS_AI_TOKEN: FAKE_TOKEN, WORKERS_AI_ACCOUNT_ID: ACCOUNT };
const settings = { provider: 'workers-ai', model: MODEL };
const message = 'More cricket, no crypto';
const prompt = buildPrompt({ profile: emptyProfile(), history: [], message, maxInputTokens: 2000 });
const request = { prompt, maxOutputTokens: 300, message, profile: emptyProfile() };

const mustNotFetch = vi.fn(async () => {
  throw new Error('the network must not be reached');
});
// The global `fetch` is a stand-in that throws, so no test here can reach Cloudflare, whatever it forgets to pass.
beforeEach(() => {
  mustNotFetch.mockClear();
  vi.stubGlobal('fetch', mustNotFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const envelope = (result: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ success: true, errors: [], messages: [], result, ...extra });
const answering = (body: string, status = 200) =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => new Response(body, { status }),
  );
const ours = {
  reply: 'Done: more cricket, less crypto.',
  edits: [
    { op: 'add', list: 'more', item: 'cricket' },
    { op: 'add', list: 'less', item: 'crypto' },
  ],
};
const lines = () => {
  const seen: string[] = [];
  return { seen, log: (line: string) => seen.push(line) };
};

describe('which provider answers', () => {
  it('is the stand-in whenever the token or the account ID is missing or empty', () => {
    for (const held of [
      {},
      { WORKERS_AI_TOKEN: FAKE_TOKEN },
      { WORKERS_AI_ACCOUNT_ID: ACCOUNT },
      { WORKERS_AI_TOKEN: '', WORKERS_AI_ACCOUNT_ID: ACCOUNT },
      { WORKERS_AI_TOKEN: FAKE_TOKEN, WORKERS_AI_ACCOUNT_ID: '' },
      { WORKERS_AI_TOKEN: '   ', WORKERS_AI_ACCOUNT_ID: ACCOUNT },
    ]) {
      expect(readerAi(held, settings, { fetcher: mustNotFetch as unknown as typeof fetch })).toBe(
        stubProvider,
      );
    }
    // The stand-in is chosen before the provider name is looked at: no token, no call, whatever the setting says.
    expect(readerAi({}, { provider: 'nonsense', model: 'nope' })).toBe(stubProvider);
    expect(mustNotFetch).not.toHaveBeenCalled();
  });

  it('is Workers AI with both set, and a provider that fails before any request for a name the code will not send', async () => {
    expect(readerAi(env, settings).name).toBe('workers-ai');
    for (const [ai, why] of [
      [{ provider: 'openai', model: MODEL }, 'unknown provider "openai"'],
      [{ provider: 'workers-ai', model: 'llama' }, 'a model name the code will not send'],
      [{ provider: 'workers-ai', model: '@cf/meta/../x/y' }, 'a model name the code will not send'],
      [{ provider: 'workers-ai', model: '@cf/../x' }, 'a model name the code will not send'],
      [{ provider: 'workers-ai', model: '@cf/./x' }, 'a model name the code will not send'],
      [{ provider: 'workers-ai', model: '@cf/meta/..' }, 'a model name the code will not send'],
      [{ provider: 'workers-ai', model: '@hf/.hidden/x' }, 'a model name the code will not send'],
      [{ provider: 'workers-ai', model: `${MODEL}?x=1` }, 'a model name the code will not send'],
      [
        { provider: 'workers-ai', model: '@cf/meta/llama/extra' },
        'a model name the code will not send',
      ],
      [{ provider: 'workers-ai', model: '' }, 'a model name the code will not send'],
    ] as const) {
      const { seen, log } = lines();
      const provider = readerAi(env, ai, { fetcher: mustNotFetch as unknown as typeof fetch, log });
      const result = await provider.run(request);
      expect(result, why).toMatchObject({
        ok: false,
        failure: { kind: 'released', reason: 'unavailable' },
      });
      expect(JSON.parse(seen[0] ?? '{}').note, why).toBe(why);
    }
    const { log } = lines();
    const malformed = readerAi(
      { WORKERS_AI_TOKEN: FAKE_TOKEN, WORKERS_AI_ACCOUNT_ID: '../evil' },
      settings,
      { fetcher: mustNotFetch as unknown as typeof fetch, log },
    );
    expect(await malformed.run(request)).toMatchObject({
      ok: false,
      failure: { kind: 'released' },
    });
    expect(mustNotFetch).not.toHaveBeenCalled();
  });

  it('makes a provider name safe to log', async () => {
    const { seen, log } = lines();
    await readerAi(env, { provider: 'Bad Name\n"x"', model: MODEL }, { log }).run(request);
    expect(seen[0]).not.toContain('\n');
    expect(JSON.parse(seen[0] ?? '{}').note).toBe('unknown provider "bad?name??x?"');
  });
});

describe('the call to Workers AI', () => {
  it('posts the prompt to the model address, with the token, no JSON mode and no stored copy, once', async () => {
    const fetcher = answering(
      envelope({ response: ours, usage: { prompt_tokens: 600, completion_tokens: 85 } }),
    );
    const { log } = lines();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const result = await readerAi(env, settings, { fetcher, log }).run(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // The limit is 20 seconds, and the signal the request carries is made from it.
    expect(TIMEOUT_MS).toBe(20_000);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20_000);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/meta/llama-3.2-3b-instruct`,
    );
    expect(typeof url).toBe('string');
    expect(init?.method).toBe('POST');
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${FAKE_TOKEN}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ messages: prompt.messages, max_tokens: 300, temperature: 0.2 });
    expect(body).not.toHaveProperty('response_format');
    expect(result).toEqual({
      ok: true,
      answer: {
        provider: 'workers-ai',
        usage: { promptTokens: 600, completionTokens: 85 },
        form: 'json',
        reply: 'Done: more cricket, less crypto.',
        edits: ours.edits,
      },
    });
  });

  it('answers with the usage missing as null (the call settles at its reservation) and a string response as read', async () => {
    const result = await readerAi(env, settings, {
      fetcher: answering(envelope({ response: `\`\`\`json\n${JSON.stringify(ours)}\n\`\`\`` })),
      log: () => {},
    }).run(request);
    expect(result).toMatchObject({ ok: true, answer: { usage: null, form: 'json' } });
  });

  it('logs one line a call, with no text and no user: the outcome, status, code, token counts, form and time', async () => {
    const { seen, log } = lines();
    await readerAi(env, settings, {
      fetcher: answering(
        envelope({ response: ours, usage: { prompt_tokens: 600, completion_tokens: 85 } }),
      ),
      log,
    }).run(request);
    expect(seen).toHaveLength(1);
    const line = JSON.parse(seen[0] ?? '{}');
    expect(line).toMatchObject({
      event: 'reader_ai',
      provider: 'workers-ai',
      outcome: 'answered',
      status: 200,
      promptTokens: 600,
      completionTokens: 85,
      form: 'json',
    });
    expect(line.ms).toBeTypeOf('number');
    for (const secret of [FAKE_TOKEN, ACCOUNT, 'cricket', 'crypto', message]) {
      expect(seen[0], secret).not.toContain(secret);
    }
  });

  it('classifies a refusal by its error code and status, and logs the code without any text', async () => {
    const cases: [number, number | null, string, string][] = [
      [429, 3036, 'exhausted', 'allowance_used'],
      [429, 3040, 'released', 'busy'],
      [429, null, 'released', 'busy'],
      [403, 5016, 'released', 'unavailable'],
      [401, null, 'released', 'unavailable'],
      [400, 8001, 'released', 'unavailable'],
      [408, 3007, 'kept', 'too_slow'],
      [408, null, 'kept', 'too_slow'],
      [500, null, 'kept', 'unavailable'],
      [503, 3050, 'kept', 'unavailable'],
    ];
    for (const [status, code, kind, reason] of cases) {
      const { seen, log } = lines();
      const body = JSON.stringify({
        success: false,
        result: null,
        errors: code === null ? [] : [{ code, message: 'something in Cloudflare words' }],
        messages: [],
      });
      const result = await readerAi(env, settings, { fetcher: answering(body, status), log }).run(
        request,
      );
      expect(result, `${status} ${code}`).toMatchObject({
        ok: false,
        failure: { kind, reason, status, code },
      });
      expect(JSON.parse(seen[0] ?? '{}')).toMatchObject({ outcome: kind, status, code });
      expect(seen[0]).not.toContain('Cloudflare words');
    }
  });

  it('classifies a refusal whose body is not JSON by its status alone', async () => {
    const result = await readerAi(env, settings, {
      fetcher: answering('<html>bad gateway</html>', 502),
      log: () => {},
    }).run(request);
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'kept', reason: 'unavailable', status: 502 },
    });
  });

  it('keeps the call when the network fails, our limit ends it, or the body never arrives after a 200', async () => {
    const network = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(
      await readerAi(env, settings, {
        fetcher: network as unknown as typeof fetch,
        log: () => {},
      }).run(request),
    ).toMatchObject({ ok: false, failure: { kind: 'kept', reason: 'unavailable' } });
    expect(network).toHaveBeenCalledTimes(1);

    const slow = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const timedOut = await readerAi(env, settings, {
      fetcher: slow,
      timeoutMs: 20,
      log: () => {},
    }).run(request);
    expect(timedOut).toMatchObject({ ok: false, failure: { kind: 'kept', reason: 'too_slow' } });
    expect(slow).toHaveBeenCalledTimes(1);

    const torn = vi.fn(
      async () =>
        ({
          status: 200,
          text: async () => {
            throw new Error('connection reset');
          },
        }) as unknown as Response,
    );
    expect(
      await readerAi(env, settings, {
        fetcher: torn as unknown as typeof fetch,
        log: () => {},
      }).run(request),
    ).toMatchObject({ ok: false, failure: { kind: 'kept', reason: 'unavailable' } });
  });

  it('keeps the call when a 200 holds no envelope it can read', async () => {
    for (const body of [
      'not json',
      '[]',
      '"text"',
      JSON.stringify({ success: true }),
      JSON.stringify({ success: true, result: 'x' }),
    ]) {
      const result = await readerAi(env, settings, { fetcher: answering(body), log: () => {} }).run(
        request,
      );
      expect(result, body).toMatchObject({
        ok: false,
        failure: { kind: 'kept', reason: 'unavailable', status: 200 },
      });
    }
    // success: false on a 200 is classified by its code.
    const spent = JSON.stringify({ success: false, errors: [{ code: 3036 }], result: null });
    expect(
      await readerAi(env, settings, { fetcher: answering(spent), log: () => {} }).run(request),
    ).toMatchObject({ ok: false, failure: { kind: 'exhausted' } });
  });

  it('answers text that is not our JSON as an answered call, with the text kept', async () => {
    const result = await readerAi(env, settings, {
      fetcher: answering(
        envelope({
          response: 'I added cricket for you.',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      ),
      log: () => {},
    }).run(request);
    expect(result).toMatchObject({
      ok: true,
      answer: { form: 'text', reply: 'I added cricket for you.', edits: [] },
    });
  });
});
