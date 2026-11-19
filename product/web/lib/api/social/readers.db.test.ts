import { randomUUID } from 'node:crypto';
import { social } from '@hrizzup/api';
import {
  EMPTY_PROFILE,
  isCanonical,
  parseProfile,
  type ReadingProfile,
  writeProfile,
} from '@hrizzup/social/reading-profile';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from '@/lib/social/cache.ts';
import { localDatabaseOrThrow } from '@/lib/social/local-database.ts';

/**
 * The reader agent's calls against a real database (docs/social/r12-design.md, sections 3.8 and 6.2): the real
 * router, handlers, mappers and output checks over the real functions of migrations/*_social_readers.sql, with
 * the stand-in answering (no token, no account: the test blanks both and stands a throwing `fetch` in for the
 * network, so Cloudflare is never reached from this Mac). What `readers.test.ts`'s stand-in can only assume is
 * proven: that the hand-written mappers match what the SQL emits, that the books balance after a send (the
 * reserve and the settle, in the day's rows and the reader's), that a retry answers the same two messages with no
 * second call, that the request store holds no text, and that the database accepts every profile `writeProfile`
 * makes and refuses exactly what `isCanonical` refuses.
 *
 * Every account is this run's own, and the allowance is read as deltas (the slot's database keeps earlier runs).
 * Run it on this Mac, on the slot's database:
 *
 *   SOCIAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$(infra/slots/slot env | sed -n 's/^export SUPABASE_DB_PORT=//p')/postgres" \
 *     pnpm --filter @hrizzup/web exec vitest run lib/api/social/readers.db.test.ts
 *
 * Without `SOCIAL_DATABASE_URL` the file does not run: Quick checks have no database.
 */

const url = process.env.SOCIAL_DATABASE_URL;

const held = vi.hoisted(() => ({
  pool: null as import('pg').Pool | null,
  account: null as string | null,
}));
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));
vi.mock('@/lib/api/context.ts', () => ({
  signedIn: async () => (held.account ? { id: held.account } : null),
}));

const { router } = await import('../router.ts');

let owner: pg.Pool;
let app: pg.Pool;
const accounts: string[] = [];
const fetcher = vi.fn(
  async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    throw new Error('the network must not be reached');
  },
);

function api(account: string | null) {
  held.account = account;
  const resHeaders = new Headers();
  const called = createRouterClient(router, {
    context: {
      headers: new Headers(),
      resHeaders,
      url: 'https://staging.hrizzup.com/api/v1/reader',
    },
  });
  return { api: called, resHeaders };
}

/** A new account of this run's own. */
async function newAccount(): Promise<string> {
  const id = randomUUID();
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())',
    [id, `reader-${id.slice(0, 8)}@social-readers.test`],
  );
  accounts.push(id);
  return id;
}

/** Today's UTC row of the allowance (a day with no row is zeros), as exact text. */
async function today() {
  const { rows } = await owner.query(
    `select trim_scale(coalesce(a.neurons_used, 0))::text as used, trim_scale(coalesce(a.neurons_reserved, 0))::text as reserved,
            coalesce(a.calls, 0) as calls, coalesce(a.refused, 0) as refused
     from (select (clock_timestamp() at time zone 'UTC')::date as day) d
     left join social.ai_days a on a.day = d.day`,
  );
  return rows[0] as { used: string; reserved: string; calls: number; refused: number };
}

async function readerDay(account: string) {
  const { rows } = await owner.query(
    `select messages, trim_scale(neurons)::text as neurons from social.reader_days
     where user_id = $1 and day = (clock_timestamp() at time zone 'UTC')::date`,
    [account],
  );
  return rows[0] as { messages: number; neurons: string } | undefined;
}

const count = async (text: string, values: unknown[]) =>
  Number((await owner.query(text, values)).rows[0]?.count);

beforeAll(async () => {
  if (!url) return;
  localDatabaseOrThrow(url);
  owner = new pg.Pool({ connectionString: url, max: 2 });
  app = new pg.Pool({ connectionString: url, max: 4 });
  owner.on('error', () => {});
  app.on('error', () => {});
  held.pool = app;
});

