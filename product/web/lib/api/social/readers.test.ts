import { DEFAULT_PAGE, social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { CURSOR_MESSAGE, decodeCursor, encodeCursor } from '@hrizzup/social/cursor';
import { buildId } from '@hrizzup/social/for-you';
import {
  EMPTY_PROFILE,
  isCanonical,
  parseProfile,
  passesCodeChecks,
  writeProfile,
} from '@hrizzup/social/reading-profile';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reader agent's four live calls (lib/api/social/readers.ts; docs/social/r12-design.md, section 3.8): the
 * reader's state, the save of their profile, the chat's list and a message to the agent. Who is signed in is
 * stood in for, and so are Redis (a map that records every command) and Cloudflare (the global `fetch`, which
 * throws unless a test sets an answer: nothing here reaches the network); the database by a recording stand-in
 * that answers like the functions of migrations/*_social_readers.sql (their snake_case answers, SQLSTATEs and
 * details). What is proven here is the handlers: what they send, what they map, what they delete, how they
 * refuse, and that every reserved call is ended exactly once. That the mappers match the SQL's own answers is
 * proven against a real database by `readers.db.test.ts`.
 */

const signedIn = vi.fn();
const events: string[] = [];

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));

/**
 * `forget` is the shared cache module's, which never rejects for Redis (it swallows that); a test that must
 * see what the handler does if it does reject makes it reject: `forgetFails.times` calls, then the real one.
 */
const forgetFails = vi.hoisted(() => ({ times: 0 }));
vi.mock('@/lib/social/cache.ts', async (original) => {
  const real = await original<typeof import('@/lib/social/cache.ts')>();
  return {
    ...real,
    forget: async (keys: readonly string[]) => {
      if (forgetFails.times > 0) {
        forgetFails.times--;
        throw new Error('forgetting the copies was refused');
      }
      return real.forget(keys);
    },
  };
});

type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
let answer: (statement: Statement) => unknown = () => ({});

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith('select set_config')) return { rows: [] };
    if (text === 'begin' || text === 'rollback') return { rows: [] };
    if (text === 'commit') {
      events.push('commit');
      return { rows: [] };
    }
    asked.push({ text, values });
    const result = answer({ text, values });
    if (result instanceof Error) throw result;
    return { rows: [{ answer: result }] };
  }),
  release: vi.fn(),
};
const databaseOff = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/db.ts', () => ({
  database: () => (databaseOff.value ? null : { connect: async () => client }),
}));

const stored = new Map<string, unknown>();
const redis = {
  get: vi.fn(async (key: string) => {
    events.push(`redis get ${key}`);
    return stored.get(key) ?? null;
  }),
  set: vi.fn(async (key: string, value: unknown, options: { ex: number }) => {
    events.push(`redis set ${key} ex ${options.ex}`);
    stored.set(key, JSON.parse(JSON.stringify(value)));
    return 'OK';
  }),
  del: vi.fn(async (...keys: string[]) => {
    for (const key of keys) {
      events.push(`redis del ${key}`);
      stored.delete(key);
    }
    return keys.length;
  }),
};

const { router } = await import('../router.ts');
const { resetSocialCache } = await import('@/lib/social/cache.ts');
const { secondsToDayEnd, stateSeconds } = await import('./readers.ts');

const ORIGIN = 'https://abc-preview.hrizzup.test';
const READER = '019a7b10-0000-7000-8000-0000000000a1';
const REQUEST = '019a7b10-0000-7000-8000-0000000000e1';
const MESSAGE_ID = '019a7b10-0000-7000-8000-0000000000c1';
const REPLY_ID = '019a7b10-0000-7000-8000-0000000000c2';
const OLDER_ID = '019a7b10-0000-7000-8000-0000000000b0';
const STATE_COPY = `stg:cache:social-reader:v1:${READER}`;
const FOR_YOU_COPY = `stg:cache:social-foryou:v1:${READER}`;
const BOARD_TOP_COPY = 'stg:cache:social-board-top:v1';
const TOKEN = 'test-token-not-a-real-one';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const BODY = 'AI news from the Philippines, mostly timelines and memes, no crypto';
const MODEL = '@cf/meta/llama-3.2-3b-instruct';

const api = (headers: Record<string, string> = {}) => {
  const resHeaders = new Headers();
  return {
    resHeaders,
    call: createRouterClient(router, {
      context: { headers: new Headers(headers), url: `${ORIGIN}/api/v1/x`, resHeaders },
    }),
  };
};

/** A database error as `pg` raises it, with the `detail` the functions put on it. */
const fault = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

const stateRow = (changes: Record<string, unknown> = {}) => ({
  profile: '',
  profile_number: 0,
  holds_something: false,
  profile_changed_at: null,
  usage: {
    day: '2026-11-18',
    messages_today: 0,
    daily_messages: 20,
    messages_left_today: 20,
    paused_until: null,
    resets_at: '2026-11-19T00:00:00.000Z',
  },
  allowance: { neurons_used: '0', neurons_reserved: '0', daily_neurons: '9000', calls: 0 },
  ...changes,
});
const messageRow = (author: 'reader' | 'agent', changes: Record<string, unknown> = {}) => ({
  id: author === 'reader' ? MESSAGE_ID : REPLY_ID,
  author,
  body: author === 'reader' ? BODY : 'Done.',
  neurons: author === 'reader' ? null : '5.365375',
  created_at: '2026-11-18T08:20:00.123Z',
  ...changes,
});
const profileWith = (more: string[] = [], less: string[] = [], formats: string[] = []) =>
  writeProfile({ more, less, formats });
const answerRow = (changes: Record<string, unknown> = {}) => ({
  ...stateRow({
    profile: profileWith(['AI']),
    profile_number: 1,
    holds_something: true,
    usage: {
      day: '2026-11-18',
      messages_today: 1,
      daily_messages: 20,
      messages_left_today: 19,
      paused_until: null,
      resets_at: '2026-11-19T00:00:00.000Z',
    },
    allowance: { neurons_used: '5.365375', neurons_reserved: '0', daily_neurons: '9000', calls: 1 },
  }),
  message: messageRow('reader'),
  reply: messageRow('agent'),
  profile_changed: true,
  profile_refused: false,
  ...changes,
});
const reserved = (changes: Record<string, unknown> = {}) => ({
  state: 'reserved',
  call: {
    day: '2026-11-18',
    reserved: '18.3925',
    message_id: MESSAGE_ID,
    lease_until: '2026-11-18T08:21:00.123Z',
  },
  ai: { provider: 'workers-ai', model: MODEL, max_input_tokens: 2000, max_output_tokens: 300 },
  profile: { body: '', number: 0 },
  history: [],
  ...changes,
});
const cloudflare = (result: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), { status });
const cloudflareFailure = (status: number, code: number | null) =>
  new Response(
    JSON.stringify({
      success: false,
      result: null,
      errors: code === null ? [] : [{ code, message: 'in Cloudflare words' }],
      messages: [],
    }),
    { status },
  );
const modelAnswer = {
  reply: 'Done: more cricket, less crypto.',
  edits: [
    { op: 'add', list: 'more', item: 'cricket' },
    { op: 'add', list: 'less', item: 'crypto' },
  ],
};

