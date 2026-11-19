import { createHash, createHmac } from 'node:crypto';
import { redisKey } from '@hrizzup/core';
import { socialRedis, type ViewKind } from './redis.ts';
import { idOrThrow } from './uuid.ts';

/**
 * Counting views and file reads in Redis (docs/social/r11-design.md, sections 1 and 3; build.md, D7 and
 * D15): the two Lua scripts and the pure helpers around them. No client is here, so this file can be tested
 * without Redis; the website's `counting.ts` and the minute job's `tally.ts` run what it builds. Server
 * only (it hashes with node:crypto): a page imports nothing from here.
 *
 * - **A view keeps nothing about a reader beyond the day's de-duplication.** The device's ID never reaches
 *   Redis: the day's set holds a *day token* (an HMAC of the device and the UTC day, which can't be linked
 *   to another day's), and an item's HyperLogLog (which keeps no members) takes a *device token*.
 * - **One address can't make up devices to add views:** a device ID is the client's own string, so each item
 *   also keeps, for each UTC day, one hash of its visitors (`vcap:v1:<day>:<kind>-<id>`): the field is a *visitor
 *   day token* (an HMAC of the visitor key, `address.ts`: the IPv4 address, or an IPv6 address's /64 block, or
 *   one shared `none` where an address was expected), the value how many devices it has added. At 20 the
 *   visitor's new devices count nothing more for that item that day. The hash ends with the day's set, and no
 *   address, and no token, is in a key's name.
 * - **Every key a script touches is passed in `KEYS`** (Upstash's rule), built by `socialRedis` or
 *   `redisKey` (the cap's, `visitorCapKey`, is here: `redis.ts` is not R11's), so it starts with the
 *   environment and is written with its expiry in the same script.
 */

/** The most items one note holds (the contract's limit). */
export const NOTE_ITEMS_MAX = 50;
/** How long a note's fingerprint is kept: a retry within the hour is dropped, another note with its ID is refused. */
export const NOTE_SECONDS = socialRedis.note.seconds;
/** How long the pending hash lives, renewed on every write. */
export const PENDING_SECONDS = socialRedis.counts.seconds;
/** How long a HyperLogLog lives, renewed on every use. */
export const UNIQUE_SECONDS = socialRedis.unique.seconds;
/** The most views one address adds to one item in one UTC day, whatever device IDs it makes up (the cap per address). */
export const VISITOR_DAILY_CAP = 20;
/** A day's set of tokens lasts until its day ends and this many seconds more (the clock's slack), and no longer. */
export const SEEN_MARGIN_SECONDS = 600;

const VIEW_KINDS: readonly ViewKind[] = ['post', 'story', 'file'];

/** One item of a note, with its ID in lower case. */
export type ViewItem = { kind: ViewKind; id: string };

/** The tokens a view is kept as (never the device itself, never the address). */
export type ViewTokens = {
  /** The day's token: in the item's set of that UTC day, so a device counts once a day. */
  member: string;
  /** The device's token: added to the item's HyperLogLog, which keeps no members. */
  element: string;
  /**
   * The visitor's day token, the field of the item's day hash that counts one address's devices (the cap); null
   * with no visitor key (`visitorKeyOf` in `address.ts`: a note with no address where none is expected) and
   * with no secret, and then there is no cap.
   */
  visitor: string | null;
};

/** What a script call is made of: its keys and its arguments, in the order the script reads them. */
export type ScriptCall = { keys: string[]; args: string[] };

// ---- The scripts ----

