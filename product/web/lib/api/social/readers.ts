import { DEFAULT_PAGE, type social } from '@hrizzup/api';
import type { Transaction } from '@hrizzup/db';
import { CURSOR_MESSAGE } from '@hrizzup/social/cursor';
import { buildForYou, type Candidates } from '@hrizzup/social/for-you';
import {
  applyEdits,
  EMPTY_PROFILE,
  MAX_EDITS,
  parseProfile,
  type ReadingProfile,
  writeProfile,
} from '@hrizzup/social/reading-profile';
import { socialRedis } from '@hrizzup/social/redis';
import { ORPCError } from '@orpc/server';
import { badRequest } from '@/lib/api/ground-rules.ts';
import { asApp, asSession } from '@/lib/social/access.ts';
import { forget, redisPrefix, remember } from '@/lib/social/cache.ts';
import { sessionOf, waitHeader } from '@/lib/social/callers.ts';
import { faultOf, type OwnMap } from '@/lib/social/errors.ts';
import { cursorFrom, nextFrom, type Page } from '@/lib/social/paging.ts';
import { cleanReply } from '@/lib/social/reader-ai/answer.ts';
import { type Failure, READER_WORDS } from '@/lib/social/reader-ai/failures.ts';
import { type ProviderAnswer, readerAi } from '@/lib/social/reader-ai/index.ts';
import { buildPrompt, type HistoryMessage } from '@/lib/social/reader-ai/prompt.ts';
import { answerOf } from '@/lib/social/shape.ts';
import { type StoryTileRow, storyTileOf } from '@/lib/social/stories.ts';
import { api } from '../base.ts';

/**
 * The reader agent: the reading profile, the chat and the allowance (R12; docs/social/r12-design.md, section
 * 3.8 and 4.2): this area's handlers, one for each of its calls in `social/readers.ts` of the contract.
 * `reader.get`, `saveProfile`, the chat's two calls and `reader.forYou` (M3) are live. R12 edits no other area's
 * file.
 *
 * - **Every call is the signed-in reader's own** (`sessionOf`: never a key, 403), through `asSession`, and
 *   answers a refusal of the database as the shared map does, after R12's own (`readerRefusals`).
 * - **No AI on a read.** Only `reader.chat.send` reaches the provider, between two short transactions: the
 *   reserve (`reader_chat_begin`) and the settle (`reader_chat_settle`), or a fail (`reader_chat_fail`)
 *   when it got no answer. Nothing is held across the provider's call: not a transaction, not a lock.
 * - **Every call that was reserved is ended exactly once** (`reader.chat.send`'s guard): a settle that
 *   returned `done`, or one `fail`. A throw of ours after the reserve (a bug, a database error) ends the call
 *   as `kept`, since the model may have run, before the error goes out.
 * - **Nothing private is logged:** the provider's one line a call has the outcome, the status, the code, the
 *   token counts, the form and the time, and nothing of the reader's.
 * - **Redis** (names from `socialRedis`): the reader's state copy (60 seconds at most, never past 00:00 UTC) is
 *   deleted by every save, send, refusal and failure of that reader; For You's copy by a profile change.
 * - **For You is plain code** (`@hrizzup/social/for-you`): the board's top 300 as one shared copy a minute (nothing
 *   personal), a build of the reader's ranked story IDs for five minutes, and a page cut from the build.
 */

/** A message as `social._reader_message_view` answers it. */
type MessageRow = {
  id: string;
  author: 'reader' | 'agent';
  body: string;
  neurons: string | null;
  created_at: string;
};

/** The state as `social.reader_state` answers it. */
type StateRow = {
  profile: string;
  profile_number: number;
  holds_something: boolean;
  profile_changed_at: string | null;
  usage: {
    day: string;
    messages_today: number;
    daily_messages: number;
    messages_left_today: number;
    paused_until: string | null;
    resets_at: string;
  };
  allowance: {
    neurons_used: string;
    neurons_reserved: string;
    daily_neurons: string;
    calls: number;
  };
};

/** A finished send as the database tells it: the state, and the two messages. */
type AnswerRow = StateRow & {
  message: MessageRow;
  reply: MessageRow;
  profile_changed: boolean;
  profile_refused: boolean;
};