const fetcher = vi.fn(
  async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    throw new Error('the network must not be reached');
  },
);

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  // Nothing reaches Cloudflare: the token and the account are blank unless a test sets them, and `fetch` throws.
  vi.stubEnv('WORKERS_AI_TOKEN', '');
  vi.stubEnv('WORKERS_AI_ACCOUNT_ID', '');
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  signedIn.mockResolvedValue({ id: READER });
  resetSocialCache({ redis: redis as never, prefix: 'stg' });
  answer = () => ({});
});

afterEach(() => {
  forgetFails.times = 0;
  databaseOff.value = false;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  asked.length = 0;
  events.length = 0;
  stored.clear();
  resetSocialCache(undefined);
});

const withWorkersAi = () => {
  vi.stubEnv('WORKERS_AI_TOKEN', TOKEN);
  vi.stubEnv('WORKERS_AI_ACCOUNT_ID', ACCOUNT);
};
const statementsOf = (name: string) => asked.filter((statement) => statement.text.includes(name));
const sentOf = (name: string) => statementsOf(name).map((statement) => statement.values);
const dels = () => redis.del.mock.calls.map((keys) => [...keys]);
/** The answer that the settle was given, parsed back from what it was sent. */
const settledWith = (index = 0) =>
  statementsOf('reader_chat_settle')[index]?.values?.[2] as Record<string, unknown>;

/** The database as it answers the five calls of a send, each by its function's name. */
function database(
  steps: {
    begin?: unknown;
    settle?: unknown | (() => unknown);
    fail?: unknown | (() => unknown);
  } = {},
) {
  const settles = Array.isArray(steps.settle) ? [...steps.settle] : null;
  answer = ({ text }) => {
    const pick = (value: unknown) => (typeof value === 'function' ? value() : value);
    if (text.includes('reader_chat_begin')) return pick(steps.begin ?? reserved());
    if (text.includes('reader_chat_settle')) {
      return settles
        ? settles.shift()
        : pick(steps.settle ?? { state: 'done', answer: answerRow() });
    }
    if (text.includes('reader_chat_fail')) {
      return pick(
        steps.fail ?? {
          state: 'failed',
          kind: 'released',
          view: stateRow(),
          retry_after_seconds: 3600,
        },
      );
    }
    return {};
  };
}

// The examples ------------------------------------------------------------------------------------------------

describe('the contract’s examples', () => {
  it('hold profiles in the stored form, which the parser reads and the writer writes back unchanged', () => {
    const profiles = [
      examples.readers.readerState.profile,
      examples.readers.saveProfileInput.body,
      examples.readers.readerReply.profile,
    ];
    for (const text of profiles) {
      const parsed = parseProfile(text);
      expect(parsed.ok, text).toBe(true);
      if (parsed.ok) expect(writeProfile(parsed.profile)).toBe(text);
      expect(isCanonical(text), text).toBe(true);
    }
  });
});

/**
 * The agreement's code checks are written three times in this repository (the agreement's own `validate()`, the
 * contract's `longText` in `common.ts`, and `passesCodeChecks` in `@hrizzup/social`'s reading-profile.ts, which
 * cannot import the contract), and the database's `agreement.passes_code_checks` is the fourth. This holds the
 * social package's copy equal to the contract's, for every character there is, in the three places a character
 * can sit in a line (alone, at the end, in the middle). A later export of the checks from `@hrizzup/agreement`
 * would remove the copy, and this test with it.
 */