/**
 * The note script. `KEYS[1]` is the note's key and `KEYS[2]` the pending hash; then, for item i, three keys:
 * `KEYS[3i]` its day set, `KEYS[3i + 1]` its HyperLogLog and `KEYS[3i + 2]` its visitors' hash for the day (the
 * day set and the visitors' hash are built for a file too, and never written). `ARGV[1]` is the fingerprint,
 * `ARGV[2]` the note's seconds, `ARGV[3]` the pending hash's, `ARGV[4]` the `EXPIREAT` second of the day set and
 * the visitors' hash, `ARGV[5]` the HyperLogLog's seconds, `ARGV[6]` the day token, `ARGV[7]` the device token,
 * `ARGV[8]` the most devices one visitor adds to one item in a day (`0` with no visitor: no cap) and `ARGV[9]` the
 * visitor's day token (empty with no visitor); then, for item i, `ARGV[8 + 2i]` is its field (`post:<id>`) and
 * `ARGV[9 + 2i]` its mode, `once` (a post or story: once a device a day) or `every` (a file: at every note).
 *
 * A device that is new to an item's day set is counted only while the visitor's count in the item's visitors'
 * hash is below the cap; at the cap the item counts 0 for this note: no day-set entry, no increment of the
 * visitor, no pending increment, no HyperLogLog. Otherwise the device joins the day set, the visitor's count goes
 * up by one (the hash's expiry is set with the day set's), and the view is counted. Answers
 * `{'replay'|'reused'|'counted', counted}`.
 */
export const NOTE_SCRIPT = `
local held = redis.call('GET', KEYS[1])
if held then
  if held == ARGV[1] then return {'replay', 0} end
  return {'reused', 0}
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
local cap = tonumber(ARGV[8])
local counted = 0
for i = 1, (#KEYS - 2) / 3 do
  local seen, uniq, visitors = KEYS[3 * i], KEYS[3 * i + 1], KEYS[3 * i + 2]
  local field, mode = ARGV[8 + 2 * i], ARGV[9 + 2 * i]
  local fresh = 1
  if mode == 'once' then
    fresh = 0
    if redis.call('SISMEMBER', seen, ARGV[6]) == 0 then
      local capped = false
      if cap > 0 then
        capped = (tonumber(redis.call('HGET', visitors, ARGV[9])) or 0) >= cap
      end
      if not capped then
        redis.call('SADD', seen, ARGV[6])
        redis.call('EXPIREAT', seen, ARGV[4])
        if cap > 0 then
          redis.call('HINCRBY', visitors, ARGV[9], 1)
          redis.call('EXPIREAT', visitors, ARGV[4])
        end
        fresh = 1
      end
    end
  end
  if fresh == 1 then
    redis.call('HINCRBY', KEYS[2], field, 1)
    redis.call('PFADD', uniq, ARGV[7])
    redis.call('EXPIRE', uniq, ARGV[5])
    counted = counted + 1
  end
end
if counted > 0 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
return {'counted', counted}
`;

/**
 * The take script. `KEYS[1]` is the pending hash; `ARGV[1]` is `all` (the whole hash, then deleted) or `some`
 * (only the fields after it, then deleted from the hash). A mode is always named, so an empty request can
 * never take the whole hash. Answers the taken fields and their counts, flat: `field, count, field, count…`.
 */
export const TAKE_SCRIPT = `
if ARGV[1] == 'all' then
  local all = redis.call('HGETALL', KEYS[1])
  if #all > 0 then redis.call('DEL', KEYS[1]) end
  return all
end
local fields = {}
for i = 2, #ARGV do fields[#fields + 1] = ARGV[i] end
if #fields == 0 then return {} end
local values = redis.call('HMGET', KEYS[1], unpack(fields))
local taken, names = {}, {}
for i = 1, #fields do
  if values[i] then
    taken[#taken + 1] = fields[i]
    taken[#taken + 1] = values[i]
    names[#names + 1] = fields[i]
  end
end
if #names > 0 then redis.call('HDEL', KEYS[1], unpack(names)) end
return taken
`;

// ---- Items and fields ----

const FIELD = /^(post|story|file):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The pending hash's field for an item: `post:<id>`. */
export function fieldOf(kind: ViewKind, id: string): string {
  if (!VIEW_KINDS.includes(kind)) {
    throw new TypeError(`A view's kind is post, story or file, not ${String(kind)}`);
  }
  return `${kind}:${idOrThrow(id, 'An item ID')}`;
}

/** The item a field names, or null when it isn't `post|story|file:<lower-case uuid>`. */
export function itemOf(field: string): ViewItem | null {
  const found = typeof field === 'string' ? FIELD.exec(field) : null;
  return found ? { kind: found[1] as ViewKind, id: found[2] as string } : null;
}

// ---- Days ----

