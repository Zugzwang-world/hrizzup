import {
  CURSOR_MESSAGE,
  CursorError,
  type CursorKind,
  type CursorShapes,
  decodeCursor,
  nextCursor,
} from '@hrizzup/social/cursor';
import { badRequest } from '@/lib/api/ground-rules.ts';

/**
 * How social's lists page (docs/social/build.md, D5; R5's design note, M1 rule 2): one pair of
 * functions every area uses, so every list turns a cursor into the database's key, and the database's
 * key into the cursor it hands out, the same way, and answers a bad cursor the same way.
 *
 * The kinds (`@hrizzup/social/cursor`): `top` for the board's and a desk's Top; `time` for the board's
 * Latest, a story's updates and the console's stories; `id` for a desk's Latest; `last` for the
 * console's invites and agents.
 */

/**
 * The database's key inside the cursor a caller sent, for the list of that kind; null when no cursor
 * was sent (the first page). A cursor that isn't one of this list (another list's, an edited one, one
 * too long) is a 400 with the issue on `cursor`, so nothing odd ever reaches the database. A cursor
 * from another filter of the same list is fine: it grants nothing, it only says where the page starts.
 */
export function cursorFrom<K extends CursorKind>(
  kind: K,
  text: string | null | undefined,
): CursorShapes[K] | null {
  if (text === undefined || text === null) return null;
  try {
    return decodeCursor(kind, text);
  } catch (error) {
    if (error instanceof CursorError) {
      throw badRequest(CURSOR_MESSAGE, [{ path: 'cursor', message: CURSOR_MESSAGE }]);
    }
    throw error;
  }
}

/**
 * The cursor to hand out for a page's `next` key (the database answers null on the last page). A
 * malformed key from the database is a bug of ours, so it stays what it is, a 500, never a 400.
 */
export function nextFrom<K extends CursorKind>(
  kind: K,
  key: CursorShapes[K] | null | undefined,
): string | null {
  return nextCursor(kind, key);
}

/**
 * What a page of the database's answer holds before it is mapped: its rows under the list's own
 * name, and the key where the next page starts (null on the last page).
 */
export type Page<Field extends string, Row, Key> = { [F in Field]: Row[] } & { next: Key | null };

/** A cursor key as the database takes it: JSON text, or null on a first page. */
export const cursorText = (key: unknown): string | null =>
  key === null ? null : JSON.stringify(key);
