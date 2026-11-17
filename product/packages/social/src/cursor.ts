/**
 * Paging cursors for social's lists (docs/social/build.md, D5 and section 4's "As built in M2").
 *
 * Every list pages by key with the API's `cursor`, `limit` and `next`. The database answers a page's
 * `next` as the key of the page's last row (`{r, i}`, `{t, i}`, ...), and the API hands it out as an
 * **opaque cursor**: base64url JSON under 200 characters, sent back exactly as it came. A client never
 * builds one, so what's inside may change.
 *
 * - **A cursor is not signed.** It holds nothing secret and grants nothing: it only says where in a
 *   public list the page starts. What stops a made-up one is that it must have exactly the shape of
 *   the list it is sent to, with every field in its range, in the one form this code writes. Anything
 *   else, a cursor of another list, an edited one, one too long, is refused, and the call answers 400
 *   with an issue on `cursor`. So nothing odd ever reaches the database (a rank too big for its
 *   `bigint`, a date that doesn't exist), where it would be a 500.
 * - **One written form:** the keys in a fixed order, no spaces, base64url with no padding. Decoding
 *   checks that writing the result again gives the very same text.
 * - **No Node-only code,** so a page may import this file (`@hrizzup/social/cursor`).
 */

/** Cursors are under 200 characters (D5), the most the API's `cursor` input takes. */
export const MAX_CURSOR_LENGTH = 199;

/**
 * The shapes, one for each way a list is ordered:
 * - `top`: Top's rank as integer text and the ID, `{r, i}` (the board, a desk's Top);
 * - `time`: a UTC time (the agreement's text, as `markets.utc` writes it) and the ID, `{t, i}`
 *   (Latest, updates, pins, the console's stories);
 * - `standing`: an agent's standing rank as integer text and the ID, `{s, i}`;
 * - `name`: a name and the ID, `{n, i}`;
 * - `forYou`: a For You build's ID and an offset into it, `{b, o}` (docs/social/build.md, section 7.7);
 * - `id`: the ID alone, `{i}` (a desk's Latest, which is in ID order);
 * - `last`: the last ID itself, not wrapped in anything, for the lists in ID order (versions, the
 *   timeline, a post's replies, chats, `agent_posts`, the console's invites and agents), as v1's lists do.
 */
export type CursorShapes = {
  top: { r: string; i: string };
  time: { t: string; i: string };
  standing: { s: string; i: string };
  name: { n: string; i: string };
  forYou: { b: string; o: number };
  id: { i: string };
  last: string;
};
export type CursorKind = keyof CursorShapes;

/** A cursor that isn't one of the list it was sent to: the call answers 400 with an issue on `cursor`. */
export class CursorError extends Error {
  constructor(message = CURSOR_MESSAGE) {
    super(message);
    this.name = 'CursorError';
  }
}

/** What the issue on `cursor` says. */
export const CURSOR_MESSAGE =
  'This cursor is not from this list: send the `next` of the page before, exactly as it came';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BUILD = /^[A-Za-z0-9_-]{1,64}$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/;
const INTEGER_TEXT = /^(?:0|-?[1-9][0-9]{0,18})$/;
const BIGINT_MAX = 2n ** 63n - 1n;
const BIGINT_MIN = -(2n ** 63n);
/** For You builds the board's top 300; an offset past this was never given out. */
const MOST_FOR_YOU_OFFSET = 10_000;
const MOST_NAME_LENGTH = 100;

type Check = (value: unknown) => boolean;

const uuid: Check = (v) => typeof v === 'string' && UUID.test(v);

/** Integer text that fits the database's `bigint` (a `bigint` column is written as text, never a number). */
const bigintText =
  (minimum: bigint): Check =>
  (v) => {
    if (typeof v !== 'string' || !INTEGER_TEXT.test(v)) return false;
    const n = BigInt(v);
    return n >= minimum && n <= BIGINT_MAX;
  };

/** A time as `markets.utc` writes it, that exists (no 31 February), so `::timestamptz` never fails. */
const time: Check = (v) => {
  if (typeof v !== 'string') return false;
  const m = TIME.exec(v);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

/** A name: one line, no control characters, at most 100 characters (a name's own limit is lower). */
const name: Check = (v) => {
  if (typeof v !== 'string' || v.length < 1 || v.length > MOST_NAME_LENGTH) return false;
  for (const character of v) {
    const code = character.codePointAt(0) ?? 0;
    // Controls, and the two line separators.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return false;
    }
  }
  return true;
};