/** The UTC day as the digits of its date, `20261117`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10).replaceAll('-', '');
}

/** The epoch second a day's set expires at: the next 00:00 UTC, plus `SEEN_MARGIN_SECONDS`. */
export function seenUntil(at: Date): number {
  const nextMidnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return nextMidnight / 1000 + SEEN_MARGIN_SECONDS;
}

// ---- Tokens ----

/**
 * The first 32 hex characters of the HMAC-SHA256 of `text`, keyed with `secret`; with no secret (a Mac
 * without `SOCIAL_JOBS_SECRET`), of the SHA-256 of it. Either way what is kept is never the text itself.
 */
function digestOf(secret: string | undefined, text: string): string {
  const hash = secret ? createHmac('sha256', secret) : createHash('sha256');
  return hash.update(text, 'utf8').digest('hex').slice(0, 32);
}

/**
 * The tokens of a view (decision 2): `member` is the HMAC of `social-view-day\n<yyyymmdd>\n<device>` (the
 * day's set: two days' tokens can't be linked), `element` is `d:` and the HMAC of
 * `social-view-device\n<device>` (the HyperLogLog's element: the same across days, so a returning
 * device is one unique reader), and `visitor` is the HMAC of `social-view-visitor\n<yyyymmdd>\n<visitor>`, the
 * name of the counter that caps one address's views of one item for the day (null with no `visitor`: no cap).
 * `visitor` is the visitor key of `address.ts` (a normalised address, or `none`); it only goes into the hash, and
 * only a keyed one: with no `secret` there is no visitor token at all and so no cap (a hash of a day and an
 * address with no key could be undone by trying every address). The device's tokens may be plain SHA-256 with no
 * secret: a device ID is 128 random bits.
 */
export function viewTokens(
  secret: string | undefined,
  device: string,
  at: Date,
  visitor: string | null = null,
): ViewTokens {
  const day = utcDay(at);
  return {
    member: digestOf(secret, `social-view-day\n${day}\n${device}`),
    element: `d:${digestOf(secret, `social-view-device\n${device}`)}`,
    // Never an unkeyed hash of an address (a day and an address could be tried one by one), so no secret, no cap.
    visitor: visitor && secret ? digestOf(secret, `social-view-visitor\n${day}\n${visitor}`) : null,
  };
}

/**
 * The element a file read adds to the file's HyperLogLog: `a:<agentId>` for a posting key's read, or `i:` and
 * the HMAC of the caller's address for a keyless one (so no address is kept); null when it is neither. With no
 * secret there is none for an address: a hash of an address with no key could be undone by trying every address.
 */
export function readerToken(
  secret: string | undefined,
  reader: { agentId: string | null; address: string | null },
): string | null {
  if (reader.agentId) return `a:${reader.agentId}`;
  if (reader.address && secret) {
    return `i:${digestOf(secret, `social-file-reader\n${reader.address}`)}`;
  }
  return null;
}

/**
 * A note's fingerprint: the first 32 hex characters of the SHA-256 of its device token and its items, in the
 * note's order. The same request ID with the same note is a retry; with another, a reused ID.
 */
export function fingerprintOf(element: string, items: readonly ViewItem[]): string {
  const list = items.map((item) => fieldOf(item.kind, item.id)).join(',');
  return createHash('sha256').update(`${element}\n${list}`, 'utf8').digest('hex').slice(0, 32);
}

// ---- The calls ----

/** A UTC day as the digits of its date, `20261117`. */
function dayOrThrow(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new TypeError('A day is eight digits, such as 20261117');
  return value;
}

/**
 * An item's visitors' hash for a UTC day (`vcap:v1:<yyyymmdd>:<kind>-<id>`): the field is a visitor day token, the
 * value the devices that visitor has added to the item that day. No visitor, address or token is in the name.
 */
export function visitorCapKey(prefix: string, utcDay: string, kind: ViewKind, id: string): string {
  if (!VIEW_KINDS.includes(kind)) {
    throw new TypeError(`A view's kind is post, story or file, not ${String(kind)}`);
  }
  return redisKey(
    prefix,
    'vcap',
    'v1',
    dayOrThrow(utcDay),
    `${kind}-${idOrThrow(id, 'An item ID')}`,
  );
}

