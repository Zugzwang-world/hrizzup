import { redisKey } from '@hrizzup/core';
import { idOrThrow, isUuid } from './uuid.ts';

/**
 * The Redis key names social uses, each with its lifetime (docs/social/build.md, section 6, "Caching
 * map"; blueprint section 14, "Redis (Upstash)"). No Redis client is here: the code that uses a key
 * writes it with its `seconds` in the same command or script, so no key lives without an expiry.
 *
 * - **Every name starts with the environment** (`stg`, `pre`, `dev:slot2`...), the first argument of
 *   each builder, from `REDIS_KEY_PREFIX`; `redisKey` refuses any other.
 * - **Only IDs, handles and file names go into a name, never anything personal:** a builder takes an
 *   ID as a UUID in lower case (a handle never changes and is public; a file name is a short code), so
 *   an email, a display name or a key's secret can't reach a name. A name that changes shape takes a
 *   new version (`v2`).
 * - **Never the only copy:** every one is a cache, a counter or a lock that can be rebuilt; what matters
 *   lives in the database.
 */

const HOUR = 3_600;
const DAY = 86_400;

/** Which things a view or a file read counts: the contract's `ViewNote` kinds. */
export type ViewKind = 'post' | 'story' | 'file';
const VIEW_KINDS: readonly string[] = ['post', 'story', 'file'];

function viewKind(kind: string): string {
  if (!VIEW_KINDS.includes(kind))
    throw new TypeError(`A view's kind is post, story or file, not ${kind}`);
  return kind;
}

/** A UTC day as the digits of its date, `20261117`. */
function day(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new TypeError('A day is eight digits, such as 20261117');
  return value;
}

/** A request ID, any UUID, written in lower case so one ID is one key. */
function requestId(value: string): string {
  if (typeof value !== 'string' || !isUuid(value.toLowerCase())) {
    throw new TypeError('A request ID must be a UUID');
  }
  return value.toLowerCase();
}

export const socialRedis = {
  /** A story's brief as markdown (a keyed or MCP read; never kept at the edge). Deleted by the minute job before it purges the tags. */
  brief: {
    seconds: 120,
    key: (prefix: string, storyId: string) =>
      redisKey(prefix, 'cache', 'social-brief', 'v1', idOrThrow(storyId, 'A story ID')),
  },
  /** A file read through the API (D15): the file's ID for counting, and its text. Deleted by a save of the file. */
  file: {
    seconds: 60,
    key: (prefix: string, handle: string, name: string) =>
      redisKey(prefix, 'cache', 'social-file', 'v1', handle, name),
  },
  /** An agent's check-in. Deleted by its own writes and by its owner's chat and task writes. */
  checkin: {
    seconds: 30,
    key: (prefix: string, agentId: string) =>
      redisKey(prefix, 'cache', 'social-checkin', 'v1', idOrThrow(agentId, 'An agent ID')),
  },
  /** An agent's inbox, first page. Deleted when a reply to it lands. */
  inbox: {
    seconds: 30,
    key: (prefix: string, agentId: string) =>
      redisKey(prefix, 'cache', 'social-inbox', 'v1', idOrThrow(agentId, 'An agent ID')),
  },
  /** An agent's chat with its owner, first page (the owner's list is the same copy). Deleted by every chat write. */
  chat: {
    seconds: 60,
    key: (prefix: string, agentId: string) =>
      redisKey(prefix, 'cache', 'social-chat', 'v1', idOrThrow(agentId, 'An agent ID')),
  },
  /** A reader's state. Deleted by the reader's profile and chat writes. */
  reader: {
    seconds: 60,
    key: (prefix: string, userId: string) =>
      redisKey(prefix, 'cache', 'social-reader', 'v1', idOrThrow(userId, 'A user ID')),
  },
  /** A reader's For You: the build's ID and its ranked story IDs. Deleted by a profile change. */
  forYou: {
    seconds: 300,
    key: (prefix: string, userId: string) =>
      redisKey(prefix, 'cache', 'social-foryou', 'v1', idOrThrow(userId, 'A user ID')),
  },
  /** The board's top 300 candidates for every For You: shared, nothing personal. */
  boardTop: {
    seconds: 60,
    key: (prefix: string) => redisKey(prefix, 'cache', 'social-board-top', 'v1'),
  },
  /** Who a key is (`key:v2`, with its kind): the key's SHA-256 hash as 64 hex characters. A revocation writes "none" over it. */
  keyCopy: {
    seconds: 60,
    key: (prefix: string, hashHex: string) => {
      if (!/^[0-9a-f]{64}$/.test(hashHex))
        throw new TypeError('A key is named by its hash: 64 hex characters');
      return redisKey(prefix, 'key', 'v2', hashHex);
    },
  },
  /** The pending counts of views and file reads: one hash, taken by the minute job. */
  counts: {
    seconds: DAY,
    key: (prefix: string) => redisKey(prefix, 'count', 'social', 'v1'),
  },
  /** The devices that have seen an item on a UTC day, so a device counts once a day. */
  seen: {
    seconds: 36 * HOUR,
    key: (prefix: string, utcDay: string, kind: ViewKind, id: string) =>
      redisKey(prefix, 'seen', 'v1', day(utcDay), viewKind(kind), idOrThrow(id, 'An item ID')),
  },
  /** An item's unique readers (a HyperLogLog), renewed each time it is used. */
  unique: {
    seconds: 90 * DAY,
    key: (prefix: string, kind: ViewKind, id: string) =>
      redisKey(prefix, 'uniq', 'v1', viewKind(kind), idOrThrow(id, 'An item ID')),
  },
  /** A view note already counted, by its request ID, so a retry adds nothing. */
  note: {
    seconds: HOUR,
    key: (prefix: string, noteRequestId: string) =>
      redisKey(prefix, 'note', 'v1', requestId(noteRequestId)),
  },
} as const;
