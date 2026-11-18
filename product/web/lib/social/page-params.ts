import { CursorError, type CursorKind, decodeCursor } from '@hrizzup/social/cursor';
import { DEFAULT_SORT, isCategory, isSort, placesFor, type Sort } from '@hrizzup/social/lists';
import { ORPCError } from '@orpc/server';

/**
 * What the sandbox's board and story pages read from the address (docs/social/build.md, section 7.11;
 * R5's M5): each value checked against the same lists and cursors the calls check, so a bad one never
 * reaches a call and the page never answers an error for it. A value that is not one of the list (an
 * unknown filter, a cursor of another list, a name sent twice) is dropped, the page falls back to
 * the default (no filter, the first page) and says so in a plain line, never repeating what was sent.
 * Plain functions with no page in them, so the rules are tested alone (`page-params.test.ts`).
 */

/** What Next.js hands a page for one name in the address: text, a list when it is sent twice, or nothing. */
export type Raw = string | string[] | undefined;
export type Query = Record<string, Raw>;

/** How many a page of each list holds: small, so a page stays short at any text size. */
export const BOARD_PAGE = 20;
export const UPDATES_PAGE = 20;
export const DESK_PAGE = 10;

/** One value of the address, checked: the value when it is one of the list, nothing when none was sent, and `bad` when one was sent that isn't. */
type Picked<T> = { value: T | undefined; bad: boolean };

function pick<T extends string>(raw: Raw, valid: (text: string) => text is T): Picked<T> {
  if (raw === undefined || raw === '') return { value: undefined, bad: false };
  if (typeof raw !== 'string' || !valid(raw)) return { value: undefined, bad: true };
  return { value: raw, bad: false };
}

function pickCursor(kind: CursorKind, raw: Raw): Picked<string> {
  if (raw === undefined || raw === '') return { value: undefined, bad: false };
  if (typeof raw !== 'string') return { value: undefined, bad: true };
  try {
    decodeCursor(kind, raw);
    return { value: raw, bad: false };
  } catch (error) {
    if (error instanceof CursorError) return { value: undefined, bad: true };
    throw error;
  }
}

const isPlaceFilter = (text: string): text is string => placesFor(text) !== null;
const isOrder = (text: string): text is Order => text === 'newest' || text === 'oldest';

const SORT_NOTE = "That order isn't one the board has: showing Top.";
const CATEGORY_NOTE = "That category isn't one the board has: showing every category.";
const PLACE_NOTE = "That place isn't one the board has: showing every place.";
const CURSOR_NOTE = "That page isn't one of this list: showing the first page.";
const ORDER_NOTE = "That order isn't one the timeline has: showing the newest first.";
const DESK_NOTE = "That order isn't one the desk has: showing Top.";
const UPDATES_NOTE = "That page of updates isn't one of this story's: showing the newest.";
const POSTS_NOTE = "That page of posts isn't one of this desk's: showing the first.";

// ---------------------------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------------------------

/** What the board shows: how it is ordered, its filters, and where its page starts; and the lines for what was dropped. */
export type BoardView = {
  sort: Sort;
  /** A category's code, from the lists. */
  category?: string | undefined;
  /** A place's code or a tier, from the lists. */
  place?: string | undefined;
  /** The `next` of the page before: a cursor of this list, in this order. */
  cursor?: string | undefined;
  notes: string[];
};

/** The board's view of an address's query (`sort`, `category`, `place`, `cursor`). */
export function boardView(query: Query): BoardView {
  const sort = pick(query.sort, isSort);
  const category = pick(query.category, isCategory);
  const place = pick(query.place, isPlaceFilter);
  const order: Sort = sort.value ?? DEFAULT_SORT;
  // A cursor only means something in the order it was handed out for (Top's and Latest's differ).
  const cursor = pickCursor(order === 'top' ? 'top' : 'time', query.cursor);
  const notes = [
    ...(sort.bad ? [SORT_NOTE] : []),
    ...(category.bad ? [CATEGORY_NOTE] : []),
    ...(place.bad ? [PLACE_NOTE] : []),
    ...(cursor.bad ? [CURSOR_NOTE] : []),
  ];
  return { sort: order, category: category.value, place: place.value, cursor: cursor.value, notes };
}

/** The address of a board in this state (the default order and no filter write nothing), starting at `cursor`. */
export function boardHref(
  state: Pick<BoardView, 'sort' | 'category' | 'place'>,
  cursor?: string,
): string {
  const query = new URLSearchParams();
  if (state.sort !== DEFAULT_SORT) query.set('sort', state.sort);
  if (state.category) query.set('category', state.category);
  if (state.place) query.set('place', state.place);
  if (cursor) query.set('cursor', cursor);
  const text = query.toString();
  return text ? `/sandbox/social?${text}` : '/sandbox/social';
}

// ---------------------------------------------------------------------------------------------
// A story
// ---------------------------------------------------------------------------------------------

/** How the story's timeline reads: the newest update first (as the call answers) or the oldest. */
export type Order = 'newest' | 'oldest';

/** What a story page shows: the timeline's order and page, the desk's order and page; and the lines for what was dropped. */
export type StoryView = {
  order: Order;
  /** The `next` of the timeline's page before: older updates. */
  updates?: string | undefined;
  /** How the desk is ordered. */
  desk: Sort;
  /** The `next` of the desk's page before. */
  posts?: string | undefined;
  notes: string[];
};

/** A story page's view of an address's query (`order`, `updates`, `desk`, `posts`). */
export function storyView(query: Query): StoryView {
  const order = pick(query.order, isOrder);
  const updates = pickCursor('time', query.updates);
  const desk = pick(query.desk, isSort);
  const deskSort: Sort = desk.value ?? DEFAULT_SORT;
  const posts = pickCursor(deskSort === 'top' ? 'top' : 'id', query.posts);
  const notes = [
    ...(order.bad ? [ORDER_NOTE] : []),
    ...(updates.bad ? [UPDATES_NOTE] : []),
    ...(desk.bad ? [DESK_NOTE] : []),
    ...(posts.bad ? [POSTS_NOTE] : []),
  ];
  return {
    order: order.value ?? 'newest',
    updates: updates.value,
    desk: deskSort,
    posts: posts.value,
    notes,
  };
}

/** The address of a story page in this state (the defaults write nothing). */
export function storyHref(id: string, state: Omit<StoryView, 'notes'>): string {
  const query = new URLSearchParams();
  if (state.order !== 'newest') query.set('order', state.order);
  if (state.updates) query.set('updates', state.updates);
  if (state.desk !== DEFAULT_SORT) query.set('desk', state.desk);
  if (state.posts) query.set('posts', state.posts);
  const text = query.toString();
  return `/sandbox/social/stories/${id}${text ? `?${text}` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// What a call answers when it is refused
// ---------------------------------------------------------------------------------------------

/** Whether a call was refused with this code: `NOT_FOUND` (no such story, or no such call where social is off) or `REFUSED` (a withdrawn story has no brief). */
export function refusedWith(error: unknown, code: 'NOT_FOUND' | 'REFUSED'): boolean {
  return error instanceof ORPCError && error.code === code;
}
