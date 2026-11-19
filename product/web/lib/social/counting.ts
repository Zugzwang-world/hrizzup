import type { social } from '@hrizzup/api';
import { visitorKeyOf } from '@hrizzup/social/address';
import { socialRedis } from '@hrizzup/social/redis';
import { isUuid } from '@hrizzup/social/uuid';
import {
  fieldOf,
  fingerprintOf,
  NOTE_SCRIPT,
  noteCall,
  noteOutcome,
  PENDING_SECONDS,
  readerToken,
  TAKE_SCRIPT,
  UNIQUE_SECONDS,
  type ViewItem,
  viewTokens,
} from '@hrizzup/social/views';
import type { Redis } from '@upstash/redis';
import { socialCache } from './cache.ts';
import { visitorLimitsApply } from './limits.ts';

/**
 * Where views and file reads are counted (docs/social/build.md, D7 and D15; docs/social/r11-design.md,
 * section 3.3): a note's items go into Redis in one script, and a file read in one transaction. Nothing is
 * written to the database here: the minute job takes what is counted (`jobs/tally.ts`) and applies it.
 *
 * - **Counting never slows a page and never fails one:** Redis is given 500 ms; where it is late, down or
 *   not set up, a note answers 0 and a read is dropped. Only the error's name and code are logged.
 * - **A view keeps nothing about a reader beyond the day's de-duplication:** the device ID becomes two hashes
 *   (`@hrizzup/social/views`) before it goes anywhere. The caller's address is used only to cap how many devices one
 *   address adds to one item a day: it is reduced (an IPv6 address to its /64 block), keyed-hashed into a day token
 *   and gone; the token is a field of a hash that ends with the day, never part of a key's name.
 */

/** The most a note or a read waits for Redis. */
export const COUNT_WAIT_MS = 500;

/** A note's request ID was used for another note (the handler's 409, `request_reused`). */
export class NoteReused extends Error {
  constructor() {
    super('A view note’s request ID was already used for another note');
    this.name = 'NoteReused';
  }
}

/** What `within` answers: the work's answer, or that the time ran out first. */
export type Waited<T> = { value: T } | { late: true };

/**
 * `work`, given `ms` at most: its answer, or `{late: true}` where it hasn't answered by then (what it
 * does afterwards is dropped, and an error it throws then is never an unhandled one). An error it throws
 * in time is thrown here.
 */
export async function within<T>(work: Promise<T>, ms: number): Promise<Waited<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ late: true }>((resolve) => {
    timer = setTimeout(() => resolve({ late: true }), ms);
  });
  try {
    const first = await Promise.race([work.then((value) => ({ value })), late]);
    return first;
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined);
  }
}

/** Logs a failure by its name and code alone: its text may quote a command, and a command may hold a token. */
export function reportFailure(what: string, error: unknown): void {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  console.error(what, { name, code });
}

type Scripts = {
  note: ReturnType<Redis['createScript']>;
  take: ReturnType<Redis['createScript']>;
};
const scripts = new WeakMap<Redis, Scripts>();

/** The two scripts of a client, made once for it, so each one's SHA-1 is worked out once (`exec` is EVALSHA, then EVAL on NOSCRIPT). */
export function scriptsOf(redis: Redis): Scripts {
  let held = scripts.get(redis);
  if (!held) {
    held = { note: redis.createScript(NOTE_SCRIPT), take: redis.createScript(TAKE_SCRIPT) };
    scripts.set(redis, held);
  }
  return held;
}

/** The secret the tokens are keyed with, trimmed; none on a Mac without it (the tokens are then plain SHA-256). */
const secretOf = (): string | undefined => process.env.SOCIAL_JOBS_SECRET?.trim() || undefined;

/**
 * A file read through the API, counted at every read, keyed or not (D15). The reader is the reading
 * agent's ID, or, for a keyless read, the caller's address, which only a hash of it ever reaches
 * Redis (a HyperLogLog keeps no members, so nothing personal is kept).
 */
