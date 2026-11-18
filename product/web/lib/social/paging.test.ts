import { CursorError, encodeCursor } from '@hrizzup/social/cursor';
import { ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { cursorFrom, nextFrom } from './paging.ts';

const ID = '01a1a57b-8ca0-7c96-8905-93eb7d0b0d54';
const KEYS = {
  top: { r: '2878129044800', i: ID },
  time: { t: '2026-11-02T09:40:00Z', i: ID },
  id: { i: ID },
  last: ID,
} as const;

describe('turning a cursor into the database’s key', () => {
  it('answers null when no cursor was sent', () => {
    expect(cursorFrom('top', undefined)).toBeNull();
    expect(cursorFrom('time', null)).toBeNull();
  });

  it('answers the key inside a cursor of the list’s own kind, for each kind the lists use', () => {
    expect(cursorFrom('top', encodeCursor('top', KEYS.top))).toEqual(KEYS.top);
    expect(cursorFrom('time', encodeCursor('time', KEYS.time))).toEqual(KEYS.time);
    expect(cursorFrom('id', encodeCursor('id', KEYS.id))).toEqual(KEYS.id);
    expect(cursorFrom('last', encodeCursor('last', KEYS.last))).toBe(KEYS.last);
  });

  it('refuses anything that is not that list’s cursor with a 400 and one issue, on `cursor`', () => {
    const refused = (kind: 'top' | 'time' | 'id' | 'last', text: string) => {
      try {
        cursorFrom(kind, text);
      } catch (error) {
        return error;
      }
      throw new Error(`${text} was taken as a ${kind} cursor`);
    };
    for (const [kind, text] of [
      ['top', 'not a cursor'],
      ['top', ''],
      ['top', encodeCursor('time', KEYS.time)],
      ['time', encodeCursor('top', KEYS.top)],
      ['id', encodeCursor('top', KEYS.top)],
      ['last', encodeCursor('id', KEYS.id)],
      ['top', 'a'.repeat(200)],
    ] as const) {
      const error = refused(kind, text);
      expect(error, text).toBeInstanceOf(ORPCError);
      expect(error, text).toMatchObject({
        code: 'BAD_REQUEST',
        status: 400,
        data: { issues: [{ path: 'cursor' }] },
      });
    }
  });
});

describe('turning the database’s key into the cursor handed out', () => {
  it('answers null on the last page, and the cursor otherwise, which comes back as the same key', () => {
    expect(nextFrom('top', null)).toBeNull();
    expect(nextFrom('top', undefined)).toBeNull();
    for (const kind of ['top', 'time', 'id', 'last'] as const) {
      const cursor = nextFrom(kind, KEYS[kind] as never);
      expect(cursor, kind).toBe(encodeCursor(kind, KEYS[kind] as never));
      expect(cursorFrom(kind, cursor), kind).toEqual(KEYS[kind]);
    }
  });

  it('stays a plain error, which the route answers as a 500, for a key the database should never make', () => {
    let error: unknown;
    try {
      nextFrom('top', { r: 'not a rank', i: ID });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CursorError);
    expect(error).not.toBeInstanceOf(ORPCError);
  });
});