const build: Check = (v) => typeof v === 'string' && BUILD.test(v);
const offset: Check = (v) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MOST_FOR_YOU_OFFSET;

/** Each wrapped shape: its keys in the order they are written, and what each holds. */
const WRAPPED: Record<Exclude<CursorKind, 'last'>, [string, Check][]> = {
  top: [
    ['r', bigintText(BIGINT_MIN)],
    ['i', uuid],
  ],
  time: [
    ['t', time],
    ['i', uuid],
  ],
  standing: [
    ['s', bigintText(0n)],
    ['i', uuid],
  ],
  name: [
    ['n', name],
    ['i', uuid],
  ],
  forYou: [
    ['b', build],
    ['o', offset],
  ],
  id: [['i', uuid]],
};

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * The cursor for a page's `next`: the database's key for the last row, as the API gives it out.
 * Throws a CursorError when the key isn't of the shape (the database's own answer always is, so that
 * is a bug), or when it would be 200 characters or more (D5's limit).
 */
export function encodeCursor<K extends CursorKind>(kind: K, key: CursorShapes[K]): string {
  if (kind === 'last') {
    if (!uuid(key)) throw new CursorError('The last ID of a page must be a UUID');
    return key as string;
  }
  const fields = WRAPPED[kind as Exclude<CursorKind, 'last'>];
  const given = key as unknown;
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    throw new CursorError(`A ${kind} cursor holds an object`);
  }
  const record = given as Record<string, unknown>;
  const names = Object.keys(record);
  if (names.length !== fields.length || fields.some(([field]) => !names.includes(field))) {
    throw new CursorError(`A ${kind} cursor holds exactly ${fields.map(([f]) => f).join(' and ')}`);
  }
  for (const [field, check] of fields) {
    if (!check(record[field])) throw new CursorError(`A ${kind} cursor's ${field} isn't valid`);
  }
  // Written in the shape's own order, whatever order the database's object came in.
  const ordered: Record<string, unknown> = {};
  for (const [field] of fields) ordered[field] = record[field];
  const text = toBase64Url(JSON.stringify(ordered));
  if (text.length > MAX_CURSOR_LENGTH) {
    throw new CursorError(`A ${kind} cursor would be ${text.length} characters: the most is 199`);
  }
  return text;
}

/** The cursor for a page's `next`: null when it is the last page. */
export function nextCursor<K extends CursorKind>(
  kind: K,
  key: CursorShapes[K] | null | undefined,
): string | null {
  return key === null || key === undefined ? null : encodeCursor(kind, key);
}

/**
 * The database's key inside a cursor, for the list of that shape. Throws a CursorError (the call
 * answers 400 with an issue on `cursor`: `CURSOR_MESSAGE`) for anything else: not text, 200
 * characters or more, not base64url, not JSON, another list's shape, a value out of range, or not
 * the one form this code writes.
 */
export function decodeCursor<K extends CursorKind>(kind: K, text: unknown): CursorShapes[K] {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CURSOR_LENGTH) {
    throw new CursorError();
  }
  if (kind === 'last') {
    if (!uuid(text)) throw new CursorError();
    return text as CursorShapes[K];
  }
  if (!BASE64URL.test(text)) throw new CursorError();
  let value: unknown;
  try {
    value = JSON.parse(fromBase64Url(text));
  } catch {
    throw new CursorError();
  }
  const fields = WRAPPED[kind as Exclude<CursorKind, 'last'>];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CursorError();
  const record = value as Record<string, unknown>;
  const names = Object.keys(record);
  if (names.length !== fields.length || fields.some(([field]) => !names.includes(field))) {
    throw new CursorError();
  }
  if (fields.some(([field, check]) => !check(record[field]))) throw new CursorError();
  const key = value as CursorShapes[K];
  // The one written form: a cursor that decodes to the same key in another form isn't ours.
  if (encodeCursor(kind, key) !== text) throw new CursorError();
  return key;
}