export type FileRead = {
  /** The file's ID. */
  fileId: string;
  /** The reading agent, when a posting key read it. */
  agentId: string | null;
  /** The caller's address, for a keyless read. */
  address: string | null;
};

/**
 * Counts a read: one more in the pending hash (the minute job applies it) and, for a reader it can name, one
 * element in the file's HyperLogLog, in one transaction. It never throws and is meant to run under
 * `waitUntil`, so a read never waits for it. Nothing happens where Redis isn't set up.
 */
export async function countFileRead(read: FileRead): Promise<void> {
  const cache = socialCache();
  if (!cache || !isUuid(read.fileId)) return;
  try {
    const pending = socialRedis.counts.key(cache.prefix);
    const transaction = cache.redis.multi();
    transaction.hincrby(pending, fieldOf('file', read.fileId), 1);
    transaction.expire(pending, PENDING_SECONDS);
    const reader = readerToken(secretOf(), read);
    if (reader !== null) {
      const unique = socialRedis.unique.key(cache.prefix, 'file', read.fileId);
      transaction.pfadd(unique, reader);
      transaction.expire(unique, UNIQUE_SECONDS);
    }
    await within(transaction.exec(), COUNT_WAIT_MS);
  } catch (error) {
    reportFailure('social views: a file read was not counted', error);
  }
}

/**
 * Who a note comes from. `address` is the caller's (`ipAddress(headers)`, none off Vercel): it is only ever
 * turned into a visitor key (`@hrizzup/social/address`: an IPv6 address becomes its /64 block, an IPv4-mapped
 * one the IPv4 address it carries) and hashed, keyed with `SOCIAL_JOBS_SECRET`, into the day's visitor token, the
 * field of the item's visitors' hash that counts the devices one address adds, so a client that makes up a device ID
 * for every note can't add more than 20 views to an item a day. The address itself is never kept, logged or put in
 * a key. With no address, notes share one bucket where addresses are expected (staging and production, where
 * `visitorLimitsApply` is true) and are not capped elsewhere (previews, this Mac). With no secret (this Mac only)
 * the address is not used at all and nothing is capped.
 */
export type ViewFrom = { address: string | null };

/**
 * A page's view note: each item once a device a day (a file's note counts every note), at most 20 a day an
 * address (an IPv6 /64 block) for each item, and a note whose request ID was seen in the last hour dropped whole.
 * Answers how many items it counted. Views count by device and by visitor; the address never reaches Redis.
 *
 * The same request ID with the same note answers 0 (a retry); with another note it throws `NoteReused`.
 * Where Redis is down, late or not set up, it answers 0.
 */
export async function countViews(note: social.ViewNote, from: ViewFrom): Promise<number> {
  const cache = socialCache();
  if (!cache) return 0;
  // Lower-case every ID and keep the first of each kind and ID: a note never counts an item twice.
  const items: ViewItem[] = [];
  const listed = new Set<string>();
  for (const item of note.items) {
    const id = item.id.toLowerCase();
    const field = fieldOf(item.kind, id);
    if (listed.has(field)) continue;
    listed.add(field);
    items.push({ kind: item.kind, id });
  }
  const at = new Date();
  const secret = secretOf();
  // No secret, no cap, and no hash of the address: an unkeyed hash of a day and an address could be undone.
  const tokens = viewTokens(
    secret,
    note.device,
    at,
    secret ? visitorKeyOf(from.address, visitorLimitsApply()) : null,
  );
  const call = noteCall(
    cache.prefix,
    { requestId: note.requestId, items },
    tokens,
    at,
    fingerprintOf(tokens.element, items),
  );
  let outcome: ReturnType<typeof noteOutcome>;
  try {
    const answer = await within(
      scriptsOf(cache.redis).note.exec(call.keys, call.args),
      COUNT_WAIT_MS,
    );
    if ('late' in answer) return 0;
    outcome = noteOutcome(answer.value);
  } catch (error) {
    reportFailure('social views: a note was not counted', error);
    return 0;
  }
  if (outcome.status === 'reused') throw new NoteReused();
  return outcome.status === 'replay' ? 0 : outcome.counted;
}