/** What `reader_chat_begin` answers, by its state. */
type Begun =
  | { state: 'done'; answer: AnswerRow }
  | { state: 'in_progress'; retry_after_seconds: number }
  | {
      state: 'refused';
      reason: 'daily_cap' | 'allowance_used';
      retry_after_seconds: number;
      view: StateRow;
    }
  | {
      state: 'reserved';
      call: { day: string; reserved: string; message_id: string; lease_until: string };
      ai: { provider: string; model: string; max_input_tokens: number; max_output_tokens: number };
      profile: { body: string; number: number };
      history: HistoryMessage[];
    };

/** What `reader_chat_settle` answers. */
type Settled =
  | { state: 'done'; answer: AnswerRow }
  | { state: 'stale'; profile: { body: string; number: number } };

/** What `reader_chat_fail` answers. */
type Failed = { state: 'failed' | 'done'; retry_after_seconds?: number };

/**
 * R12's own refusals, asked before the shared map: a message or a profile the database won't take is a 400 on
 * `body`, in the database's words; a `22023` about `answer` or `kind` is our own bug (the handler sent the
 * database something it never should), so a 500 and never a 400, since the reader sent nothing wrong.
 */
export const readerRefusals: OwnMap = (fault) => {
  if (fault.code !== '22023') return undefined;
  if (fault.detail === 'body' || fault.detail === 'profile') {
    return badRequest(fault.message, [{ path: 'body', message: fault.message }]);
  }
  if (fault.detail === 'answer' || fault.detail === 'kind') {
    return new ORPCError('INTERNAL_SERVER_ERROR', {
      status: 500,
      message: 'Something went wrong on our side: try again',
    });
  }
  return undefined;
};

/** One statement of one value, `answer`, in the reader's transaction. */
const answered = async <T>(tx: Transaction, sql: string, values: unknown[]) =>
  answerOf((await tx.query(sql, values)).rows) as T;

/** A profile as the API shows it: a reader who never saved has the empty profile. */
const profileText = (stored: string): string => (stored === '' ? EMPTY_PROFILE : stored);

const messageOf = (row: MessageRow): social.ReaderMessage => ({
  id: row.id,
  author: row.author,
  body: row.body,
  neurons: row.neurons,
  createdAt: row.created_at,
});

const usageOf = (row: StateRow['usage']): social.ReaderUsage => ({
  messagesLeftToday: row.messages_left_today,
  messagesToday: row.messages_today,
  dailyMessages: row.daily_messages,
  pausedUntil: row.paused_until,
  resetsAt: row.resets_at,
});

const allowanceOf = (row: StateRow['allowance']): social.ReaderAllowance => ({
  neuronsUsed: row.neurons_used,
  neuronsReserved: row.neurons_reserved,
  dailyNeurons: row.daily_neurons,
  calls: row.calls,
});

/** The state as the contract has it. `profile_number` is for For You and is never answered. */
const stateOf = (row: StateRow): social.ReaderState => ({
  profile: profileText(row.profile),
  holdsSomething: row.holds_something,
  usage: usageOf(row.usage),
  allowance: allowanceOf(row.allowance),
});

/** A send as the contract has it: both messages, whether the profile changed, and the state after the message. */
const replyOf = (row: AnswerRow): social.ReaderReply => ({
  message: messageOf(row.message),
  reply: messageOf(row.reply),
  profileChanged: row.profile_changed,
  ...stateOf(row),
});

// ---------------------------------------------------------------------------------------------
// The clock, and the reader's Redis copies
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** The state copy lives this long at most. */
const STATE_SECONDS = 60;

/** Whole seconds to the next 00:00 UTC (05:30 IST), at least 1. */
export function secondsToDayEnd(now = Date.now()): number {
  return Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));
}

/** How long a state copy may live: a minute, never past 00:00 UTC, so no copy shows yesterday's day. */
export const stateSeconds = (now = Date.now()): number =>
  Math.max(1, Math.min(STATE_SECONDS, secondsToDayEnd(now)));

const lower = (id: string) => id.toLowerCase();

/** Deletes the reader's copies in one command: their state, and with `forYou` their For You build too. Never fails. */
async function forgetReader(userId: string, options: { forYou?: boolean } = {}): Promise<void> {
  const prefix = redisPrefix();
  if (prefix === null) return;
  const id = lower(userId);
  await forget([
    socialRedis.reader.key(prefix, id),
    ...(options.forYou ? [socialRedis.forYou.key(prefix, id)] : []),
  ]);
}

/** The reader's state, from Redis when a copy lives, else the database (and kept for a minute at most). */
async function stateFor(userId: string): Promise<StateRow> {
  const load = () =>
    asSession(
      userId,
      (tx) => answered<StateRow>(tx, 'select social.reader_state() as answer', []),
      readerRefusals,
    );
  const prefix = redisPrefix();
  return prefix === null
    ? load()
    : remember(socialRedis.reader.key(prefix, lower(userId)), stateSeconds(), load);
}

