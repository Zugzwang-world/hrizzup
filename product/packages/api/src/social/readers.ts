import { z } from 'zod';
import { noInput } from '../builders.ts';
import { decimal } from '../console.ts';
import {
  count,
  errors,
  id,
  live,
  longText,
  moment,
  nextCursor,
  pageInput,
  plainText,
  requestId,
  sessionCall,
  sessionMeta,
  storyPage,
} from './common.ts';

/**
 * The reader agent (docs/social/build.md, sections 5, 7.7 and D8; built by R12): a signed-in reader's
 * reading profile, their chat with the agent that edits it, and For You, the feed plain code builds
 * from the profile. No AI runs on a read.
 */

/**
 * The reader's own allowance today, from the database's clock: the messages sent and left, until when
 * chat is paused (when Hrizzup's day is spent, or Workers AI said its free allocation is), and when the
 * day's count starts again (00:00 UTC, which is 05:30 IST).
 */
export const readerUsage = z.object({
  messagesLeftToday: count,
  messagesToday: count,
  dailyMessages: count,
  pausedUntil: moment.nullable(),
  resetsAt: moment,
});

/**
 * Hrizzup's day of reader-agent neurons (D8), the same for every reader: what answered calls used, what
 * calls in flight hold, the cap, and the calls made. Exact decimals, never numbers. An aggregate with
 * nothing personal in it.
 */
export const readerAllowance = z.object({
  neuronsUsed: decimal,
  neuronsReserved: decimal,
  dailyNeurons: decimal,
  calls: count,
});

/** The reading profile (markdown with three fixed headings), whether it holds anything, the reader's usage and Hrizzup's day. */
export const readerState = z.object({
  profile: z.string(),
  holdsSomething: z.boolean(),
  usage: readerUsage,
  allowance: readerAllowance,
});

/** A message in the reader's chat with their reader agent. An agent reply carries the neurons it used; the reader's own message has none. */
export const readerMessage = z.object({
  id,
  author: z.enum(['reader', 'agent']),
  body: z.string(),
  neurons: decimal.nullable(),
  createdAt: moment,
});

/** A page of the reader's chat, newest first. */
export const readerChatPage = z.object({ messages: z.array(readerMessage), next: nextCursor });

/** The reader's own edit of their reading profile; a profile that doesn't parse is refused (400). */
export const saveProfileInput = z.strictObject({ requestId, body: longText(2000, 0) });

/** A message to the reader agent. */
export const sendReaderMessageInput = z.strictObject({ requestId, body: plainText(2000) });

/** The agent's answer: both messages, the profile as it now stands (changed or not), and the state after the message. */
export const readerReply = z.object({
  message: readerMessage,
  reply: readerMessage,
  profileChanged: z.boolean(),
  profile: z.string(),
  holdsSomething: z.boolean(),
  usage: readerUsage,
  allowance: readerAllowance,
});

/**
 * The 503 of a message the reader agent couldn't answer, with its reason and the seconds to wait: `busy`
 * (Workers AI is at capacity: nothing was used), `unavailable` (it can't be reached or isn't set up: try
 * later) and `too_slow` (it took too long: the message counts, send it again). A 503 from anywhere else
 * (a busy database) carries no data.
 */
const readerUnavailable = {
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'Your reader agent is busy or not available: see data.reason',
    data: z.object({
      reason: z.enum(['busy', 'unavailable', 'too_slow']),
      retryAfterSeconds: z.number().int().positive(),
    }),
  },
} as const;

export type ReaderUsage = z.infer<typeof readerUsage>;
export type ReaderAllowance = z.infer<typeof readerAllowance>;
export type ReaderState = z.infer<typeof readerState>;
export type ReaderMessage = z.infer<typeof readerMessage>;
export type ReaderChatPage = z.infer<typeof readerChatPage>;
export type SaveProfileInput = z.output<typeof saveProfileInput>;
export type SendReaderMessageInput = z.output<typeof sendReaderMessageInput>;
export type ReaderReply = z.infer<typeof readerReply>;

export const readersCalls = {
  reader: {
    /** The reader's reading profile and allowance. */
    get: sessionCall
      .meta(live(sessionMeta))
      .route({
        method: 'GET',
        path: '/reader',
        summary: 'Your reading profile and allowance',
        tags: ['reader'],
      })
      .input(noInput)
      .output(readerState),

    /** Saves the reader's own edit of their reading profile. */
    saveProfile: sessionCall
      .meta(live(sessionMeta))
      .route({
        method: 'POST',
        path: '/reader/profile',
        summary: 'Save your reading profile',
        tags: ['reader'],
      })
      .errors(errors.conflict())
      .input(saveProfileInput)
      .output(readerState),

    chat: {
      /** The reader's chat with their reader agent, newest first. */
      list: sessionCall
        .meta(live(sessionMeta))
        .route({
          method: 'GET',
          path: '/reader/chat',
          summary: 'Your chat with your reader agent, newest first',
          tags: ['reader'],
        })
        .input(pageInput)
        .output(readerChatPage),

      /**
       * Tells the reader agent what the reader wants. Past the reader's own daily messages or Hrizzup's day of
       * neurons, chat pauses (429, `Retry-After`); a message still being answered is 409 `clash`; an agent that
       * can't answer is 503 (`busy`, `unavailable` or `too_slow`).
       */
      send: sessionCall
        .meta(live(sessionMeta))
        .route({
          method: 'POST',
          path: '/reader/chat',
          successStatus: 201,
          summary: 'Tell your reader agent what you want to read',
          tags: ['reader'],
        })
        .errors({
          ...errors.conflict(),
          ...errors.tooMany('allowance_used', 'daily_cap'),
          ...readerUnavailable,
        })
        .input(sendReaderMessageInput)
        .output(readerReply),
    },

    /** The reader's custom feed, built from their reading profile by plain code. */
    forYou: sessionCall
      .route({
        method: 'GET',
        path: '/reader/for-you',
        summary: 'Your feed, built from your reading profile',
        tags: ['reader'],
      })
      .input(pageInput)
      .output(storyPage),
  },
};
