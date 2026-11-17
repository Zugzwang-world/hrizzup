import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CURSOR_MESSAGE,
  CursorError,
  type CursorKind,
  type CursorShapes,
  decodeCursor,
  encodeCursor,
  MAX_CURSOR_LENGTH,
  nextCursor,
} from './cursor.ts';

const ID = '01a1e8e0-a980-7b94-99cf-b43959d7d740';
const OTHER = '01a1e7c2-4b00-7d2e-9f3a-4b5c6d7e8f90';

/** One good key for every shape. */
const KEYS: { [K in CursorKind]: CursorShapes[K] } = {
  top: { r: '28781290448', i: ID },
  time: { t: '2026-11-17T04:10:00Z', i: ID },
  standing: { s: '2330000', i: ID },
  name: { n: 'Timeline', i: ID },
  forYou: { b: '7f3e9a21', o: 20 },
  id: { i: ID },
  last: ID,
};
const KINDS = Object.keys(KEYS) as CursorKind[];

/** Text as base64url JSON, the way a client could make one by hand. */
function handMade(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function refused(kind: CursorKind, text: unknown) {
  expect(() => decodeCursor(kind, text)).toThrow(CursorError);
}

describe('cursors round-trip', () => {
  it.each(KINDS)('a %s cursor decodes to the key it was made from', (kind) => {
    const text = encodeCursor(kind, KEYS[kind]);
    expect(decodeCursor(kind, text)).toEqual(KEYS[kind]);
    expect(text.length).toBeLessThanOrEqual(MAX_CURSOR_LENGTH);
  });

  it('is opaque base64url JSON, apart from the last ID itself', () => {
    const text = encodeCursor('top', KEYS.top);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(text, 'base64url').toString())).toEqual(KEYS.top);
    expect(encodeCursor('last', ID)).toBe(ID);
  });

  it("writes each shape's keys in its own order, whatever order the database's object came in", () => {
    const text = encodeCursor('top', { i: ID, r: '5' } as CursorShapes['top']);
    expect(Buffer.from(text, 'base64url').toString()).toBe(`{"r":"5","i":"${ID}"}`);
    expect(text).toBe(encodeCursor('top', { r: '5', i: ID }));
  });

  it('keeps a rank as text: a bigint never passes through a number', () => {
    const key = { r: '9223372036854775807', i: ID };
    expect(decodeCursor('top', encodeCursor('top', key))).toEqual(key);
    expect(decodeCursor('top', encodeCursor('top', { r: '-5', i: ID }))).toEqual({
      r: '-5',
      i: ID,
    });
  });

  it('gives null for the last page', () => {
    expect(nextCursor('top', null)).toBeNull();
    expect(nextCursor('time', undefined)).toBeNull();
    expect(nextCursor('top', KEYS.top)).toBe(encodeCursor('top', KEYS.top));
  });

  it('reads back every cursor in the example data, writing the very same text', () => {
    const folder = new URL('../../api/src/social/examples/', import.meta.url);
    const found: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        for (const [key, item] of Object.entries(value)) {
          if (key === 'next' && typeof item === 'string') found.push(item);
          else walk(item);
        }
      }
    };
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.json'))) {
      walk(JSON.parse(readFileSync(new URL(file, folder), 'utf8')));
    }
    expect(found.length).toBeGreaterThanOrEqual(8);
    for (const text of found) {
      // Each belongs to exactly one list's shape.
      const kinds = KINDS.filter((kind) => {
        try {
          decodeCursor(kind, text);
          return true;
        } catch {
          return false;
        }
      });
      expect(kinds, text).toHaveLength(1);
      const [kind] = kinds as [CursorKind];
      expect(encodeCursor(kind, decodeCursor(kind, text))).toBe(text);
    }
  });
});