beforeEach(() => {
  // Nothing reaches Cloudflare: no token and no account, so the stand-in answers, and `fetch` throws.
  vi.stubEnv('WORKERS_AI_TOKEN', '');
  vi.stubEnv('WORKERS_AI_ACCOUNT_ID', '');
  vi.stubGlobal('fetch', fetcher);
  resetSocialCache(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  held.account = null;
});

afterAll(async () => {
  if (!url) return;
  if (accounts.length > 0) {
    await owner.query('delete from auth.users where id = any($1::uuid[])', [accounts]);
  }
  await owner.end();
  await app.end();
});

describe('the database this test seeds', () => {
  it('is skipped without SOCIAL_DATABASE_URL, which Quick checks do not have', () => {
    expect(true).toBe(true);
  });
});

describe.skipIf(!url)('the reader agent over the real functions', () => {
  it('answers a reader who never saved with the defaults, and makes no row', async () => {
    const account = await newAccount();
    const { api: called } = api(account);
    const state = await called.reader.get();
    expect(social.readerState.parse(state)).toEqual(state);
    expect(state.profile).toBe(EMPTY_PROFILE);
    expect(state.holdsSomething).toBe(false);
    expect(state.usage).toMatchObject({
      messagesLeftToday: 20,
      messagesToday: 0,
      dailyMessages: 20,
      pausedUntil: null,
    });
    expect(state.allowance.dailyNeurons).toBe('9000');
    // A read writes nothing.
    expect(await count('select count(*) from social.readers where user_id = $1', [account])).toBe(
      0,
    );
    const chat = await called.reader.chat.list();
    expect(chat).toEqual({ messages: [], next: null });
  });

  it('is turned away signed out and 403 never reaches the database', async () => {
    await expect(api(null).api.reader.get()).rejects.toMatchObject({ status: 401 });
  });

  it('saves a hand-typed profile in its stored form, once a version, and holds something', async () => {
    const account = await newAccount();
    const { api: called } = api(account);
    const typed =
      '## more of\n* AI\n+ the Philippines\n\n## Less of\n1. crypto\n## Formats\n- timelines';
    const saved = await called.reader.saveProfile({ requestId: randomUUID(), body: typed });
    const stored = writeProfile({
      more: ['AI', 'the Philippines'],
      less: ['crypto'],
      formats: ['timelines'],
    });
    expect(saved.profile).toBe(stored);
    expect(saved.holdsSomething).toBe(true);
    expect(social.readerState.parse(saved)).toEqual(saved);
    // The same profile again, with a new request ID, writes no version; an edit writes the next.
    await called.reader.saveProfile({ requestId: randomUUID(), body: stored });
    const { rows } = await owner.query(
      'select number, author, body from social.reader_profile_versions where user_id = $1 order by number',
      [account],
    );
    expect(rows).toEqual([{ number: 1, author: 'reader', body: stored }]);
    await called.reader.saveProfile({ requestId: randomUUID(), body: `${stored}\n- memes` });
    expect(
      await count('select count(*) from social.reader_profile_versions where user_id = $1', [
        account,
      ]),
    ).toBe(2);
    // The empty text is the empty profile, and holds nothing.
    const emptied = await called.reader.saveProfile({ requestId: randomUUID(), body: '' });
    expect(emptied.profile).toBe(EMPTY_PROFILE);
    expect(emptied.holdsSomething).toBe(false);
  });

  it('refuses a profile it cannot read before the database, and a request ID reused for another body at the database', async () => {
    const account = await newAccount();
    const { api: called } = api(account);
    await expect(
      called.reader.saveProfile({
        requestId: randomUUID(),
        body: `## More of\n- ${'x'.repeat(61)}`,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: { issues: [{ path: 'body', message: expect.stringContaining('at most 60') }] },
    });
    const requestId = randomUUID();
    await called.reader.saveProfile({ requestId, body: '## More of\n- AI' });
    await expect(
      called.reader.saveProfile({ requestId, body: '## More of\n- cricket' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', data: { reason: 'request_reused' } });
  });

  it('settles a send with the stand-in: the books balance, the messages are the reader’s own, and a retry answers the same with no second call', async () => {
    const account = await newAccount();
    const { api: called } = api(account);
    const before = await today();
    const requestId = randomUUID();
    const body = 'AI news from the Philippines, mostly timelines and memes, no crypto';
    const reply = await called.reader.chat.send({ requestId, body });

    expect(social.readerReply.parse(reply)).toEqual(reply);
    expect(fetcher).not.toHaveBeenCalled();
    const stored = writeProfile({
      more: ['AI news', 'the Philippines'],
      less: ['crypto'],
      formats: ['timelines', 'memes'],
    });
    expect(reply.profile).toBe(stored);
    expect(reply.profileChanged).toBe(true);
    expect(reply.holdsSomething).toBe(true);
    expect(reply.message).toMatchObject({ author: 'reader', body, neurons: null });
    expect(reply.reply.author).toBe('agent');
    expect(reply.reply.body).toMatch(
      /^\(Stand-in, Workers AI isn't set up here\.\) More of: AI news, the Philippines/,
    );
    // The stand-in sends zeros, so its neurons are exactly 0; the reply sorts after the message.
    expect(reply.reply.neurons).toBe('0');
    expect(reply.reply.id > reply.message.id).toBe(true);
    expect(reply.usage).toMatchObject({
      messagesToday: 1,
      messagesLeftToday: 19,
      dailyMessages: 20,
    });

    // The books: a call was made, nothing is left reserved, nothing was used, and the reader's day shows it.
    const after = await today();
    expect(after.calls - before.calls).toBe(1);
    expect(after.reserved).toBe(before.reserved);
    expect(after.used).toBe(before.used);
    expect(await readerDay(account)).toEqual({ messages: 1, neurons: '0' });
    expect(reply.allowance).toMatchObject({
      calls: after.calls,
      neuronsUsed: after.used,
      neuronsReserved: after.reserved,
    });

    // The profile has a version by the agent, number 1 (the reader never saved), and the number moved once.
    const versions = await owner.query(
      'select number, author, body from social.reader_profile_versions where user_id = $1',
      [account],
    );
    expect(versions.rows).toEqual([{ number: 1, author: 'agent', body: stored }]);

    // The request store keeps IDs and facts, never the reader's words.
    const { rows } = await owner.query(
      'select result from social.requests where actor = $1 and request_id = $2',
      [account, requestId],
    );
    expect(Object.keys(rows[0]?.result ?? {}).sort()).toEqual(
      ['facts', 'message_id', 'profile_changed', 'reply_id'].sort(),
    );
    expect(JSON.stringify(rows[0]?.result)).not.toMatch(/Philippines|crypto/);
    expect(rows[0]?.result.facts).toMatchObject({
      provider: 'stub',
      prompt_tokens: 0,
      completion_tokens: 0,
      neurons: '0',
    });

    // A retry with the same request ID answers the same two messages, makes no call and changes no book.
    const again = await called.reader.chat.send({ requestId, body });
    expect(again.message.id).toBe(reply.message.id);
    expect(again.reply.id).toBe(reply.reply.id);
    expect(again.reply.body).toBe(reply.reply.body);
    expect((await today()).calls).toBe(after.calls);
    expect(await readerDay(account)).toEqual({ messages: 1, neurons: '0' });
    // The same ID with another body is refused.
    await expect(
      called.reader.chat.send({ requestId, body: 'something else' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', data: { reason: 'request_reused' } });

    // The chat lists both, newest first, and the state after says the same.
    const chat = await called.reader.chat.list();
    expect(social.readerChatPage.parse(chat)).toEqual(chat);
    expect(chat.messages.map((m) => m.id)).toEqual([reply.reply.id, reply.message.id]);
    expect(chat.next).toBeNull();
    const state = await called.reader.get();
    expect(state.profile).toBe(stored);
    expect(state.usage.messagesToday).toBe(1);
  });

  it('keeps one reader’s chat and profile out of another’s, and pages the chat', async () => {
    const first = await newAccount();
    const second = await newAccount();
    const one = api(first).api;
    for (const [i, text] of ['more cricket', 'no golf', 'timelines please'].entries()) {
      await one.reader.chat.send({ requestId: randomUUID(), body: text });
      expect(i).toBeGreaterThanOrEqual(0);
    }
    const mine = await one.reader.chat.list({ limit: 4 });
    expect(mine.messages).toHaveLength(4);
    expect(mine.next).not.toBeNull();
    const rest = await one.reader.chat.list({
      limit: 4,
      ...(mine.next ? { cursor: mine.next } : {}),
    });
    expect(rest.messages).toHaveLength(2);
    expect(rest.next).toBeNull();
    const ids = new Set([...mine.messages, ...rest.messages].map((m) => m.id));
    expect(ids.size).toBe(6);

    const other = api(second).api;
    expect(await other.reader.chat.list()).toEqual({ messages: [], next: null });
    expect((await other.reader.get()).profile).toBe(EMPTY_PROFILE);
    // A message of the first reader's replayed by the second reader's account is a new message, not theirs.
    const stolen = [...ids][0] as string;
    const mineAgain = await other.reader.chat.send({
      requestId: randomUUID(),
      body: 'hello there',
    });
    expect(mineAgain.message.id).not.toBe(stolen);
  });

  it('counts the reader’s messages when they are reserved: past the daily messages, 429 daily_cap with Retry-After, no more calls', async () => {
    const account = await newAccount();
    const { api: called, resHeaders } = api(account);
    for (let n = 0; n < 20; n++) {
      await called.reader.chat.send({ requestId: randomUUID(), body: `more topic ${n}` });
    }
    const before = await today();
    await expect(
      called.reader.chat.send({ requestId: randomUUID(), body: 'one more' }),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { reason: 'daily_cap' },
    });
    const wait = Number(resHeaders.get('retry-after'));
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(86_400);
    // A refusal for the cap counts nothing: no call, nothing reserved, the day's refused count unchanged.
    expect(await today()).toEqual(before);
    expect((await called.reader.get()).usage).toMatchObject({
      messagesToday: 20,
      messagesLeftToday: 0,
    });
  }, 60_000);

  it('answers 429 allowance_used with no call when the day was marked exhausted, and works again once it is not', async () => {
    const account = await newAccount();
    const { api: called, resHeaders } = api(account);
    await owner.query(
      `insert into social.ai_days (day) values ((clock_timestamp() at time zone 'UTC')::date) on conflict do nothing`,
    );
    const marked = await owner.query(
      `update social.ai_days set exhausted_at = clock_timestamp()
       where day = (clock_timestamp() at time zone 'UTC')::date and exhausted_at is null returning day`,
    );
    try {
      const before = await today();
      await expect(
        called.reader.chat.send({ requestId: randomUUID(), body: 'more cricket' }),
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        status: 429,
        data: { reason: 'allowance_used' },
      });
      expect(Number(resHeaders.get('retry-after'))).toBeGreaterThanOrEqual(1);
      const after = await today();
      expect(after.calls).toBe(before.calls);
      expect(after.refused).toBe(before.refused + 1);
      const state = await called.reader.get();
      expect(state.usage.pausedUntil).not.toBeNull();
    } finally {
      if (marked.rowCount) {
        await owner.query(
          `update social.ai_days set exhausted_at = null where day = (clock_timestamp() at time zone 'UTC')::date`,
        );
      }
    }
    const done = await called.reader.chat.send({ requestId: randomUUID(), body: 'more cricket' });
    expect(done.profileChanged).toBe(true);
  });

  it('rejects a message the database will not take as a 400 on the body, and counts nothing', async () => {
    const account = await newAccount();
    const { api: called } = api(account);
    const before = await today();
    // A joiner beside plain text passes the contract's pattern but not the database's code checks.
    await expect(
      called.reader.chat.send({
        requestId: randomUUID(),
        body: `a${String.fromCodePoint(0x200d)}b`,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { issues: [{ path: 'body' }] } });
    expect(await today()).toEqual(before);
  });

  it('goes with the account: the profile, its versions, the messages and the reader’s days', async () => {
    const account = await newAccount();
    const { api: called } = api(account);
    await called.reader.chat.send({ requestId: randomUUID(), body: 'more cricket' });
    expect(
      await count('select count(*) from social.reader_messages where user_id = $1', [account]),
    ).toBe(2);
    await owner.query('delete from auth.users where id = $1', [account]);
    accounts.splice(accounts.indexOf(account), 1);
    for (const table of ['readers', 'reader_profile_versions', 'reader_messages', 'reader_days']) {
      expect(
        await count(`select count(*) from social.${table} where user_id = $1`, [account]),
        table,
      ).toBe(0);
    }
  });
});

// Workers AI, stood in for -----------------------------------------------------------------------------------------

describe.skipIf(!url)(
  'the reader agent with Workers AI stood in for (a stand-in fetch, never Cloudflare)',
  () => {
    const TOKEN = 'test-token-not-a-real-one';
    const ACCOUNT = '0123456789abcdef0123456789abcdef';
    beforeEach(() => {
      vi.stubEnv('WORKERS_AI_TOKEN', TOKEN);
      vi.stubEnv('WORKERS_AI_ACCOUNT_ID', ACCOUNT);
    });

    const answers = (result: unknown) =>
      new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
        status: 200,
      });
    const refusal = (status: number, code: number | null) =>
      new Response(
        JSON.stringify({
          success: false,
          result: null,
          errors: code === null ? [] : [{ code, message: 'x' }],
          messages: [],
        }),
        { status },
      );
    const modelJson = {
      reply: 'Done: more cricket.',
      edits: [{ op: 'add', list: 'more', item: 'cricket' }],
    };

    /** Exact decimal text, worked out by the database: a sum, and what a call of that many tokens costs at today's rates. */
    const plus = async (a: string, b: string) =>
      (await owner.query('select trim_scale($1::numeric + $2::numeric)::text as n', [a, b])).rows[0]
        .n as string;
    const cost = async (prompt: number, completion: number) =>
      (
        await owner.query(
          `select trim_scale(($1::numeric * reader_ai_in_neurons_per_m + $2::numeric * reader_ai_out_neurons_per_m) * 0.000001)::text as n
         from social.settings`,
          [prompt, completion],
        )
      ).rows[0].n as string;
    const reservation = () => cost(2000, 300);

    it('settles a 200 with usage at what the tokens cost, and records the call’s facts', async () => {
      const account = await newAccount();
      const { api: called } = api(account);
      const before = await today();
      fetcher.mockResolvedValueOnce(
        answers({ response: modelJson, usage: { prompt_tokens: 600, completion_tokens: 85 } }),
      );
      const requestId = randomUUID();
      const reply = await called.reader.chat.send({ requestId, body: 'More cricket please' });

      expect(fetcher).toHaveBeenCalledTimes(1);
      const spent = await cost(600, 85);
      expect(reply.reply).toMatchObject({
        author: 'agent',
        body: 'Done: more cricket.',
        neurons: spent,
      });
      expect(reply.profileChanged).toBe(true);
      expect(reply.profile).toBe(writeProfile({ more: ['cricket'], less: [], formats: [] }));
      const after = await today();
      expect(after.reserved).toBe(before.reserved);
      expect(after.used).toBe(await plus(before.used, spent));
      expect(after.calls - before.calls).toBe(1);
      expect(await readerDay(account)).toEqual({ messages: 1, neurons: spent });
      expect(reply.allowance.neuronsUsed).toBe(after.used);
      const { rows } = await owner.query(
        'select result from social.requests where actor = $1 and request_id = $2',
        [account, requestId],
      );
      expect(rows[0]?.result.facts).toMatchObject({
        provider: 'workers-ai',
        answer_form: 'json',
        prompt_tokens: 600,
        completion_tokens: 85,
        neurons: spent,
      });
      const versions = await owner.query(
        'select number, author from social.reader_profile_versions where user_id = $1',
        [account],
      );
      expect(versions.rows).toEqual([{ number: 1, author: 'agent' }]);
    });

    it('settles a 200 with no usage at the reservation, and a reply that is plain text as it is', async () => {
      const account = await newAccount();
      const { api: called } = api(account);
      const before = await today();
      fetcher.mockResolvedValueOnce(answers({ response: 'I added cricket for you.' }));
      const reply = await called.reader.chat.send({
        requestId: randomUUID(),
        body: 'More cricket please',
      });
      const most = await reservation();
      expect(reply.reply).toMatchObject({ body: 'I added cricket for you.', neurons: most });
      expect(reply.profileChanged).toBe(false);
      const after = await today();
      expect(after.used).toBe(await plus(before.used, most));
      expect(after.reserved).toBe(before.reserved);
    });

    it('releases a call Cloudflare refused before running (3040): the reservation and the slot come back, and the same request ID tries again', async () => {
      const account = await newAccount();
      const { api: called, resHeaders } = api(account);
      const before = await today();
      const requestId = randomUUID();
      fetcher.mockResolvedValueOnce(refusal(429, 3040));
      await expect(
        called.reader.chat.send({ requestId, body: 'More cricket please' }),
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        data: { reason: 'busy', retryAfterSeconds: 30 },
      });
      expect(resHeaders.get('retry-after')).toBe('30');
      const after = await today();
      expect(after.reserved).toBe(before.reserved);
      expect(after.used).toBe(before.used);
      // A call was made (the count only rises), but the reader's slot is given back and nothing was used.
      expect(after.calls - before.calls).toBe(1);
      expect((await readerDay(account))?.messages).toBe(0);
      expect(
        await count('select count(*) from social.requests where actor = $1 and request_id = $2', [
          account,
          requestId,
        ]),
      ).toBe(0);
      expect((await called.reader.get()).usage.messagesLeftToday).toBe(20);
      // The request ID is free: the same message tries again, and this time it is answered.
      fetcher.mockResolvedValueOnce(
        answers({ response: modelJson, usage: { prompt_tokens: 600, completion_tokens: 85 } }),
      );
      const reply = await called.reader.chat.send({ requestId, body: 'More cricket please' });
      expect(reply.reply.body).toBe('Done: more cricket.');
      expect((await readerDay(account))?.messages).toBe(1);
    });

    it('keeps a call that may have run (a 502): the reservation counts as used and the slot stays taken, so a reader’s failures are bounded by their daily messages', async () => {
      const account = await newAccount();
      const { api: called } = api(account);
      const before = await today();
      const requestId = randomUUID();
      fetcher.mockResolvedValueOnce(refusal(502, null));
      await expect(
        called.reader.chat.send({ requestId, body: 'More cricket please' }),
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        data: { reason: 'unavailable', retryAfterSeconds: 60 },
      });
      const most = await reservation();
      const after = await today();
      expect(after.reserved).toBe(before.reserved);
      expect(after.used).toBe(await plus(before.used, most));
      expect(await readerDay(account)).toEqual({ messages: 1, neurons: most });
      // The failed call's slot is not given back; the retry takes a slot of its own.
      fetcher.mockResolvedValueOnce(
        answers({ response: modelJson, usage: { prompt_tokens: 600, completion_tokens: 85 } }),
      );
      await called.reader.chat.send({ requestId, body: 'More cricket please' });
      expect((await readerDay(account))?.messages).toBe(2);
      expect((await called.reader.get()).usage.messagesLeftToday).toBe(18);
    });

    it('marks the day exhausted when Cloudflare says its free allocation is spent (3036): 429, and no call goes out for the rest of the day', async () => {
      const account = await newAccount();
      const { api: called, resHeaders } = api(account);
      await owner.query(
        `insert into social.ai_days (day) values ((clock_timestamp() at time zone 'UTC')::date) on conflict do nothing`,
      );
      const previously = await owner.query(
        `select exhausted_at from social.ai_days where day = (clock_timestamp() at time zone 'UTC')::date`,
      );
      try {
        const before = await today();
        fetcher.mockResolvedValueOnce(refusal(429, 3036));
        await expect(
          called.reader.chat.send({ requestId: randomUUID(), body: 'More cricket please' }),
        ).rejects.toMatchObject({
          code: 'TOO_MANY_REQUESTS',
          status: 429,
          data: { reason: 'allowance_used' },
        });
        const wait = Number(resHeaders.get('retry-after'));
        expect(wait).toBeGreaterThanOrEqual(1);
        expect(wait).toBeLessThanOrEqual(86_400);
        const after = await today();
        expect(after.reserved).toBe(before.reserved);
        expect(after.used).toBe(before.used);
        expect((await readerDay(account))?.messages).toBe(0);
        expect((await called.reader.get()).usage.pausedUntil).not.toBeNull();
        // Paused for the day: the next message is refused with no call to the provider.
        await expect(
          called.reader.chat.send({ requestId: randomUUID(), body: 'More cricket please' }),
        ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', data: { reason: 'allowance_used' } });
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        await owner.query(
          `update social.ai_days set exhausted_at = $1 where day = (clock_timestamp() at time zone 'UTC')::date`,
          [previously.rows[0]?.exhausted_at ?? null],
        );
      }
    });

    it('releases a call for a provider or a model the code will not send, with no request made', async () => {
      const account = await newAccount();
      const { api: called } = api(account);
      const before = await today();
      // The provider and the model are settings of the console's; set for this test, then put back.
      const original = (
        await owner.query('select reader_ai_provider, reader_ai_model from social.settings')
      ).rows[0];
      try {
        for (const [column, value] of [
          ['reader_ai_provider', 'openai'],
          ['reader_ai_model', 'llama'],
        ] as const) {
          await owner.query(
            `update social.settings set reader_ai_provider = $1, reader_ai_model = $2`,
            [
              column === 'reader_ai_provider' ? value : original.reader_ai_provider,
              column === 'reader_ai_model' ? value : original.reader_ai_model,
            ],
          );
          await expect(
            called.reader.chat.send({ requestId: randomUUID(), body: 'More cricket please' }),
          ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', data: { reason: 'unavailable' } });
        }
      } finally {
        await owner.query(
          `update social.settings set reader_ai_provider = $1, reader_ai_model = $2`,
          [original.reader_ai_provider, original.reader_ai_model],
        );
      }
      expect(fetcher).not.toHaveBeenCalled();
      const after = await today();
      expect(after.reserved).toBe(before.reserved);
      expect(after.used).toBe(before.used);
      expect((await readerDay(account))?.messages).toBe(0);
    });
  },
);

// The database and the code hold the same profile -----------------------------------------------------------------

/** The database's own answer to "is this a reading profile in its stored form", asked as the owner (the helper is never granted). */
async function sqlAccepts(text: string): Promise<boolean> {
  const { rows } = await owner.query('select social._reader_profile_ok($1) as ok', [text]);
  return rows[0]?.ok === true;
}

describe.skipIf(!url)('the profile in the code and in the database', () => {
  const char = (...points: number[]) => String.fromCodePoint(...points);

  /** A small deterministic generator of profiles, in every script the rules allow. */
  function generated(count: number): ReadingProfile[] {
    let seed = 1119;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = [
      'AI',
      'the Philippines',
      'cricket',
      char(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940),
      char(0x65e5, 0x672c, 0x8a9e),
      char(0x1f680),
      char(0x1f469, 0x200d, 0x1f4bb),
      `cafe${char(0x301)}`,
      "it's",
      'x'.repeat(20),
    ];
    const profiles: ReadingProfile[] = [];
    for (let n = 0; n < count; n++) {
      const list = () =>
        Array.from({ length: next(9) }, () =>
          Array.from({ length: 1 + next(3) }, () => pieces[next(pieces.length)]).join(' '),
        ).filter((item, i, all) => item.length <= 60 && all.indexOf(item) === i);
      profiles.push({ more: list(), less: list(), formats: list() });
    }
    return profiles;
  }

  it('accepts every profile the code writes, from a generated set and the edges', async () => {
    const edges: ReadingProfile[] = [
      { more: [], less: [], formats: [] },
      { more: ['x'.repeat(60)], less: [], formats: [] },
      { more: [char(0x1f680).repeat(60)], less: [], formats: [] },
      { more: Array.from({ length: 20 }, (_, i) => `item ${i}`), less: [], formats: [] },
    ];
    for (const profile of [...edges, ...generated(150)]) {
      const text = writeProfile(profile);
      expect(isCanonical(text), text).toBe(true);
      expect(await sqlAccepts(text), text).toBe(true);
    }
  });

  it('refuses what the code refuses: the same answer for each text, whether it parses or not', async () => {
    const head = '# Reading profile\n\n## More of';
    const tail = '\n\n## Less of\n\n## Formats';
    const bad: string[] = [
      '',
      '## More of\n- AI',
      `${head}\n- ${'x'.repeat(61)}${tail}`,
      `${head}\n- ${char(0x1f680).repeat(61)}${tail}`,
      `${head}${Array.from({ length: 21 }, (_, i) => `\n- item ${i}`).join('')}${tail}`,
      `${EMPTY_PROFILE}\n`,
      `${head}\n- two\twords${tail}`,
      `${head}\n- ends with a no-break space${char(0xa0)}${tail}`,
      `${head}\n- A${char(0x200b)}I${tail}`,
      `${head}\n- A${char(0xe0041)}I${tail}`,
      `${head}\n- A${char(0x200d)}I${tail}`,
      `${head}\n- A${char(0xfe0f)}${char(0xfe0f)}${tail}`,
      `${EMPTY_PROFILE}${'x'.repeat(2001)}`,
      '# Reading profile\n\n## Less of\n\n## More of\n\n## Formats',
    ];
    for (const text of bad) {
      expect(isCanonical(text), JSON.stringify(text).slice(0, 60)).toBe(false);
      expect(await sqlAccepts(text), JSON.stringify(text).slice(0, 60)).toBe(false);
    }
    // What the parser refuses never reaches the database: the handler answers a 400, so no profile of that kind is stored.
    for (const typed of [
      `## More of\n- ${'x'.repeat(61)}`,
      `## More of\n- A${char(0x200b)}I`,
      '- a\n- b',
    ]) {
      expect(parseProfile(typed).ok, typed).toBe(false);
    }
  });

  it('agrees for every character of the Basic Multilingual Plane as an item’s start, middle, end or alone', async () => {
    const templates: Record<string, (c: string) => string> = {
      middle: (c) => `a${c}b`,
      start: (c) => `${c}b`,
      end: (c) => `a${c}`,
      alone: (c) => c,
    };
    const sql: Record<string, string> = {
      middle: "'a' || chr(i) || 'b'",
      start: "chr(i) || 'b'",
      end: "'a' || chr(i)",
      alone: 'chr(i)',
    };
    for (const [name, template] of Object.entries(templates)) {
      const refusedHere: number[] = [];
      for (let cp = 1; cp <= 0xffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        const item = template(String.fromCodePoint(cp));
        if (!isCanonical(writeProfile({ more: [item], less: [], formats: [] })))
          refusedHere.push(cp);
      }
      const { rows } = await owner.query(
        `select i from generate_series(1, 65535) i
           where i not between 55296 and 57343
             and not social._reader_profile_ok(E'# Reading profile\\n\\n## More of\\n- ' || (${sql[name]}) || E'\\n\\n## Less of\\n\\n## Formats')
           order by i`,
      );
      expect(
        rows.map((row) => Number(row.i)),
        name,
      ).toEqual(refusedHere);
    }
  }, 180_000);
});