// ---------------------------------------------------------------------------------------------
// reader.chat.send: reserve, ask, settle (or fail), with every reserved call ended once
// ---------------------------------------------------------------------------------------------

const RETRY_AFTER = 'Retry-After';
/** How many times the agent's edits are re-applied on a profile that moved before the call settles without them. */
const MOST_REAPPLIED = 3;

const clash = (seconds: number, headers?: Headers) => {
  headers?.set(RETRY_AFTER, String(seconds));
  return new ORPCError('CONFLICT', {
    status: 409,
    message: 'Your reader agent is still answering this message: try again in a few seconds',
    data: { reason: 'clash' },
  });
};

const tooMany = (
  reason: 'daily_cap' | 'allowance_used',
  message: string,
  seconds: number,
  headers?: Headers,
) => {
  headers?.set(RETRY_AFTER, String(seconds));
  return new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message,
    data: { reason, retryAfterSeconds: seconds },
  });
};

/** The error the reader gets for a call that got no answer (section 3.6): the 429 when the allowance is spent, else a 503. */
function failureError(failure: Failure, databaseWait: number | undefined, headers?: Headers) {
  const words = READER_WORDS[failure.reason];
  if (failure.reason === 'allowance_used') {
    return tooMany('allowance_used', words.message, databaseWait ?? secondsToDayEnd(), headers);
  }
  const seconds = words.retryAfterSeconds ?? 60;
  headers?.set(RETRY_AFTER, String(seconds));
  return new ORPCError('SERVICE_UNAVAILABLE', {
    status: 503,
    message: words.message,
    data: { reason: failure.reason, retryAfterSeconds: seconds },
  });
}

type SendInput = { requestId: string; body: string };

/** One call of the settle, in its own transaction. */
const settleCall = (userId: string, input: SendInput, answer: Record<string, unknown>) =>
  asSession(
    userId,
    (tx) =>
      answered<Settled>(tx, 'select social.reader_chat_settle($1, $2, $3) as answer', [
        input.requestId,
        input.body,
        answer,
      ]),
    readerRefusals,
  );

/**
 * Ends a reserved call that got no answer, in its own transaction. It is only ever called once for a call:
 * if it throws (the database is down, or nothing is pending any more: another try owns the call), the throw is
 * swallowed and logged by its code only, and the first error goes out. The reservation then stays until the
 * next try takes it over, which charges it as `kept`.
 */
async function endCall(
  userId: string,
  input: SendInput,
  kind: Failure['kind'],
  messageId: string,
): Promise<Failed | null> {
  try {
    return await asSession(
      userId,
      (tx) =>
        answered<Failed>(tx, 'select social.reader_chat_fail($1, $2, $3, $4) as answer', [
          input.requestId,
          input.body,
          kind,
          messageId,
        ]),
      readerRefusals,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'reader_chat_fail_failed',
        kind,
        code: faultOf(error)?.code ?? (error instanceof ORPCError ? error.code : 'unknown'),
      }),
    );
    return null;
  }
}

/** Whether an operation of the model's names More of or Less of: the only ones where a format word is rerouted. */
const namesMoreOrLess = (edit: unknown): boolean =>
  typeof edit === 'object' &&
  edit !== null &&
  ((edit as { list?: unknown }).list === 'more' || (edit as { list?: unknown }).list === 'less');

/**
 * The names of Hrizzup's formats ("Timeline", "Meme", "Audio brief"), which `applyEdits` needs to send a format
 * word to Formats whatever list the model named (decision 11). They come from the shared candidates' copy, the
 * one `reader.forYou` reads (a cold copy is loaded from the database the same way), and only when an operation
 * names More of or Less of. **Never fails the send:** if the copy can't be had, the edits are applied as the
 * model gave them (`null`), and one line says so, with nothing in it.
 */
async function formatNamesFor(edits: readonly unknown[]): Promise<string[] | null> {
  if (!edits.slice(0, MAX_EDITS).some(namesMoreOrLess)) return null;
  try {
    const { formats } = await sharedCandidates();
    // What Redis holds is data from outside this function: a record of names by code, or nothing usable.
    if (typeof formats !== 'object' || formats === null) throw new TypeError('No formats');
    return Object.values(formats).filter((name): name is string => typeof name === 'string');
  } catch {
    console.error(JSON.stringify({ event: 'reader_format_names_failed' }));
    return null;
  }
}

