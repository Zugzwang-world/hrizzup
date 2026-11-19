/**
 * What a view is, as the page decides it (docs/social/r11-design.md, decision 1 and section 3.8): pure
 * rules, with no DOM and nothing imported, so the page's sender (`components/sandbox/social/view-sender.ts`,
 * which only a browser runs) and the tests (in Node) read the same ones, and the journey can use them too.
 *
 * An item is *on screen* when at least half of it is in the viewport, or when the visible part of it covers at
 * least half the viewport's height (a post taller than the screen). A view is counted once the item has been on
 * screen for a second without a break, while the page is visible.
 */

/** How long an item stays on screen, without a break, before it is a view. */
export const DWELL_MS = 1_000;
/** How long after the first item is queued the page sends its note. */
export const FLUSH_MS = 10_000;
/** Where a note goes: the contract's `POST /social/views`. */
export const ENDPOINT = '/api/v1/social/views';
/** The most items one note holds (the contract's limit). */
export const NOTE_ITEMS = 50;
/** Where the browser keeps the device's random ID. */
export const DEVICE_KEY = 'hrizzup.device.v1';
/** The slowest a retry may wait, even when the server asks for longer. */
export const RETRY_MAX_MS = 60_000;
/** How long a retry waits when the server doesn't say. */
export const RETRY_DEFAULT_MS = 10_000;

/**
 * The thresholds the page's observer reports at: 0 to 1 in steps of 0.05 (21 values), so a post up to 20
 * screens tall still reports once it covers half the screen.
 */
export const THRESHOLDS: readonly number[] = Array.from({ length: 21 }, (_, step) => step / 20);

/** What an intersection observer's entry says, as far as the rules need it. */
export type EntryLike = {
  isIntersecting: boolean;
  intersectionRatio: number;
  intersectionRect: { height: number };
  rootBounds: { height: number } | null;
};

/** Whether the item is on screen: half of it, or half of the screen's height of it (the screen's height is `fallbackHeight` where the observer gave no root bounds). */
export function isOnScreen(entry: EntryLike, fallbackHeight: number): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= 0.5) return true;
  return entry.intersectionRect.height >= 0.5 * (entry.rootBounds?.height ?? fallbackHeight);
}

/** What a note is about: a post, a story or a file. */
export type ViewItem = { kind: 'post' | 'story' | 'file'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The item a mark names, its ID in lower case; null unless the kind is `post`, `story` or `file` and the ID is a UUID. */
export function viewItemOf(
  kind: string | null | undefined,
  id: string | null | undefined,
): ViewItem | null {
  if (kind !== 'post' && kind !== 'story' && kind !== 'file') return null;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  return { kind, id: id.toLowerCase() };
}

/** Whether a stored text is a device ID: 16 to 64 letters, digits, hyphens and underscores (the contract's own pattern). */
export function isDeviceId(text: unknown): text is string {
  return typeof text === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(text);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A device ID from random bytes: base64url, with no padding (16 bytes make 22 characters). */
export function deviceIdOf(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const group = ((bytes[at] ?? 0) << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0);
    const have = Math.min(3, bytes.length - at);
    for (let n = 0; n <= have; n++) text += ALPHABET[(group >> (18 - 6 * n)) & 63];
  }
  return text;
}

/** A list split into notes of at most `size` items, in order. */
export function batches<T>(items: readonly T[], size: number = NOTE_ITEMS): T[][] {
  const notes: T[][] = [];
  for (let at = 0; at < items.length; at += size) notes.push(items.slice(at, at + size));
  return notes;
}

/** A note's JSON body. */
export function noteBody(requestId: string, device: string, items: readonly ViewItem[]): string {
  return JSON.stringify({ requestId, device, items });
}

/**
 * How long to wait before the one retry of a note the server didn't take, or null for no retry: a 429 waits what
 * `Retry-After` says in seconds (at most 60 seconds; 10 when it is missing or isn't a number), a 500 or more
 * waits 10 seconds, and any other answer (200, 400, 404, 409) is final.
 */
export function retryAfterMs(status: number, retryAfter: string | null | undefined): number | null {
  if (status === 429) {
    const seconds = retryAfter?.trim() ? Number(retryAfter) : Number.NaN;
    if (!Number.isFinite(seconds) || seconds < 0) return RETRY_DEFAULT_MS;
    return Math.min(RETRY_MAX_MS, Math.round(seconds * 1_000));
  }
  if (status >= 500) return RETRY_DEFAULT_MS;
  return null;
}