describe("a cursor that isn't its list's is refused", () => {
  it('refuses a cursor made for another list', () => {
    for (const from of KINDS) {
      for (const to of KINDS) {
        if (from !== to) refused(to, encodeCursor(from, KEYS[from]));
      }
    }
  });

  it('refuses a cursor with a key too many, a key too few or a key of another name', () => {
    refused('top', handMade({ r: '5', i: ID, x: 1 }));
    refused('top', handMade({ r: '5' }));
    refused('top', handMade({ r: '5', j: ID }));
    refused('id', handMade({ i: ID, o: 1 }));
    refused('top', handMade({}));
  });

  it('refuses text that is not base64url JSON of an object', () => {
    refused('top', '');
    refused('top', 'not a cursor');
    refused('top', 'bm90IGpzb24'); // not JSON
    refused('top', handMade([ID]));
    refused('top', handMade(null));
    refused('top', handMade('text'));
    refused('top', handMade(5));
    refused('top', `${encodeCursor('top', KEYS.top)}=`); // padding is not ours
    refused('top', encodeCursor('top', KEYS.top).replace(/.$/, '+'));
    refused('top', undefined);
    refused('top', 42);
    refused('top', null);
    refused('top', ['a']);
    refused('last', 'not a uuid');
    refused('last', ID.toUpperCase());
    refused('last', handMade({ i: ID }));
  });

  it('refuses a cursor edited so that it no longer reads', () => {
    const text = encodeCursor('top', KEYS.top);
    refused('top', text.slice(0, -4));
    refused('top', `${text.slice(0, 4)}!${text.slice(5)}`);
    refused('top', text.slice(1));
    refused('top', `${text}A`);
  });

  it('is not signed: an edit that leaves a good key is another place in the same public list', () => {
    const text = encodeCursor('top', { r: '28781290448', i: ID });
    // Character 10 is a digit of the rank: changing it gives another rank, which is a cursor too.
    const edited = `${text.slice(0, 10)}A${text.slice(11)}`;
    expect(decodeCursor('top', edited)).toEqual({ r: '20781290448', i: ID });
  });

  it('refuses a cursor in another written form than ours', () => {
    // The same key, with its keys the other way round or with spaces.
    refused('top', handMade({ i: ID, r: '5' }));
    refused('top', Buffer.from(`{"r": "5", "i": "${ID}"}`).toString('base64url'));
    // Bits left over at the end of the base64.
    const text = encodeCursor('id', KEYS.id);
    refused('id', `${text.slice(0, -1)}${text.endsWith('A') ? 'B' : 'A'}`);
  });

  it('refuses a cursor of 200 characters or more', () => {
    const long = 'A'.repeat(MAX_CURSOR_LENGTH + 1);
    refused('top', long);
    refused('name', handMade({ n: 'x'.repeat(200), i: ID }));
    // The edge: this one is 200 characters and otherwise good; one name character fewer is 199 and passes.
    const at200 = handMade({ n: 'x'.repeat(99), i: ID });
    expect(at200).toHaveLength(MAX_CURSOR_LENGTH + 1);
    refused('name', at200);
    const at199 = handMade({ n: 'x'.repeat(98), i: ID });
    expect(at199).toHaveLength(MAX_CURSOR_LENGTH);
    expect(decodeCursor('name', at199)).toEqual({ n: 'x'.repeat(98), i: ID });
    expect(() => encodeCursor('name', { n: 'x'.repeat(99), i: ID })).toThrow(CursorError);
    expect(encodeCursor('name', { n: 'x'.repeat(98), i: ID })).toBe(at199);
    expect(() => encodeCursor('name', { n: 'あ'.repeat(60), i: ID })).toThrow(CursorError);
    // The longest ordinary name still fits.
    expect(encodeCursor('name', { n: 'x'.repeat(60), i: ID }).length).toBeLessThan(200);
  });

  it('refuses a value out of range, so nothing odd reaches the database', () => {
    refused('top', handMade({ r: '9223372036854775808', i: ID })); // past bigint
    refused('top', handMade({ r: '-9223372036854775809', i: ID }));
    refused('top', handMade({ r: 5, i: ID })); // a number, not text
    refused('top', handMade({ r: '05', i: ID }));
    refused('top', handMade({ r: '1.5', i: ID }));
    refused('top', handMade({ r: '1e3', i: ID }));
    refused('top', handMade({ r: ' 5', i: ID }));
    refused('top', handMade({ r: '-0', i: ID }));
    refused('standing', handMade({ s: '-1', i: ID }));
    refused('top', handMade({ r: '5', i: ID.toUpperCase() }));
    refused('top', handMade({ r: '5', i: 'x' }));
    refused('time', handMade({ t: '2026-02-30T00:00:00Z', i: ID }));
    refused('time', handMade({ t: '2026-13-01T00:00:00Z', i: ID }));
    refused('time', handMade({ t: '2026-11-17T24:00:00Z', i: ID }));
    // Postgres has no year 0, so `::timestamptz` would raise: the year 0000 is refused, year 1 is not.
    refused('time', handMade({ t: '0000-01-01T00:00:00Z', i: ID }));
    refused('time', handMade({ t: '0000-12-31T23:59:59.999999Z', i: ID }));
    for (const t of ['0001-01-01T00:00:00Z', '9999-12-31T23:59:59.999999Z']) {
      expect(decodeCursor('time', handMade({ t, i: ID }))).toEqual({ t, i: ID });
    }
    // Leap years as the Gregorian calendar has them, also below year 100.
    for (const t of ['2024-02-29T00:00:00Z', '2000-02-29T00:00:00Z', '0004-02-29T00:00:00Z']) {
      expect(decodeCursor('time', handMade({ t, i: ID }))).toEqual({ t, i: ID });
    }
    for (const t of [
      '2026-02-29T00:00:00Z',
      '1900-02-29T00:00:00Z',
      '0100-02-29T00:00:00Z',
      '0001-02-29T00:00:00Z',
    ]) {
      refused('time', handMade({ t, i: ID }));
    }
    refused('time', handMade({ t: '2026-04-31T00:00:00Z', i: ID }));
    refused('time', handMade({ t: '2026-11-17 04:10:00Z', i: ID }));
    refused('time', handMade({ t: '2026-11-17T04:10:00+05:30', i: ID }));
    refused('time', handMade({ t: '2026-11-17T04:10:00.1234567Z', i: ID }));
    refused('forYou', handMade({ b: '7f3e9a21', o: -1 }));
    refused('forYou', handMade({ b: '7f3e9a21', o: 1.5 }));
    refused('forYou', handMade({ b: '7f3e9a21', o: '1' }));
    refused('forYou', handMade({ b: '7f3e9a21', o: 10_001 }));
    refused('forYou', handMade({ b: 'has a space', o: 1 }));
    refused('name', handMade({ n: '', i: ID }));
    refused('name', handMade({ n: 'two\nlines', i: ID }));
  });

  it('answers the one message for the issue on `cursor`', () => {
    expect(() => decodeCursor('top', 'x')).toThrow(CURSOR_MESSAGE);
  });

  it('refuses to make a cursor from a key that is not its shape', () => {
    expect(() => encodeCursor('top', { r: 5, i: ID } as never)).toThrow(CursorError);
    expect(() => encodeCursor('top', { r: '5' } as never)).toThrow(CursorError);
    expect(() => encodeCursor('top', null as never)).toThrow(CursorError);
    expect(() => encodeCursor('last', 'x')).toThrow(CursorError);
    expect(() => encodeCursor('time', { t: '2026-02-30T00:00:00Z', i: OTHER })).toThrow(
      CursorError,
    );
  });
});