/**
 * What the model asked, applied and settled: the operations on the profile the model saw, then settled with the
 * profile's number it saw. If the profile moved (a hand save, or the other tab's settle) the database answers
 * `stale` with the profile as it stands, and the same operations are applied to that and settled again, up to
 * three times; after that the call settles without a profile change, with the note. The format names are read once,
 * when an operation names More of or Less of (`formatNamesFor`), and the same ones go to every apply.
 */
async function settleWith(
  userId: string,
  input: SendInput,
  messageId: string,
  begun: Extract<Begun, { state: 'reserved' }>,
  provided: ProviderAnswer,
): Promise<AnswerRow> {
  let profile: ReadingProfile = readProfile(begun.profile.body);
  let number = begun.profile.number;
  const formatNames = await formatNamesFor(provided.edits);
  const options = formatNames === null ? {} : { formatNames };
  for (let reapplied = 0; ; reapplied++) {
    const giveUp = reapplied > MOST_REAPPLIED;
    const edited = applyEdits(profile, provided.edits, options);
    const changed = !giveUp && writeProfile(edited.profile) !== writeProfile(profile);
    const reply = cleanReply(provided.reply, {
      applied: giveUp ? 0 : edited.applied,
      dropped: giveUp ? 0 : edited.dropped,
      ...(giveUp ? { stale: true } : {}),
    });
    const settled = await settleCall(userId, input, {
      message_id: messageId,
      provider: provided.provider,
      prompt_tokens: provided.usage?.promptTokens ?? null,
      completion_tokens: provided.usage?.completionTokens ?? null,
      answer_form: provided.form,
      reply,
      profile: changed ? { base_number: number, body: writeProfile(edited.profile) } : null,
    });
    if (settled.state === 'done') return settled.answer;
    // A settle with no profile change can't be stale: if it says so, the database isn't what this code expects.
    if (giveUp) throw new Error('A settle with no profile change answered stale');
    // The profile moved: take it as it stands, and apply the same operations to it.
    profile = readProfile(settled.profile.body);
    number = settled.profile.number;
  }
}

/** A stored profile as a profile. What the database stores always parses; anything else is our bug, a 500. */
function readProfile(stored: string): ReadingProfile {
  const parsed = parseProfile(stored);
  if (!parsed.ok) throw new Error('A stored reading profile did not parse');
  return parsed.profile;
}

/**
 * Everything after the reserve: the prompt, the provider, then the settle (or the fail). The guard around it ends
 * the call exactly once. `ended` is set before a `fail` is awaited, and after a settle that returned `done`, so
 * the error thrown for a classified failure (which is thrown inside the guard) never ends the call a second time,
 * and a `fail` that throws is never followed by another.
 */
async function answerReserved(
  userId: string,
  input: SendInput,
  begun: Extract<Begun, { state: 'reserved' }>,
  headers?: Headers,
): Promise<social.ReaderReply> {
  const messageId = begun.call.message_id;
  let ended = false;
  try {
    const profile = readProfile(begun.profile.body);
    const prompt = buildPrompt({
      profile,
      history: begun.history,
      message: input.body,
      maxInputTokens: begun.ai.max_input_tokens,
    });
    const provider = readerAi(process.env, begun.ai);
    const result = await provider.run({
      prompt,
      maxOutputTokens: begun.ai.max_output_tokens,
      message: input.body,
      profile,
    });
    if (!result.ok) {
      ended = true;
      const failed = await endCall(userId, input, result.failure.kind, messageId);
      await forgetReader(userId);
      throw failureError(result.failure, failed?.retry_after_seconds, headers);
    }
    const done = await settleWith(userId, input, messageId, begun, result.answer);
    ended = true;
    await forgetReader(userId, { forYou: done.profile_changed });
    return replyOf(done);
  } catch (error) {
    if (!ended) {
      ended = true;
      await endCall(userId, input, 'kept', messageId);
      await forgetReader(userId);
    }
    throw error;
  }
}