describe('the code checks of the reading profile', () => {
  it('are the contract’s own: passesCodeChecks accepts exactly what longText accepts, for every non-control code point', () => {
    const contract = social.longText(5000);
    const templates = [(c: string) => `a${c}b`, (c: string) => c, (c: string) => `a${c}`];
    const disagreements: string[] = [];
    let checked = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const character = String.fromCodePoint(cp);
      // Control characters are the contract's own stricter rule (no escape sequences), apart from the code checks.
      if (/\p{Cc}/u.test(character)) continue;
      for (const template of templates) {
        const text = template(character);
        checked++;
        if (passesCodeChecks(text) !== contract.safeParse(text).success) {
          disagreements.push(`U+${cp.toString(16)} in ${JSON.stringify(text)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(3_000_000);
    expect(disagreements.slice(0, 5)).toEqual([]);
  }, 120_000);

  it('also agree on the checks that span characters: a joiner beside plain text, stacked variation selectors, a final new line', () => {
    const contract = social.longText(5000);
    const joiner = String.fromCodePoint(0x200d);
    const selector = String.fromCodePoint(0xfe0f);
    for (const text of [
      `a${joiner}b`,
      `${joiner}a`,
      `a${joiner}`,
      `${joiner}${joiner}`,
      `a${selector}${selector}`,
      `a${selector}`,
      `${String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb)} coder`,
      'ends with a new line\n',
      'a\nb',
    ]) {
      expect(passesCodeChecks(text), JSON.stringify(text)).toBe(contract.safeParse(text).success);
    }
  });
});

// reader.get ---------------------------------------------------------------------------------------------------

describe('reader.get', () => {
  it('asks social.reader_state as the signed-in reader and answers the contract’s state, the empty profile for a reader who never saved', async () => {
    answer = () => stateRow();
    const { call } = api();
    const state = await call.reader.get();
    expect(asked).toEqual([{ text: 'select social.reader_state() as answer', values: [] }]);
    expect(state).toEqual({
      profile: EMPTY_PROFILE,
      holdsSomething: false,
      usage: {
        messagesLeftToday: 20,
        messagesToday: 0,
        dailyMessages: 20,
        pausedUntil: null,
        resetsAt: '2026-11-19T00:00:00.000Z',
      },
      allowance: { neuronsUsed: '0', neuronsReserved: '0', dailyNeurons: '9000', calls: 0 },
    });
    expect(social.readerState.parse(state)).toEqual(state);
    // The profile's number is for For You and is never answered.
    expect(state).not.toHaveProperty('profileNumber');
    expect(state).not.toHaveProperty('profile_number');
  });

  it('answers a saved profile as it is stored, and a pause as the moment chat opens again', async () => {
    const saved = profileWith(['AI'], ['crypto']);
    answer = () =>
      stateRow({
        profile: saved,
        profile_number: 4,
        holds_something: true,
        usage: { ...stateRow().usage, paused_until: '2026-11-19T00:00:00.000Z' },
      });
    const state = await api().call.reader.get();
    expect(state.profile).toBe(saved);
    expect(state.holdsSomething).toBe(true);
    expect(state.usage.pausedUntil).toBe('2026-11-19T00:00:00.000Z');
  });

  it('keeps the answer in Redis under the reader’s own key, and the next call needs no database trip', async () => {
    answer = () => stateRow();
    await api().call.reader.get();
    expect(events).toContain(`redis set ${STATE_COPY} ex 60`);
    expect(JSON.stringify([...stored.keys()])).not.toMatch(/@|alice/);
    await api().call.reader.get();
    expect(asked).toHaveLength(1);
  });

  it('never keeps a copy past 00:00 UTC, whatever the clock says', async () => {
    answer = () => stateRow();
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const [now, seconds] of [
      ['2026-11-18T12:00:00.000Z', 60],
      ['2026-11-18T23:59:00.000Z', 60],
      ['2026-11-18T23:59:40.000Z', 20],
      ['2026-11-18T23:59:59.500Z', 1],
      ['2026-11-19T00:00:00.000Z', 60],
    ] as const) {
      vi.setSystemTime(new Date(now));
      expect(stateSeconds(), now).toBe(seconds);
      stored.clear();
      events.length = 0;
      await api().call.reader.get();
      expect(events, now).toContain(`redis set ${STATE_COPY} ex ${seconds}`);
    }
    expect(secondsToDayEnd(Date.parse('2026-11-18T18:30:00.000Z'))).toBe(19_800);
    expect(secondsToDayEnd(Date.parse('2026-11-18T23:59:59.999Z'))).toBe(1);
  });

  it('answers from the database when Redis is not set up', async () => {
    resetSocialCache(null);
    answer = () => stateRow();
    await api().call.reader.get();
    await api().call.reader.get();
    expect(asked).toHaveLength(2);
  });

  it('is turned away: 401 when nobody is signed in, 403 for a key', async () => {
    signedIn.mockResolvedValue(null);
    await expect(api().call.reader.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    signedIn.mockResolvedValue({ id: READER });
    await expect(
      api({ authorization: `Bearer hz_demo_${'p'.repeat(43)}` }).call.reader.get(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(asked).toHaveLength(0);
  });

  it('answers the database’s 42501 as the session’s 403', async () => {
    answer = () => fault('42501', 'Only a signed-in account may do this');
    await expect(api().call.reader.get()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

// reader.saveProfile -------------------------------------------------------------------------------------------

describe('reader.saveProfile', () => {
  const typed = '## more of\n* AI\n+ the Philippines\n\n## Less of\n1. crypto';

  it('saves the profile in its one stored form, forgets both copies in one DEL after the commit, and answers the state', async () => {
    const stored_ = profileWith(['AI', 'the Philippines'], ['crypto']);
    answer = () => stateRow({ profile: stored_, profile_number: 1, holds_something: true });
    const { call } = api();
    const state = await call.reader.saveProfile({ requestId: REQUEST, body: typed });
    expect(asked).toEqual([
      { text: 'select social.reader_save_profile($1, $2) as answer', values: [REQUEST, stored_] },
    ]);
    expect(state.profile).toBe(stored_);
    expect(state.holdsSomething).toBe(true);
    expect(social.readerState.parse(state)).toEqual(state);
    expect(dels()).toEqual([[STATE_COPY, FOR_YOU_COPY]]);
    expect(events.indexOf('commit')).toBeLessThan(events.indexOf(`redis del ${STATE_COPY}`));
  });

  it('saves the empty text as the empty profile', async () => {
    answer = () => stateRow();
    const state = await api().call.reader.saveProfile({ requestId: REQUEST, body: '' });
    expect(asked[0]?.values).toEqual([REQUEST, EMPTY_PROFILE]);
    expect(state.profile).toBe(EMPTY_PROFILE);
  });

  it('refuses a profile it can not read as a 400 on the body, naming each line, with no database trip and nothing forgotten', async () => {
    const { call } = api();
    await expect(
      call.reader.saveProfile({ requestId: REQUEST, body: '## Topics\n- AI\nsome words\n- x' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      message: 'Line 1: the headings are ## More of, ## Less of and ## Formats',
      data: {
        issues: [
          {
            path: 'body',
            message: 'Line 1: the headings are ## More of, ## Less of and ## Formats',
          },
          { path: 'body', message: 'Line 3: each line is a heading or an item starting with "- "' },
        ],
      },
    });
    expect(asked).toHaveLength(0);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('answers the database’s refusals: a request ID used for another body is 409, a profile it won’t take is a 400 on the body', async () => {
    answer = () => fault('HZS27', 'This request ID was used for something else');
    await expect(
      api().call.reader.saveProfile({ requestId: REQUEST, body: typed }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      data: { reason: 'request_reused' },
    });
    answer = () => fault('22023', 'A reading profile is its three headings', { detail: 'profile' });
    await expect(
      api().call.reader.saveProfile({ requestId: REQUEST, body: typed }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      data: { issues: [{ path: 'body', message: 'A reading profile is its three headings' }] },
    });
  });
});

// reader.chat.list ---------------------------------------------------------------------------------------------

describe('reader.chat.list', () => {
  it('asks social.reader_chat from the cursor, fifty at a time by default, and answers the messages with their neurons and the next cursor', async () => {
    answer = () => ({
      messages: [messageRow('agent'), messageRow('reader', { id: OLDER_ID })],
      next: OLDER_ID,
    });
    const { call } = api();
    const page = await call.reader.chat.list({
      cursor: encodeCursor('last', MESSAGE_ID),
      limit: 2,
    });
    expect(asked).toEqual([
      { text: 'select social.reader_chat($1, $2) as answer', values: [MESSAGE_ID, 2] },
    ]);
    expect(page).toEqual({
      messages: [
        {
          id: REPLY_ID,
          author: 'agent',
          body: 'Done.',
          neurons: '5.365375',
          createdAt: '2026-11-18T08:20:00.123Z',
        },
        {
          id: OLDER_ID,
          author: 'reader',
          body: BODY,
          neurons: null,
          createdAt: '2026-11-18T08:20:00.123Z',
        },
      ],
      next: encodeCursor('last', OLDER_ID),
    });
    expect(social.readerChatPage.parse(page)).toEqual(page);
    await api().call.reader.chat.list();
    expect(asked[1]?.values).toEqual([null, 50]);
  });

  it('keeps no copy in Redis, and refuses a cursor that is not this list’s as a 400 on the cursor', async () => {
    answer = () => ({ messages: [], next: null });
    await api().call.reader.chat.list();
    expect(redis.set).not.toHaveBeenCalled();
    await expect(api().call.reader.chat.list({ cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: { issues: [{ path: 'cursor' }] },
    });
  });
});

// reader.chat.send ---------------------------------------------------------------------------------------------

describe('reader.chat.send', () => {
  const send = (headers: Record<string, string> = {}) => {
    const caller = api(headers);
    return {
      ...caller,
      run: () => caller.call.reader.chat.send({ requestId: REQUEST, body: BODY }),
    };
  };

  describe('with the stand-in (no token or no account)', () => {
    it('reserves, asks the stand-in, settles with explicit zeros and the edits it made, and answers the contract’s reply', async () => {
      database({ begin: reserved() });
      const { run } = send();
      const reply = await run();
      expect(asked.map((statement) => statement.text)).toEqual([
        'select social.reader_chat_begin($1, $2) as answer',
        'select social.reader_chat_settle($1, $2, $3) as answer',
      ]);
      expect(sentOf('reader_chat_begin')).toEqual([[REQUEST, BODY]]);
      const settled = settledWith();
      expect(settled).toEqual({
        message_id: MESSAGE_ID,
        provider: 'stub',
        prompt_tokens: 0,
        completion_tokens: 0,
        answer_form: null,
        reply: expect.stringMatching(/^\(Stand-in, Workers AI isn't set up here\.\) /),
        profile: {
          base_number: 0,
          body: profileWith(['AI news', 'the Philippines'], ['crypto'], ['timelines', 'memes']),
        },
      });
      expect(statementsOf('reader_chat_settle')[0]?.values?.slice(0, 2)).toEqual([REQUEST, BODY]);
      expect(fetcher).not.toHaveBeenCalled();
      expect(social.readerReply.parse(reply)).toEqual(reply);
      expect(reply.profileChanged).toBe(true);
      expect(reply.message.neurons).toBeNull();
      expect(reply.reply.neurons).toBe('5.365375');
      expect(reply.usage.messagesToday).toBe(1);
      expect(reply.allowance.neuronsUsed).toBe('5.365375');
      expect(reply.holdsSomething).toBe(true);
    });

    it('is the stand-in when only the token is missing, or only the account ID, or one is empty', async () => {
      for (const env of [
        { WORKERS_AI_TOKEN: TOKEN, WORKERS_AI_ACCOUNT_ID: '' },
        { WORKERS_AI_TOKEN: '', WORKERS_AI_ACCOUNT_ID: ACCOUNT },
      ]) {
        vi.stubEnv('WORKERS_AI_TOKEN', env.WORKERS_AI_TOKEN);
        vi.stubEnv('WORKERS_AI_ACCOUNT_ID', env.WORKERS_AI_ACCOUNT_ID);
        asked.length = 0;
        database({ begin: reserved() });
        await send().run();
        expect(settledWith().provider).toBe('stub');
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('settles with no profile change when the stand-in changes nothing, and does not forget For You', async () => {
      database({
        begin: reserved(),
        settle: { state: 'done', answer: answerRow({ profile_changed: false }) },
      });
      const caller = api();
      await caller.call.reader.chat.send({ requestId: REQUEST, body: 'more' });
      expect(settledWith().profile).toBeNull();
      expect(dels()).toEqual([[STATE_COPY]]);
    });

    it('forgets the reader’s state after every send, and For You’s build too when the profile changed, after the commit', async () => {
      database({ begin: reserved() });
      await send().run();
      expect(dels()).toEqual([[STATE_COPY, FOR_YOU_COPY]]);
      expect(events.lastIndexOf('commit')).toBeLessThan(events.indexOf(`redis del ${STATE_COPY}`));
    });
  });

  describe('what the database answers at the reserve', () => {
    it('answers a finished send again with no AI call, no settle and nothing forgotten (a retry)', async () => {
      database({ begin: { state: 'done', answer: answerRow() } });
      const reply = await send().run();
      expect(asked.map((statement) => statement.text)).toEqual([
        'select social.reader_chat_begin($1, $2) as answer',
      ]);
      expect(reply.message.id).toBe(MESSAGE_ID);
      expect(reply.reply.id).toBe(REPLY_ID);
      expect(fetcher).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('is 409 clash with Retry-After while the first try is still answering', async () => {
      database({ begin: { state: 'in_progress', retry_after_seconds: 42 } });
      const { run, resHeaders } = send();
      await expect(run()).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
        message: 'Your reader agent is still answering this message: try again in a few seconds',
        data: { reason: 'clash' },
      });
      expect(resHeaders.get('retry-after')).toBe('42');
      expect(asked).toHaveLength(1);
    });

    it('is 429 allowance_used when Hrizzup’s day is spent, with Retry-After, and forgets the reader’s copy', async () => {
      database({
        begin: {
          state: 'refused',
          reason: 'allowance_used',
          retry_after_seconds: 20_400,
          paused_until: '2026-11-19T00:00:00.000Z',
          view: stateRow(),
        },
      });
      const { run, resHeaders } = send();
      await expect(run()).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        status: 429,
        message:
          "The reader agent has used today's allowance: chat pauses until 05:30 IST, and your feed keeps working",
        data: { reason: 'allowance_used', retryAfterSeconds: 20_400 },
      });
      expect(resHeaders.get('retry-after')).toBe('20400');
      expect(dels()).toEqual([[STATE_COPY]]);
      expect(asked).toHaveLength(1);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('is 429 daily_cap with the reader’s own number of messages in its words', async () => {
      database({
        begin: {
          state: 'refused',
          reason: 'daily_cap',
          retry_after_seconds: 3600,
          resets_at: '2026-11-19T00:00:00.000Z',
          view: stateRow(),
        },
      });
      const { run, resHeaders } = send();
      await expect(run()).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        status: 429,
        message:
          "You've used today's 20 messages with your reader agent: chat opens again at 05:30 IST, and your feed keeps working",
        data: { reason: 'daily_cap', retryAfterSeconds: 3600 },
      });
      expect(resHeaders.get('retry-after')).toBe('3600');
      expect(dels()).toEqual([[STATE_COPY]]);
    });

    it('answers the database’s own refusals: a message it won’t take is a 400 on the body, a reused request ID is 409', async () => {
      answer = () => fault('22023', 'A message is 1 to 2,000 characters', { detail: 'body' });
      await expect(send().run()).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        data: { issues: [{ path: 'body', message: 'A message is 1 to 2,000 characters' }] },
      });
      answer = () => fault('HZS27', 'This request ID was used for something else');
      await expect(send().run()).rejects.toMatchObject({
        code: 'CONFLICT',
        data: { reason: 'request_reused' },
      });
      expect(asked.every((statement) => statement.text.includes('reader_chat_begin'))).toBe(true);
    });

    it('is turned away with a key: 403, no statement', async () => {
      await expect(
        send({ authorization: `Bearer hz_demo_${'p'.repeat(43)}` }).run(),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(asked).toHaveLength(0);
    });
  });

  describe('with Workers AI', () => {
    beforeEach(withWorkersAi);

    it('posts once to the model with the token, reads the usage, and settles with the counts, the form and the edits applied to the profile it saw', async () => {
      fetcher.mockResolvedValueOnce(
        cloudflare({ response: modelAnswer, usage: { prompt_tokens: 600, completion_tokens: 85 } }),
      );
      database({
        begin: reserved({
          profile: { body: profileWith(['AI'], ['crypto']), number: 2 },
          history: [
            { author: 'reader', body: 'more AI' },
            { author: 'agent', body: 'Done: more AI.' },
          ],
        }),
      });
      const reply = await send().run();
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
      const body = JSON.parse(String(init?.body));
      expect(body.max_tokens).toBe(300);
      expect(body.messages[1].content).toContain('Reader: more AI');
      expect(body.messages[1].content).toContain(`New message:\n${BODY}`);
      expect(body.messages[1].content).toContain(
        'Profile: {"more":["AI"],"less":["crypto"],"formats":[]}',
      );
      expect(settledWith()).toEqual({
        message_id: MESSAGE_ID,
        provider: 'workers-ai',
        prompt_tokens: 600,
        completion_tokens: 85,
        answer_form: 'json',
        reply: 'Done: more cricket, less crypto.',
        // "crypto" was already in Less of, so adding it there is a no-op; "cricket" is added to More of.
        profile: { base_number: 2, body: profileWith(['AI', 'cricket'], ['crypto']) },
      });
      expect(reply.profileChanged).toBe(true);
    });

    it('settles a model answer that is plain text with the text as the reply and no profile change', async () => {
      fetcher.mockResolvedValueOnce(
        cloudflare({
          response: 'I added cricket for you.',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
      database({
        begin: reserved(),
        settle: { state: 'done', answer: answerRow({ profile_changed: false }) },
      });
      await send().run();
      expect(settledWith()).toMatchObject({
        answer_form: 'text',
        reply: 'I added cricket for you.',
        profile: null,
        prompt_tokens: 10,
      });
      expect(dels()).toEqual([[STATE_COPY]]);
    });

    it('settles without usage as nulls (the reservation stands), and adds the note when an operation was dropped', async () => {
      fetcher.mockResolvedValueOnce(
        cloudflare({
          response: {
            reply: 'Done.',
            edits: [
              { op: 'add', list: 'more', item: 'x'.repeat(200) },
              { op: 'add', list: 'more', item: 'cricket' },
            ],
          },
        }),
      );
      database({ begin: reserved() });
      await send().run();
      expect(settledWith()).toMatchObject({
        prompt_tokens: null,
        completion_tokens: null,
        reply: "Done. (Some changes didn't fit: items are at most 60 characters, 20 a heading.)",
        profile: { body: profileWith(['cricket']) },
      });
    });

    it('re-applies the model’s edits to the profile a stale settle returns, and settles again with its number', async () => {
      fetcher.mockResolvedValueOnce(cloudflare({ response: modelAnswer }));
      const moved = { body: profileWith(['golf'], [], ['memes']), number: 5 };
      database({
        begin: reserved({ profile: { body: profileWith(['AI']), number: 3 } }),
        settle: [
          { state: 'stale', profile: moved },
          { state: 'done', answer: answerRow() },
        ],
      });
      await send().run();
      expect(statementsOf('reader_chat_settle')).toHaveLength(2);
      expect(settledWith(0)).toMatchObject({
        profile: { base_number: 3, body: profileWith(['AI', 'cricket'], ['crypto']) },
      });
      expect(settledWith(1)).toMatchObject({
        reply: 'Done: more cricket, less crypto.',
        profile: { base_number: 5, body: profileWith(['golf', 'cricket'], ['crypto'], ['memes']) },
      });
      expect(statementsOf('reader_chat_fail')).toHaveLength(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('gives up after re-applying three times: it settles without a profile change, with the note, and the call is done', async () => {
      fetcher.mockResolvedValueOnce(cloudflare({ response: modelAnswer }));
      const stale = (n: number) => ({
        state: 'stale',
        profile: { body: profileWith([`moved ${n}`]), number: n },
      });
      database({
        begin: reserved({ profile: { body: '', number: 0 } }),
        settle: [
          stale(1),
          stale(2),
          stale(3),
          stale(4),
          { state: 'done', answer: answerRow({ profile_changed: false }) },
        ],
      });
      const reply = await send().run();
      // The first settle, three re-applications, then one that gives up the change.
      expect(statementsOf('reader_chat_settle')).toHaveLength(5);
      expect(settledWith(0)).toMatchObject({ profile: { base_number: 0 } });
      expect(settledWith(1)).toMatchObject({ profile: { base_number: 1 } });
      expect(settledWith(2)).toMatchObject({ profile: { base_number: 2 } });
      expect(settledWith(3)).toMatchObject({ profile: { base_number: 3 } });
      expect(settledWith(4)).toMatchObject({ profile: null });
      expect(settledWith(4)?.reply).toBe(
        'Done: more cricket, less crypto. Your profile changed while I was answering, so I left it as it is: tell me again if something is missing.',
      );
      expect(reply.profileChanged).toBe(false);
      expect(statementsOf('reader_chat_fail')).toHaveLength(0);
      expect(dels()).toEqual([[STATE_COPY]]);
    });

    it('ends the call as `kept` once when it is stale past three re-applications and the database still says stale', async () => {
      fetcher.mockResolvedValueOnce(cloudflare({ response: modelAnswer }));
      const stale = { state: 'stale', profile: { body: profileWith(['moved']), number: 9 } };
      database({ begin: reserved(), settle: () => stale });
      await expect(send().run()).rejects.toThrow();
      expect(statementsOf('reader_chat_fail')).toHaveLength(1);
      expect(sentOf('reader_chat_fail')[0]).toEqual([REQUEST, BODY, 'kept', MESSAGE_ID]);
    });

    it('releases a call for a provider or a model the code will not send, once, with no request made: 503 unavailable', async () => {
      for (const ai of [
        { provider: 'openai', model: MODEL, max_input_tokens: 2000, max_output_tokens: 300 },
        { provider: 'workers-ai', model: 'llama', max_input_tokens: 2000, max_output_tokens: 300 },
        {
          provider: 'workers-ai',
          model: '@cf/meta/../x/y',
          max_input_tokens: 2000,
          max_output_tokens: 300,
        },
      ]) {
        asked.length = 0;
        events.length = 0;
        redis.del.mockClear();
        database({ begin: reserved({ ai }) });
        const { run, resHeaders } = send();
        await expect(run()).rejects.toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          status: 503,
          data: { reason: 'unavailable', retryAfterSeconds: 60 },
        });
        expect(resHeaders.get('retry-after')).toBe('60');
        expect(sentOf('reader_chat_fail')).toEqual([[REQUEST, BODY, 'released', MESSAGE_ID]]);
        expect(statementsOf('reader_chat_settle')).toHaveLength(0);
        expect(dels()).toEqual([[STATE_COPY]]);
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    describe('when Workers AI gets no answer, the call is ended once with the kind of its failure, and the reader is told', () => {
      const cases: {
        name: string;
        respond: () => Promise<Response>;
        kind: string;
        status: number;
        data: { reason: string; retryAfterSeconds: number };
        message: string;
        wait: string;
      }[] = [
        {
          name: '3040, out of capacity',
          respond: async () => cloudflareFailure(429, 3040),
          kind: 'released',
          status: 503,
          data: { reason: 'busy', retryAfterSeconds: 30 },
          message: 'Your reader agent is busy right now: try again in a minute',
          wait: '30',
        },
        {
          name: 'a 429 with no code',
          respond: async () => cloudflareFailure(429, null),
          kind: 'released',
          status: 503,
          data: { reason: 'busy', retryAfterSeconds: 30 },
          message: 'Your reader agent is busy right now: try again in a minute',
          wait: '30',
        },
        {
          name: '5016, the model terms not agreed',
          respond: async () => cloudflareFailure(403, 5016),
          kind: 'released',
          status: 503,
          data: { reason: 'unavailable', retryAfterSeconds: 60 },
          message: "Your reader agent isn't available right now: try again later",
          wait: '60',
        },
        {
          name: 'a 401',
          respond: async () => cloudflareFailure(401, null),
          kind: 'released',
          status: 503,
          data: { reason: 'unavailable', retryAfterSeconds: 60 },
          message: "Your reader agent isn't available right now: try again later",
          wait: '60',
        },
        {
          name: 'a 408',
          respond: async () => cloudflareFailure(408, 3007),
          kind: 'kept',
          status: 503,
          data: { reason: 'too_slow', retryAfterSeconds: 5 },
          message: 'Your reader agent took too long to answer: send your message again',
          wait: '5',
        },
        {
          name: 'a 5xx',
          respond: async () => cloudflareFailure(502, null),
          kind: 'kept',
          status: 503,
          data: { reason: 'unavailable', retryAfterSeconds: 60 },
          message: "Your reader agent isn't available right now: try again later",
          wait: '60',
        },
        {
          name: 'a network error',
          respond: async () => {
            throw new TypeError('fetch failed');
          },
          kind: 'kept',
          status: 503,
          data: { reason: 'unavailable', retryAfterSeconds: 60 },
          message: "Your reader agent isn't available right now: try again later",
          wait: '60',
        },
        {
          name: 'a 200 with no envelope it can read',
          respond: async () => new Response('not json', { status: 200 }),
          kind: 'kept',
          status: 503,
          data: { reason: 'unavailable', retryAfterSeconds: 60 },
          message: "Your reader agent isn't available right now: try again later",
          wait: '60',
        },
      ];
      for (const item of cases) {
        it(`${item.name}: ${item.kind}, 503 ${item.data.reason}, Retry-After ${item.wait}`, async () => {
          fetcher.mockImplementationOnce(item.respond);
          database({ begin: reserved() });
          const { run, resHeaders } = send();
          await expect(run()).rejects.toMatchObject({
            code: 'SERVICE_UNAVAILABLE',
            status: item.status,
            message: item.message,
            data: item.data,
          });
          expect(resHeaders.get('retry-after')).toBe(item.wait);
          // The call is ended once, naming the call from the reserve, and the settle never ran.
          expect(statementsOf('reader_chat_fail')).toHaveLength(1);
          expect(sentOf('reader_chat_fail')[0]).toEqual([REQUEST, BODY, item.kind, MESSAGE_ID]);
          expect(statementsOf('reader_chat_settle')).toHaveLength(0);
          expect(fetcher).toHaveBeenCalledTimes(1);
          expect(dels()).toEqual([[STATE_COPY]]);
          expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
            'Cloudflare words',
          );
        });
      }

      it('3036, the free allocation spent: exhausted, 429 allowance_used with the database’s own wait', async () => {
        fetcher.mockResolvedValueOnce(cloudflareFailure(429, 3036));
        database({
          begin: reserved(),
          fail: {
            state: 'failed',
            kind: 'exhausted',
            view: stateRow(),
            retry_after_seconds: 12_345,
          },
        });
        const { run, resHeaders } = send();
        await expect(run()).rejects.toMatchObject({
          code: 'TOO_MANY_REQUESTS',
          status: 429,
          data: { reason: 'allowance_used', retryAfterSeconds: 12_345 },
        });
        expect(resHeaders.get('retry-after')).toBe('12345');
        expect(sentOf('reader_chat_fail')).toEqual([[REQUEST, BODY, 'exhausted', MESSAGE_ID]]);
        expect(dels()).toEqual([[STATE_COPY]]);
      });

      it('a fail that throws is swallowed and never followed by a second fail: the provider’s failure still goes out', async () => {
        fetcher.mockResolvedValueOnce(cloudflareFailure(429, 3040));
        database({ begin: reserved(), fail: () => fault('08006', 'connection failure') });
        await expect(send().run()).rejects.toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          data: { reason: 'busy' },
        });
        expect(statementsOf('reader_chat_fail')).toHaveLength(1);
        expect(console.error).toHaveBeenCalledTimes(1);
        // Only the SQLSTATE is logged, nothing of the reader's.
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('Philippines');
      });
    });
  });

  describe('every reserved call is ended exactly once, whatever goes wrong after the reserve', () => {
    it('a bug of ours (a throw in the settle) ends the call as kept before the error goes out, with the reader’s copy forgotten', async () => {
      database({ begin: reserved(), settle: () => new Error('boom') });
      await expect(send().run()).rejects.toThrow('boom');
      expect(statementsOf('reader_chat_fail')).toHaveLength(1);
      expect(sentOf('reader_chat_fail')[0]).toEqual([REQUEST, BODY, 'kept', MESSAGE_ID]);
      expect(dels()).toEqual([[STATE_COPY]]);
    });

    it('a settle the database refuses as malformed (22023 about the answer) is a 500, never a 400, and ends the call as kept', async () => {
      database({
        begin: reserved(),
        settle: () =>
          fault('22023', "The answer isn't in the form settle takes", { detail: 'answer' }),
      });
      await expect(send().run()).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
      });
      expect(sentOf('reader_chat_fail')).toEqual([[REQUEST, BODY, 'kept', MESSAGE_ID]]);
    });

    it('a settle fenced out (P0002: another try owns the call now) goes out as the database says, and the swallowed fail never repeats', async () => {
      answer = ({ text }) => {
        if (text.includes('reader_chat_begin')) return reserved();
        return fault('P0002', 'No such message');
      };
      await expect(send().run()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
        message: 'No such message',
      });
      expect(statementsOf('reader_chat_fail')).toHaveLength(1);
      expect(statementsOf('reader_chat_settle')).toHaveLength(1);
    });

    it('a throw before the provider (a stored profile that does not parse) ends the call as kept once', async () => {
      database({ begin: reserved({ profile: { body: 'not a profile\nat all', number: 1 } }) });
      await expect(send().run()).rejects.toThrow();
      expect(sentOf('reader_chat_fail')).toEqual([[REQUEST, BODY, 'kept', MESSAGE_ID]]);
      expect(statementsOf('reader_chat_settle')).toHaveLength(0);
    });

    it('a settle that succeeded is never followed by a fail, even if forgetting the copies rejects: the retry answers the same two messages', async () => {
      database({ begin: reserved() });
      forgetFails.times = 1;
      await expect(send().run()).rejects.toThrow('forgetting the copies was refused');
      // The settle committed, so the call is done: no fail followed it, whatever came after.
      expect(statementsOf('reader_chat_settle')).toHaveLength(1);
      expect(statementsOf('reader_chat_fail')).toHaveLength(0);
      // The reader sends again with the same request ID: the database answers the finished send.
      database({ begin: { state: 'done', answer: answerRow() } });
      const reply = await send().run();
      expect(reply.message.id).toBe(MESSAGE_ID);
      expect(reply.reply.id).toBe(REPLY_ID);
      expect(statementsOf('reader_chat_fail')).toHaveLength(0);
      expect(statementsOf('reader_chat_settle')).toHaveLength(1);
    });
  });

  it('leaves no statement holding the provider: the reserve and the settle are separate transactions', async () => {
    database({ begin: reserved() });
    await send().run();
    // begin, commit, settle, commit: the provider (the stand-in here) ran between two commits.
    expect(events.filter((event) => event === 'commit')).toHaveLength(2);
    expect(asked.map((statement) => statement.text.match(/reader_chat_\w+/)?.[0])).toEqual([
      'reader_chat_begin',
      'reader_chat_settle',
    ]);
  });
});

describe('a 503 that is not the reader agent’s', () => {
  it('still answers 503 with no data where the database is not set up: the send’s declared 503 data is only for its own reasons', async () => {
    databaseOff.value = true;
    for (const call of [
      () => api().call.reader.get(),
      () => api().call.reader.chat.send({ requestId: REQUEST, body: BODY }),
      () => api().call.reader.saveProfile({ requestId: REQUEST, body: '' }),
      () => api().call.reader.chat.list(),
    ]) {
      const refused = await call().catch((error: unknown) => error);
      expect(refused).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'The database is not set up here',
      });
      expect((refused as { data?: unknown }).data).toBeUndefined();
    }
  });
});

// reader.forYou ------------------------------------------------------------------------------------------------

/** A story as `social.foryou_candidates` answers it: the board's tile, its rank and its desk's formats. */
const storyRow = (
  n: number,
  title: string,
  rank: string,
  formats: string[] = [],
  changes: Record<string, unknown> = {},
) => ({
  id: `019a7b10-0000-7000-8000-${(0xd000 + n).toString(16).padStart(12, '0')}`,
  title,
  summary: 'A summary that holds nothing of interest.',
  categories: [],
  places: [],
  created_at: '2026-11-18T05:00:00.000Z',
  latest_at: '2026-11-18T06:00:00.000Z',
  latest_headline: null,
  counts: { posts: 0, replies: 0, upvotes: 0, views: 0, unique_views: 0, pins: 0 },
  picture: null,
  top_rank: rank,
  formats,
  ...changes,
});
const AI = storyRow(1, 'An AI model tops a leaderboard', '9000000', ['timeline']);
const CRICKET = storyRow(2, 'The cricket final is tonight', '8000000');
const CRYPTO = storyRow(3, 'A crypto exchange is hacked', '7000000', ['meme']);

/** The candidates as the database answers them: the board's order, the settings as text, the formats' names. */
const candidatesRow = (stories: ReturnType<typeof storyRow>[] = [AI, CRICKET, CRYPTO]) => ({
  as_of: '2026-11-18T08:00:00.000Z',
  half_life_hours: '12',
  match_hours: '24',
  format_hours: '6',
  formats: [
    { code: 'timeline', name: 'Timeline' },
    { code: 'meme', name: 'Meme' },
  ],
  stories,
});

/** The reader's state with a saved profile (More of cricket, Less of crypto), its number 3 unless told. */
const readerWith = (profile: string, number = 3) =>
  stateRow({ profile, profile_number: number, holds_something: profile !== '' });
const LIKES_CRICKET = profileWith(['cricket'], ['crypto']);

/** The database as For You asks it: the candidates, and the reader's state. */
function forYouDatabase(
  state: ReturnType<typeof stateRow> = readerWith(LIKES_CRICKET),
  stories?: ReturnType<typeof storyRow>[],
) {
  answer = ({ text }) => {
    if (text.includes('foryou_candidates')) return candidatesRow(stories);
    if (text.includes('reader_state')) return state;
    return {};
  };
}
const forYouCopy = () =>
  stored.get(FOR_YOU_COPY) as
    | { id: string; ids: string[]; profileNumber: number; builtAt: string }
    | undefined;
const REBUILT = 'Your For You was rebuilt: start again from the first page';
const rebuilt = {
  code: 'BAD_REQUEST',
  status: 400,
  message: REBUILT,
  data: { issues: [{ path: 'cursor', message: REBUILT }] },
};

describe('reader.forYou', () => {
  it('is the contract’s call: its example page, its rebuilt refusal and its input are what the contract holds', () => {
    expect(social.storyPage.parse(examples.readers.forYouPage)).toEqual(
      examples.readers.forYouPage,
    );
    // The example's next is a cursor of For You's own list, as a real build's ID (16 hex) writes it.
    const next = examples.readers.forYouPage.next as string;
    expect(decodeCursor('forYou', next)).toEqual({ b: '7f3e9a21c04b5d68', o: 1 });
    expect(examples.readers.forYouRebuilt).toMatchObject({ defined: true, ...rebuilt });
  });

  it('builds the first page from the profile and the board’s top 300, keeps the build five minutes, and pages from it', async () => {
    forYouDatabase();
    const page = await api().call.reader.forYou({ limit: 1 });
    // More of cricket lifts the cricket story over the AI one by a match's worth (1,386,294 over a 1,000,000 gap); Less of crypto drops the third.
    expect(page.stories.map((story) => story.id)).toEqual([CRICKET.id]);
    const ids = [CRICKET.id, AI.id];
    const id = buildId(ids);
    expect(decodeCursor('forYou', page.next as string)).toEqual({ b: id, o: 1 });
    expect(social.storyPage.parse(page)).toEqual(page);
    expect(forYouCopy()).toMatchObject({ id, ids, profileNumber: 3 });
    expect(events).toContain(`redis set ${FOR_YOU_COPY} ex 300`);
    expect(events).toContain(`redis set ${BOARD_TOP_COPY} ex 60`);
    // The candidates are shared: nothing personal in their copy or their key.
    expect(JSON.stringify(stored.get(BOARD_TOP_COPY))).not.toContain(READER);
    // One trip: the build, the candidates and the state are all asked before anything is kept.
    expect(events.slice(0, 3)).toEqual([
      `redis get ${FOR_YOU_COPY}`,
      `redis get ${BOARD_TOP_COPY}`,
      `redis get ${STATE_COPY}`,
    ]);
    expect(statementsOf('foryou_candidates')).toHaveLength(1);
    expect(statementsOf('reader_state')).toHaveLength(1);

    // The next page is cut from the kept build: no database trip, and the last page has no next.
    const second = await api().call.reader.forYou({ cursor: page.next as string, limit: 1 });
    expect(second.stories.map((story) => story.id)).toEqual([AI.id]);
    expect(second.next).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('runs the candidates as nobody and the state as the reader, one call of one function each', async () => {
    forYouDatabase();
    await api().call.reader.forYou();
    expect(asked.map((statement) => statement.text).sort()).toEqual([
      'select social.foryou_candidates() as answer',
      'select social.reader_state() as answer',
    ]);
  });

  it('is the board’s Top for a reader with an empty profile', async () => {
    forYouDatabase(stateRow());
    const page = await api().call.reader.forYou();
    expect(page.stories.map((story) => story.id)).toEqual([AI.id, CRICKET.id, CRYPTO.id]);
    expect(page.next).toBeNull();
    expect(forYouCopy()?.profileNumber).toBe(0);
  });

  it('pages DEFAULT_PAGE stories when no limit is sent, and the next cursor holds the rest', async () => {
    const many = Array.from({ length: DEFAULT_PAGE + 3 }, (_, n) =>
      storyRow(n + 1, `Story number ${n + 1}`, String(1_000_000 - n)),
    );
    forYouDatabase(stateRow(), many);
    const page = await api().call.reader.forYou();
    expect(page.stories).toHaveLength(DEFAULT_PAGE);
    expect(decodeCursor('forYou', page.next as string).o).toBe(DEFAULT_PAGE);
    const last = await api().call.reader.forYou({ cursor: page.next as string });
    expect(last.stories).toHaveLength(3);
    expect(last.next).toBeNull();
  });

  it('keeps the copy of a build made from the reader’s profile as it stands, and rebuilds one made from an older profile', async () => {
    forYouDatabase();
    const builtAt = '2026-11-18T07:00:00.000Z';
    // The same profile number: the copy is used as it is, whatever it holds, and nothing is deleted.
    stored.set(FOR_YOU_COPY, { id: '0123456789abcdef', ids: [AI.id], profileNumber: 3, builtAt });
    const kept = await api().call.reader.forYou();
    expect(kept.stories.map((story) => story.id)).toEqual([AI.id]);
    expect(dels()).toEqual([]);
    // An older number (a stale copy written back just after a profile change): deleted, then built again.
    stored.set(FOR_YOU_COPY, { id: '0123456789abcdef', ids: [AI.id], profileNumber: 2, builtAt });
    const fresh = await api().call.reader.forYou();
    expect(fresh.stories.map((story) => story.id)).toEqual([CRICKET.id, AI.id]);
    expect(dels()).toEqual([[FOR_YOU_COPY]]);
    expect(forYouCopy()).toMatchObject({ ids: [CRICKET.id, AI.id], profileNumber: 3 });
  });

  it('rebuilds a missing copy on a later page, with the same ID, so the cursor is still good', async () => {
    forYouDatabase();
    const first = await api().call.reader.forYou({ limit: 1 });
    stored.delete(FOR_YOU_COPY);
    asked.length = 0;
    const second = await api().call.reader.forYou({ cursor: first.next as string, limit: 1 });
    expect(second.stories.map((story) => story.id)).toEqual([AI.id]);
    expect(forYouCopy()?.id).toBe(buildId([CRICKET.id, AI.id]));
    // A later page needs the state only to rebuild: it asked for it then.
    expect(statementsOf('reader_state')).toHaveLength(0);
  });

  it('answers the rebuilt 400, the contract’s example, for a cursor of another build', async () => {
    forYouDatabase();
    await api().call.reader.forYou({ limit: 1 });
    const other = encodeCursor('forYou', { b: 'ffffffffffffffff', o: 1 });
    await expect(api().call.reader.forYou({ cursor: other, limit: 1 })).rejects.toMatchObject(
      rebuilt,
    );
    // The example says the same, word for word.
    const { defined: _defined, ...example } = examples.readers.forYouRebuilt as Record<
      string,
      unknown
    >;
    expect(example).toEqual(rebuilt);
  });

  it('answers the rebuilt 400 when the profile changed the order since the cursor was made', async () => {
    forYouDatabase();
    const first = await api().call.reader.forYou({ limit: 1 });
    // The reader saved a profile that hides the cricket story: a save deletes the build and the state's copy, and the new order isn't the cursor's.
    stored.delete(FOR_YOU_COPY);
    stored.delete(STATE_COPY);
    forYouDatabase(readerWith(profileWith([], ['cricket']), 4));
    await expect(
      api().call.reader.forYou({ cursor: first.next as string, limit: 1 }),
    ).rejects.toMatchObject(rebuilt);
  });

  it('answers the usual cursor 400 for an offset past the end of the build, and an empty page at the end', async () => {
    forYouDatabase();
    const first = await api().call.reader.forYou();
    expect(first.next).toBeNull();
    const id = buildId([CRICKET.id, AI.id]);
    const past = encodeCursor('forYou', { b: id, o: 3 });
    await expect(api().call.reader.forYou({ cursor: past })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      message: CURSOR_MESSAGE,
      data: { issues: [{ path: 'cursor', message: CURSOR_MESSAGE }] },
    });
    // An offset at the end is a page with nothing on it, and no next.
    const end = await api().call.reader.forYou({ cursor: encodeCursor('forYou', { b: id, o: 2 }) });
    expect(end).toEqual({ stories: [], next: null });
  });

  it('refuses a cursor of another list, or one that is no cursor, with the usual 400, before anything is read', async () => {
    forYouDatabase();
    for (const cursor of [
      'not-a-cursor',
      encodeCursor('time', { t: '2026-11-15T05:00:00.000Z', i: AI.id }),
    ]) {
      await expect(api().call.reader.forYou({ cursor })).rejects.toMatchObject({
        status: 400,
        message: CURSOR_MESSAGE,
      });
    }
    expect(asked).toHaveLength(0);
    expect(events.filter((event) => event.startsWith('redis'))).toEqual([]);
  });

  it('skips a story that has left the candidates since the build, and still pages on from the whole build', async () => {
    forYouDatabase(stateRow());
    const first = await api().call.reader.forYou({ limit: 1 });
    expect(first.stories.map((story) => story.id)).toEqual([AI.id]);
    // The cricket story is withdrawn: the shared copy no longer holds it, the build still does.
    const copy = stored.get(BOARD_TOP_COPY) as { stories: { tile: { id: string } }[] };
    copy.stories = copy.stories.filter((candidate) => candidate.tile.id !== CRICKET.id);
    const second = await api().call.reader.forYou({ cursor: first.next as string, limit: 1 });
    expect(second.stories).toEqual([]);
    // The page is short, but the build goes on: the third story's page is still offered.
    expect(decodeCursor('forYou', second.next as string)).toEqual({ b: forYouCopy()?.id, o: 2 });
    const third = await api().call.reader.forYou({ cursor: second.next as string, limit: 1 });
    expect(third.stories.map((story) => story.id)).toEqual([CRYPTO.id]);
    expect(third.next).toBeNull();
  });

  it('works with Redis not set up: every call loads and rebuilds, and a cursor still works while nothing changed', async () => {
    resetSocialCache(null);
    forYouDatabase();
    const first = await api().call.reader.forYou({ limit: 1 });
    expect(first.stories.map((story) => story.id)).toEqual([CRICKET.id]);
    const second = await api().call.reader.forYou({ cursor: first.next as string, limit: 1 });
    expect(second.stories.map((story) => story.id)).toEqual([AI.id]);
    expect(events.filter((event) => event.startsWith('redis'))).toEqual([]);
    expect(statementsOf('foryou_candidates')).toHaveLength(2);
  });

  it('works with Redis failing: the database answers, nothing is thrown, and a cursor still works', async () => {
    forYouDatabase();
    redis.get.mockRejectedValue(new Error('Redis is down'));
    redis.set.mockRejectedValue(new Error('Redis is down'));
    redis.del.mockRejectedValue(new Error('Redis is down'));
    try {
      const first = await api().call.reader.forYou({ limit: 1 });
      const second = await api().call.reader.forYou({ cursor: first.next as string, limit: 1 });
      expect(first.stories.map((story) => story.id)).toEqual([CRICKET.id]);
      expect(second.stories.map((story) => story.id)).toEqual([AI.id]);
    } finally {
      redis.get.mockReset();
      redis.set.mockReset();
      redis.del.mockReset();
    }
  });

  it('is the reader’s own: another reader’s build is another key, and nobody’s copy is read for a key', async () => {
    forYouDatabase();
    await api().call.reader.forYou();
    expect([...stored.keys()].filter((key) => key.includes('social-foryou'))).toEqual([
      FOR_YOU_COPY,
    ]);
    const other = '019a7b10-0000-7000-8000-0000000000a2';
    signedIn.mockResolvedValue({ id: other });
    await api().call.reader.forYou();
    expect(stored.has(`stg:cache:social-foryou:v1:${other}`)).toBe(true);
  });

  it('is turned away: 401 when nobody is signed in, 403 for a key', async () => {
    signedIn.mockResolvedValue(null);
    await expect(api().call.reader.forYou()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    signedIn.mockResolvedValue({ id: READER });
    await expect(
      api({ authorization: `Bearer hz_demo_${'p'.repeat(43)}` }).call.reader.forYou(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(asked).toHaveLength(0);
  });

  it('answers 503 where the database is not set up, and never an AI call: nothing reaches the network', async () => {
    databaseOff.value = true;
    await expect(api().call.reader.forYou()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
    forYouDatabase();
    databaseOff.value = false;
    await api().call.reader.forYou();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
