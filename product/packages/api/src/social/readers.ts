import { z } from 'zod';
import { noInput } from '../builders.ts';
import {
  count,
  errors,
  id,
  longText,
  moment,
  nextCursor,
  pageInput,
  plainText,
  requestId,
  sessionCall,
  storyPage,
} from './common.ts';

/**
 * The reader agent (docs/social/build.md, sections 5, 7.7 and D8; built by R12): a signed-in reader's
 * reading profile, their chat with the agent that edits it, and For You, the feed plain code builds
 * from the profile. No AI runs on a read.
 */

/** The reader's allowance today: messages left, and until when chat is paused when the day's allowance is spent. */
export const readerUsage = z.object({
  messagesLeftToday: count,
  pausedUntil: moment.nullable(),
});

/** The reading profile (markdown with three fixed headings), whether it holds anything, and the allowance. */
export const readerState = z.object({
  profile: z.string(),
  holdsSomething: z.boolean(),
  usage: readerUsage,
});

/** A message in the reader's chat with their reader agent. */
export const readerMessage = z.object({
  id,
  author: z.enum(['reader', 'agent']),
  body: z.string(),
  createdAt: moment,
});

/** A page of the reader's chat, newest first. */
export const readerChatPage = z.object({ messages: z.array(readerMessage), next: nextCursor });

/** The reader's own edit of their reading profile; a profile that doesn't parse is refused (400). */
export const saveProfileInput = z.strictObject({ requestId, body: longText(2000, 0) });

/** A message to the reader agent. */
export const sendReaderMessageInput = z.strictObject({ requestId, body: plainText(2000) });

/** The agent's answer: both messages, and the profile as it now stands (changed or not). */
export const readerReply = z.object({
  message: readerMessage,
  reply: readerMessage,
  profileChanged: z.boolean(),
  profile: z.string(),
});

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
        .route({
          method: 'GET',
          path: '/reader/chat',
          summary: 'Your chat with your reader agent, newest first',
          tags: ['reader'],
        })
        .input(pageInput)
        .output(readerChatPage),

      /** Tells the reader agent what the reader wants. Past the day's allowance, chat pauses (429). */
      send: sessionCall
        .route({
          method: 'POST',
          path: '/reader/chat',
          successStatus: 201,
          summary: 'Tell your reader agent what you want to read',
          tags: ['reader'],
        })
        .errors({ ...errors.conflict(), ...errors.tooMany('allowance_used', 'daily_cap') })
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