/** A message to the reader agent: reserve, ask, settle. */
async function sendMessage(
  userId: string,
  input: SendInput,
  headers?: Headers,
): Promise<social.ReaderReply> {
  const begun = await asSession(
    userId,
    (tx) =>
      answered<Begun>(tx, 'select social.reader_chat_begin($1, $2) as answer', [
        input.requestId,
        input.body,
      ]),
    readerRefusals,
  );
  switch (begun.state) {
    case 'done':
      return replyOf(begun.answer);
    case 'in_progress':
      throw clash(begun.retry_after_seconds, headers);
    case 'refused': {
      await forgetReader(userId);
      const cap = begun.view.usage.daily_messages;
      throw tooMany(
        begun.reason,
        begun.reason === 'daily_cap'
          ? `You've used today's ${cap} messages with your reader agent: chat opens again at 05:30 IST, and your feed keeps working`
          : READER_WORDS.allowance_used.message,
        begun.retry_after_seconds,
        headers,
      );
    }
    default:
      return answerReserved(userId, input, begun, headers);
  }
}

// ---------------------------------------------------------------------------------------------
// reader.forYou: the shared candidates, the reader's build, a page cut from it
// ---------------------------------------------------------------------------------------------

/** What `social.foryou_candidates` answers: the board's top 300 as tiles, each with its rank and its desk's formats. */
type CandidatesRow = {
  as_of: string;
  half_life_hours: string;
  match_hours: string;
  format_hours: string;
  formats: { code: string; name: string }[];
  stories: (StoryTileRow & { top_rank: string; formats: string[] })[];
};

/**
 * The candidates as kept in Redis (`cache:social-board-top:v1`) and as For You ranks them: the tiles already mapped
 * (so a page needs no second read), each with its rank and desk's formats, and the formats' names by code.
 */
type CandidateCopy = Candidates<social.StoryTile> & { asOf: string };

/** A reader's build as kept in Redis (`cache:social-foryou:v1:<user>`): its ID, the ranked IDs, and the profile it was built from. */
type ForYouBuild = { id: string; ids: string[]; profileNumber: number; builtAt: string };

/** The board's top 300 from the database, mapped once. */
async function loadCandidates(): Promise<CandidateCopy> {
  const row = await asApp(
    async (tx) =>
      answerOf(
        (await tx.query('select social.foryou_candidates() as answer', [])).rows,
      ) as CandidatesRow,
  );
  return {
    asOf: row.as_of,
    halfLifeHours: row.half_life_hours,
    matchHours: row.match_hours,
    formatHours: row.format_hours,
    formats: Object.fromEntries(row.formats.map((format) => [format.code, format.name])),
    stories: row.stories.map((story) => ({
      tile: storyTileOf(story),
      rank: story.top_rank,
      formats: story.formats,
    })),
  };
}

/** The shared candidates: the Redis copy a minute, loaded from the database when missing (or when Redis isn't set up). */
function sharedCandidates(): Promise<CandidateCopy> {
  const prefix = redisPrefix();
  return prefix === null
    ? loadCandidates()
    : remember(socialRedis.boardTop.key(prefix), socialRedis.boardTop.seconds, loadCandidates);
}

/** What a For You cursor from another build says (the contract's own example). */
const REBUILT = 'Your For You was rebuilt: start again from the first page';

/**
 * One page of the reader's For You (docs/social/r12-design.md, section 4.2). The three copies are asked for
 * together, in one trip: the reader's build (read only), the shared candidates (loaded when missing) and, on a first
 * page, the reader's state (for the profile and its number). With Redis down or not set up each is loaded from the
 * database and the build is made on the spot; its ID depends only on the order, so a cursor still works while
 * nothing has changed.
 */