/**
 * The note script's keys and arguments (see `NOTE_SCRIPT` for their order). Every name is `socialRedis`'s or
 * `visitorCapKey`'s, under the environment's prefix; the request ID is written in lower case; a file's day set and
 * visitors' hash are built but never written. Every item has three keys, with or without a visitor; with none the
 * cap is `0` and the visitor's token empty, so the hash is never read or written. The device and the visitor are
 * never among them, only their tokens.
 */
export function noteCall(
  prefix: string,
  note: { requestId: string; items: readonly ViewItem[] },
  tokens: ViewTokens,
  at: Date,
  fingerprint: string,
): ScriptCall {
  const day = utcDay(at);
  const keys = [
    socialRedis.note.key(prefix, note.requestId.toLowerCase()),
    socialRedis.counts.key(prefix),
  ];
  const args = [
    fingerprint,
    String(NOTE_SECONDS),
    String(PENDING_SECONDS),
    String(seenUntil(at)),
    String(UNIQUE_SECONDS),
    tokens.member,
    tokens.element,
    String(tokens.visitor === null ? 0 : VISITOR_DAILY_CAP),
    tokens.visitor ?? '',
  ];
  for (const item of note.items) {
    keys.push(
      socialRedis.seen.key(prefix, day, item.kind, item.id),
      socialRedis.unique.key(prefix, item.kind, item.id),
      visitorCapKey(prefix, day, item.kind, item.id),
    );
    args.push(fieldOf(item.kind, item.id), item.kind === 'file' ? 'every' : 'once');
  }
  return { keys, args };
}

/** What the note script answered. */
export type NoteOutcome = { status: 'counted' | 'replay' | 'reused'; counted: number };

/**
 * The note script's answer, checked: `[status, counted]`, each value read as text and as a number (Upstash's
 * client parses what it can). Any other shape is a TypeError, which never quotes it.
 */
export function noteOutcome(raw: unknown): NoteOutcome {
  if (Array.isArray(raw) && raw.length === 2) {
    const status = String(raw[0]);
    const counted = Number(raw[1]);
    if (
      (status === 'counted' || status === 'replay' || status === 'reused') &&
      Number.isSafeInteger(counted) &&
      counted >= 0
    ) {
      return { status, counted };
    }
  }
  throw new TypeError("Redis's answer to a view note isn't [counted, replay or reused, a count]");
}

/**
 * The take script's keys and arguments: `all` takes the whole pending hash; a list of fields takes only
 * those (`some`). An empty list is null: there is nothing to take, and a call is never made for it.
 */
export function takeCall(prefix: string, fields: readonly string[] | 'all'): ScriptCall | null {
  const keys = [socialRedis.counts.key(prefix)];
  if (fields === 'all') return { keys, args: ['all'] };
  if (fields.length === 0) return null;
  return { keys, args: ['some', ...fields] };
}

/** What a take gave: each field with its count, and how many entries it dropped as malformed. */
export type Taken = { taken: Map<string, number>; dropped: number };

/**
 * The take script's flat answer (`field, count, field, count…`), checked entry by entry: a field `itemOf`
 * refuses, or a count that isn't a whole number from 1, is dropped and counted. Each value is read as text
 * and as a number, as the client may have parsed it. Anything that isn't a list is a TypeError.
 */
export function takenOf(raw: unknown): Taken {
  if (!Array.isArray(raw)) throw new TypeError("Redis's answer to a take isn't a list");
  const taken = new Map<string, number>();
  let dropped = 0;
  for (let at = 0; at < raw.length; at += 2) {
    const field = String(raw[at]);
    const count = at + 1 < raw.length ? Number(raw[at + 1]) : Number.NaN;
    if (itemOf(field) === null || !Number.isSafeInteger(count) || count < 1) {
      dropped += 1;
      continue;
    }
    taken.set(field, (taken.get(field) ?? 0) + count);
  }
  return { taken, dropped };
}

/** An agent's HyperLogLog of unique readers: the union of its posts' (`views`) or its files' (`reads`). */
export function agentUniqueKey(prefix: string, what: 'views' | 'reads', agentId: string): string {
  return redisKey(prefix, 'uniq', 'v1', `agent-${what}`, idOrThrow(agentId, 'An agent ID'));
}
