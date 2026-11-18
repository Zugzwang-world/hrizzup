import { decodeCursor } from '@hrizzup/social/cursor';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Who made a story (console-made-by.ts): one read of the console's list of stories, started by a cursor at the time
 * the story was listed, however old the story is. The list is stood in for here by one that pages as the database's
 * does: newest listed first, by `(listed_at, id) < (t, i)`, at most 100 to a page, with its cursor decoded by the
 * very code the API decodes it with.
 */

type Row = { id: string; madeBy: 'console' | 'pipeline'; listedAt: string };
let rows: Row[] = [];
const reads: { limit: number; cursor?: string }[] = [];

const list = vi.fn(async (input: { limit: number; cursor?: string }) => {
  reads.push(input);
  const key = input.cursor ? decodeCursor('time', input.cursor) : null;
  const after = rows
    .filter((row) => {
      if (!key) return true;
      const [t, i] = [Date.parse(row.listedAt), Date.parse(key.t)];
      return t < i || (t === i && row.id < key.i);
    })
    .sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt) || (a.id < b.id ? 1 : -1));
  return {
    stories: after
      .slice(0, Math.min(input.limit, 100))
      .map((row) => ({ id: row.id, madeBy: row.madeBy })),
    next: null,
  };
});

vi.mock('@/lib/api/server.ts', () => ({ serverApi: { admin: { social: { stories: { list } } } } }));

const { listingCursor, madeByOf } = await import('./console-made-by.ts');

const id = (n: number) => `019a6b3c-${n.toString(16).padStart(4, '0')}-7000-8000-000000000000`;
const at = (iso: string, seconds: number) =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString();
const MADE = '2026-11-10T08:00:00.000000Z';

afterEach(() => {
  rows = [];
  reads.length = 0;
  list.mockClear();
});

describe('who made a story', () => {
  it('is found with one read of the list for a console-made story behind 500 newer ones, listed a few seconds after its record’s time', async () => {
    rows = [
      { id: id(1), madeBy: 'console', listedAt: at(MADE, 7) },
      ...Array.from({ length: 500 }, (_, n) => ({
        id: id(1000 + n),
        madeBy: n % 2 === 0 ? ('pipeline' as const) : ('console' as const),
        listedAt: at(MADE, 3600 + n),
      })),
    ];
    expect(await madeByOf({ id: id(1), createdAt: MADE })).toBe('console');
    expect(list).toHaveBeenCalledTimes(1);
    expect(reads[0]?.limit).toBe(100);
  });

  it('answers pipeline for a pipeline story listed in the same window', async () => {
    rows = [
      { id: id(2), madeBy: 'pipeline', listedAt: at(MADE, 40) },
      { id: id(3), madeBy: 'console', listedAt: at(MADE, 5) },
    ];
    expect(await madeByOf({ id: id(2), createdAt: MADE })).toBe('pipeline');
    expect(await madeByOf({ id: id(3), createdAt: MADE })).toBe('console');
  });

  it('is not known for a story that is not among the first of the list: listed long after its record, or not at all', async () => {
    rows = [
      { id: id(4), madeBy: 'pipeline', listedAt: at(MADE, 3 * 3600) },
      { id: id(5), madeBy: 'console', listedAt: at(MADE, 30) },
    ];
    expect(await madeByOf({ id: id(4), createdAt: MADE })).toBeNull();
    expect(await madeByOf({ id: id(9), createdAt: MADE })).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('is not known, with no read at all, when the story’s time is not a time', async () => {
    expect(await madeByOf({ id: id(6), createdAt: 'not a time' })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('hides a story behind more than a page listed after it in the same two minutes', async () => {
    // 150 stories listed in the window after the story's record: those listed after the story but before the cursor's time come first.
    rows = [
      { id: id(7), madeBy: 'console', listedAt: at(MADE, 10) },
      ...Array.from({ length: 150 }, (_, n) => ({
        id: id(2000 + n),
        madeBy: 'pipeline' as const,
        listedAt: at(MADE, 11 + n * 0.5),
      })),
    ];
    // Documented limit: more than a page of stories listed after this one, in the same two minutes, hide it.
    expect(await madeByOf({ id: id(7), createdAt: MADE })).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('the cursor of that read', () => {
  it('is a time cursor of the list, its t two minutes after the story’s time and its i the story’s own ID', () => {
    const cursor = listingCursor({ id: id(1), createdAt: MADE });
    expect(cursor).not.toBeNull();
    const key = decodeCursor('time', cursor);
    expect(Date.parse(key.t)).toBe(Date.parse(MADE) + 2 * 60_000);
    expect(key.i).toBe(id(1));
  });

  it('writes the time as the database prints it: to what the story’s time had, no trailing zeros', () => {
    expect(
      decodeCursor('time', listingCursor({ id: id(1), createdAt: '2026-11-18T10:00:00Z' })).t,
    ).toBe('2026-11-18T10:02:00Z');
    expect(
      decodeCursor('time', listingCursor({ id: id(1), createdAt: '2026-11-18T10:00:00.120Z' })).t,
    ).toBe('2026-11-18T10:02:00.12Z');
    expect(
      decodeCursor('time', listingCursor({ id: id(1), createdAt: '2026-11-18T23:59:30.5Z' })).t,
    ).toBe('2026-11-19T00:01:30.5Z');
  });

  it('is none for a time that is not one', () => {
    expect(listingCursor({ id: id(1), createdAt: '' })).toBeNull();
  });
});
