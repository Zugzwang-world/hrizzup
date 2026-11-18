import { encodeCursor } from '@hrizzup/social/cursor';
import { categories, places, tiers } from '@hrizzup/social/lists';
import { ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import {
  boardHref,
  boardView,
  refusedWith,
  type StoryView,
  storyHref,
  storyView,
} from './page-params.ts';

/**
 * What the sandbox's board and story pages read from the address (R5's M5): a value that isn't one
 * of the lists, or a cursor of another list, is dropped with a plain line, and never repeated back.
 */

const ID = '01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07';
const TOP = encodeCursor('top', { r: '12', i: ID });
const TIME = encodeCursor('time', { t: '2026-11-15T05:00:00.000Z', i: ID });
const DESK = encodeCursor('id', { i: ID });

describe('the board’s view', () => {
  it('is Top, with no filter and the first page, when the address says nothing', () => {
    expect(boardView({})).toEqual({
      sort: 'top',
      category: undefined,
      place: undefined,
      cursor: undefined,
      notes: [],
    });
  });

  it('takes every category, every place and every tier of the lists, and both orders', () => {
    for (const category of categories) {
      expect(boardView({ category: category.code }).category).toBe(category.code);
    }
    for (const place of [...places, ...tiers]) {
      const view = boardView({ place: place.code });
      expect(view.place, place.code).toBe(place.code);
      expect(view.notes, place.code).toEqual([]);
    }
    expect(boardView({ sort: 'latest' }).sort).toBe('latest');
    expect(boardView({ sort: 'top' }).sort).toBe('top');
  });

  it('takes a cursor of the order the board is in, and drops one of the other', () => {
    expect(boardView({ cursor: TOP })).toMatchObject({ cursor: TOP, notes: [] });
    expect(boardView({ sort: 'latest', cursor: TIME })).toMatchObject({ cursor: TIME, notes: [] });
    expect(boardView({ cursor: TIME }).cursor).toBeUndefined();
    expect(boardView({ sort: 'latest', cursor: TOP }).cursor).toBeUndefined();
    expect(boardView({ cursor: TIME }).notes).toHaveLength(1);
  });

  it('drops each bad value on its own, saying so once each, and never repeats what was sent', () => {
    const sent = 'some<script>made-up value';
    const view = boardView({ sort: sent, category: sent, place: sent, cursor: sent });
    expect(view).toMatchObject({
      sort: 'top',
      category: undefined,
      place: undefined,
      cursor: undefined,
    });
    expect(view.notes).toHaveLength(4);
    expect(view.notes.join(' ')).not.toContain(sent);
    // One bad filter leaves the others as they were.
    expect(boardView({ category: 'ai', place: sent })).toMatchObject({
      category: 'ai',
      place: undefined,
    });
    expect(boardView({ category: sent, place: 'india' })).toMatchObject({
      category: undefined,
      place: 'india',
    });
  });

  it('takes a name sent twice for a bad value, and an empty one for none', () => {
    expect(boardView({ category: ['ai', 'sports'] }).notes).toHaveLength(1);
    expect(boardView({ cursor: [TOP, TOP] }).cursor).toBeUndefined();
    expect(boardView({ category: '', place: '', sort: '', cursor: '' }).notes).toEqual([]);
  });

  it('takes what is neither a cursor nor a place, however it is spelt, for bad', () => {
    for (const text of ['  ', 'AI', 'Global', 'toString', '__proto__', 'constructor', '%00', '0']) {
      const view = boardView({ category: text, place: text });
      expect(view.category, text).toBeUndefined();
      expect(view.place, text).toBeUndefined();
    }
    expect(boardView({ cursor: 'x'.repeat(5000) }).cursor).toBeUndefined();
  });
});

describe('the board’s addresses', () => {
  it('write nothing for the defaults, and only what differs from them otherwise', () => {
    expect(boardHref({ sort: 'top' })).toBe('/sandbox/social');
    expect(boardHref({ sort: 'latest' })).toBe('/sandbox/social?sort=latest');
    expect(boardHref({ sort: 'top', category: 'ai', place: 'local' })).toBe(
      '/sandbox/social?category=ai&place=local',
    );
    expect(boardHref({ sort: 'latest', category: 'ai' }, TIME)).toBe(
      `/sandbox/social?sort=latest&category=ai&cursor=${TIME}`,
    );
  });

  it('read back as the view they were written from', () => {
    for (const state of [
      { sort: 'top', category: 'sports', place: 'mumbai' },
      { sort: 'latest', category: undefined, place: 'national' },
    ] as const) {
      const cursor = state.sort === 'top' ? TOP : TIME;
      const query = Object.fromEntries(
        new URL(boardHref(state, cursor), 'https://x.test').searchParams,
      );
      expect(boardView(query)).toEqual({ ...state, cursor, notes: [] });
    }
  });
});

describe('a story’s view', () => {
  it('is the newest first, Top, and the first pages, when the address says nothing', () => {
    expect(storyView({})).toEqual({
      order: 'newest',
      updates: undefined,
      desk: 'top',
      posts: undefined,
      notes: [],
    });
  });

  it('takes each cursor in the order of its own list, and drops one of another list', () => {
    expect(storyView({ updates: TIME, posts: TOP })).toMatchObject({ updates: TIME, posts: TOP });
    expect(storyView({ desk: 'latest', posts: DESK })).toMatchObject({
      desk: 'latest',
      posts: DESK,
    });
    // A desk's Latest pages by ID alone, its Top by rank and ID; the timeline by time.
    expect(storyView({ posts: DESK }).posts).toBeUndefined();
    expect(storyView({ desk: 'latest', posts: TOP }).posts).toBeUndefined();
    expect(storyView({ updates: TOP }).updates).toBeUndefined();
  });

  it('drops each bad value on its own, saying so once each, and never repeats what was sent', () => {
    const sent = 'some<script>made-up value';
    const view = storyView({ order: sent, updates: sent, desk: sent, posts: sent });
    expect(view).toMatchObject({
      order: 'newest',
      updates: undefined,
      desk: 'top',
      posts: undefined,
    });
    expect(view.notes).toHaveLength(4);
    expect(view.notes.join(' ')).not.toContain(sent);
    expect(storyView({ order: 'oldest', desk: ['top', 'latest'] })).toMatchObject({
      order: 'oldest',
      desk: 'top',
    });
    expect(storyView({ order: ['oldest'] }).order).toBe('newest');
  });
});

describe('a story’s addresses', () => {
  const base: Omit<StoryView, 'notes'> = {
    order: 'newest',
    updates: undefined,
    desk: 'top',
    posts: undefined,
  };

  it('write nothing for the defaults, and keep every other choice when one changes', () => {
    expect(storyHref(ID, base)).toBe(`/sandbox/social/stories/${ID}`);
    expect(storyHref(ID, { ...base, order: 'oldest', desk: 'latest' })).toBe(
      `/sandbox/social/stories/${ID}?order=oldest&desk=latest`,
    );
    expect(storyHref(ID, { ...base, updates: TIME, posts: TOP })).toBe(
      `/sandbox/social/stories/${ID}?updates=${TIME}&posts=${TOP}`,
    );
  });

  it('read back as the view they were written from', () => {
    const state = { order: 'oldest', updates: TIME, desk: 'latest', posts: DESK } as const;
    const query = Object.fromEntries(new URL(storyHref(ID, state), 'https://x.test').searchParams);
    expect(storyView(query)).toEqual({ ...state, notes: [] });
  });
});

describe('what a call is refused with', () => {
  it('is told by the code, and only for the API’s own errors', () => {
    const missing = new ORPCError('NOT_FOUND', { status: 404, message: 'No such story' });
    expect(refusedWith(missing, 'NOT_FOUND')).toBe(true);
    expect(refusedWith(missing, 'REFUSED')).toBe(false);
    expect(refusedWith(new Error('NOT_FOUND'), 'NOT_FOUND')).toBe(false);
    expect(refusedWith('NOT_FOUND', 'NOT_FOUND')).toBe(false);
    expect(refusedWith(undefined, 'REFUSED')).toBe(false);
  });
});