async function forYouPage(
  userId: string,
  cursor: string | null | undefined,
  take: number,
): Promise<social.StoryPage> {
  const at = cursorFrom('forYou', cursor);
  const prefix = redisPrefix();
  const buildKey = prefix === null ? null : socialRedis.forYou.key(prefix, lower(userId));
  const [saved, candidates, firstState] = await Promise.all([
    buildKey === null ? null : remember<ForYouBuild | null>(buildKey, 300, async () => null),
    sharedCandidates(),
    at === null ? stateFor(userId) : null,
  ]);

  /** Makes the build from the reader's profile as it stands, keeps it, and answers what is kept (a build another call kept at the same moment is as good). */
  const rebuild = async (state: StateRow, stale: boolean): Promise<ForYouBuild> => {
    if (buildKey !== null && stale) await forget([buildKey]);
    const made = buildForYou(readProfile(profileText(state.profile)), candidates);
    const fresh: ForYouBuild = {
      ...made,
      profileNumber: state.profile_number,
      builtAt: new Date().toISOString(),
    };
    return buildKey === null
      ? fresh
      : remember(buildKey, socialRedis.forYou.seconds, async () => fresh);
  };

  let build: ForYouBuild;
  if (at === null) {
    // A first page: the copy, unless it is missing or was made from an older profile than the reader's now.
    const state = firstState as StateRow;
    build =
      saved !== null && saved.profileNumber === state.profile_number
        ? saved
        : await rebuild(state, saved !== null);
  } else {
    // A later page: a missing copy is rebuilt (the same order gives the same ID, so the cursor can still be good).
    build = saved ?? (await rebuild(await stateFor(userId), false));
    if (build.id !== at.b) {
      throw badRequest(REBUILT, [{ path: 'cursor', message: REBUILT }]);
    }
    if (at.o > build.ids.length) {
      throw badRequest(CURSOR_MESSAGE, [{ path: 'cursor', message: CURSOR_MESSAGE }]);
    }
  }

  const from = at?.o ?? 0;
  const tiles = new Map(
    candidates.stories.map((candidate) => [candidate.tile.id.toLowerCase(), candidate.tile]),
  );
  const stories = build.ids.slice(from, from + take).flatMap((id) => {
    // A story withdrawn, or no longer in the top 300, since the build is skipped: a page may be short.
    const tile = tiles.get(id);
    return tile === undefined ? [] : [tile];
  });
  // Measured against the whole build, never the page, so a page shortened by skipped stories still pages on.
  const next = from + take < build.ids.length ? { b: build.id, o: from + take } : null;
  return { stories, next: nextFrom('forYou', next) };
}

export const readersRoutes = {
  reader: {
    /**
     * The reader's profile and allowance: the database's answer kept in Redis for a minute at most (never past
     * 00:00 UTC), deleted by every save, send, refusal and failure of that reader. A reader who never saved has
     * the empty profile, and no row is made.
     */
    get: api.reader.get.handler(async ({ context }) => {
      const user = await sessionOf(context.headers);
      return stateOf(await stateFor(user.id));
    }),

    /**
     * The reader's own save of their profile. The text is parsed leniently (a line that can't be read is a 400
     * naming it, ten at most) and written in its one stored form, which the database checks again; both copies
     * (the state's, and For You's build) are deleted after it commits.
     */
    saveProfile: api.reader.saveProfile.handler(async ({ input, context }) => {
      const user = await sessionOf(context.headers);
      const parsed = parseProfile(input.body);
      if (!parsed.ok) {
        throw badRequest(
          parsed.issues[0]?.message ?? 'This is not a reading profile',
          parsed.issues,
        );
      }
      const saved = await asSession(
        user.id,
        (tx) =>
          answered<StateRow>(tx, 'select social.reader_save_profile($1, $2) as answer', [
            input.requestId,
            writeProfile(parsed.profile),
          ]),
        readerRefusals,
      );
      await forgetReader(user.id, { forYou: true });
      return stateOf(saved);
    }),

    chat: {
      /** The reader's chat, newest first, `limit` at a time. Read fresh: it is read once a page view. */
      list: api.reader.chat.list.handler(async ({ input, context }) => {
        const user = await sessionOf(context.headers);
        const cursor = cursorFrom('last', input?.cursor);
        const page = await asSession(
          user.id,
          (tx) =>
            answered<Page<'messages', MessageRow, string>>(
              tx,
              'select social.reader_chat($1, $2) as answer',
              [cursor, input?.limit ?? DEFAULT_PAGE],
            ),
          readerRefusals,
        );
        return { messages: page.messages.map(messageOf), next: nextFrom('last', page.next) };
      }),

      /**
       * Tells the reader agent what the reader wants: 201 with both messages and the state after. A retry with the
       * same request ID answers the same two messages with no AI call; a message still being answered is 409
       * `clash`; past the reader's messages or Hrizzup's day of neurons it is 429 (`Retry-After`); an agent that
       * can't answer is 503 (`busy`, `unavailable`, `too_slow`).
       */
      send: api.reader.chat.send.handler(async ({ input, context }) => {
        const user = await sessionOf(context.headers);
        try {
          return await sendMessage(user.id, input, context.resHeaders);
        } catch (error) {
          waitHeader(error, context.resHeaders);
          throw error;
        }
      }),
    },

    /**
     * The reader's For You: one page of their build, which plain code makes from their profile and the board's top
     * 300 (no AI). The first page rebuilds when the copy is missing or was made from an older profile; a later
     * page whose cursor names another build answers 400 "start again from the first page".
     */
    forYou: api.reader.forYou.handler(async ({ input, context }) => {
      const user = await sessionOf(context.headers);
      return forYouPage(user.id, input?.cursor, input?.limit ?? DEFAULT_PAGE);
    }),
  },
};
