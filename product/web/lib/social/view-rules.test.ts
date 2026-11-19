import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  batches,
  DWELL_MS,
  deviceIdOf,
  ENDPOINT,
  FLUSH_MS,
  isDeviceId,
  isOnScreen,
  NOTE_ITEMS,
  noteBody,
  retryAfterMs,
  THRESHOLDS,
  viewItemOf,
} from './view-rules.ts';

/**
 * What a view is, as the page decides it (docs/social/r11-design.md, decision 1 and section 3.8): when an item is
 * on screen, which marks name an item, what a device ID looks like and how one is made, how a queue splits into
 * notes, and how long a note that wasn't taken waits for its one retry. The rules are pure, so they run here in
 * Node; the sender that uses them runs in the browser (the journey proves it).
 */

const entry = (changes: Partial<Parameters<typeof isOnScreen>[0]> = {}) => ({
  isIntersecting: true,
  intersectionRatio: 0.6,
  intersectionRect: { height: 300 },
  rootBounds: { height: 800 },
  ...changes,
});

describe('what is on screen', () => {
  it('is an item with half of it in the viewport', () => {
    expect(isOnScreen(entry({ intersectionRatio: 0.5 }), 800)).toBe(true);
    expect(isOnScreen(entry({ intersectionRatio: 1 }), 800)).toBe(true);
    expect(
      isOnScreen(entry({ intersectionRatio: 0.55, intersectionRect: { height: 10 } }), 800),
    ).toBe(true);
  });

  it('is a post taller than the screen once the visible part covers half the screen’s height', () => {
    // A post six screens tall: half the screen is a twelfth of the post, under the half the first rule asks.
    expect(
      isOnScreen(entry({ intersectionRatio: 0.09, intersectionRect: { height: 400 } }), 800),
    ).toBe(true);
    expect(
      isOnScreen(entry({ intersectionRatio: 0.09, intersectionRect: { height: 800 } }), 800),
    ).toBe(true);
    expect(
      isOnScreen(entry({ intersectionRatio: 0.09, intersectionRect: { height: 399 } }), 800),
    ).toBe(false);
  });

  it('is not a sliver, or an item that is not intersecting at all', () => {
    expect(
      isOnScreen(entry({ intersectionRatio: 0.04, intersectionRect: { height: 20 } }), 800),
    ).toBe(false);
    expect(
      isOnScreen(entry({ intersectionRatio: 0.49, intersectionRect: { height: 399 } }), 800),
    ).toBe(false);
    expect(isOnScreen(entry({ isIntersecting: false, intersectionRatio: 0 }), 800)).toBe(false);
    // Whatever the numbers say, an item that isn't intersecting isn't on screen.
    expect(
      isOnScreen(
        entry({ isIntersecting: false, intersectionRatio: 1, intersectionRect: { height: 900 } }),
        800,
      ),
    ).toBe(false);
  });

  it('uses the fallback height where the observer gave no root bounds', () => {
    const tall = entry({
      intersectionRatio: 0.1,
      intersectionRect: { height: 450 },
      rootBounds: null,
    });
    expect(isOnScreen(tall, 800)).toBe(true);
    expect(isOnScreen(tall, 1000)).toBe(false);
    expect(
      isOnScreen(
        entry({
          intersectionRatio: 0.1,
          intersectionRect: { height: 450 },
          rootBounds: { height: 1000 },
        }),
        800,
      ),
    ).toBe(false);
  });

  it('is reported at 21 thresholds, 0 to 1 in steps of 0.05', () => {
    expect(THRESHOLDS).toHaveLength(21);
    expect(THRESHOLDS[0]).toBe(0);
    expect(THRESHOLDS[20]).toBe(1);
    for (let n = 1; n < THRESHOLDS.length; n++) {
      expect((THRESHOLDS[n] ?? 0) - (THRESHOLDS[n - 1] ?? 0)).toBeCloseTo(0.05, 10);
    }
    // A post 20 screens tall reports at 0.05 of itself: a whole screen, more than the half a screen the rule asks.
    expect(THRESHOLDS).toContain(0.05);
  });
});

describe('the marks', () => {
  const ID = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d';

  it('name an item by its kind and its ID, which is written in lower case', () => {
    expect(viewItemOf('post', ID)).toEqual({ kind: 'post', id: ID });
    expect(viewItemOf('story', ID.toUpperCase())).toEqual({ kind: 'story', id: ID });
    expect(viewItemOf('file', ID)).toEqual({ kind: 'file', id: ID });
  });

  it('name nothing for another kind, a missing kind or an ID that is not a UUID', () => {
    for (const [kind, id] of [
      ['agent', ID],
      ['Post', ID],
      ['', ID],
      [null, ID],
      [undefined, ID],
      ['post', null],
      ['post', undefined],
      ['post', ''],
      ['post', 'not-an-id'],
      ['post', `${ID}0`],
      ['post', ` ${ID}`],
    ] as const) {
      expect(viewItemOf(kind, id), `${kind} ${id}`).toBeNull();
    }
  });
});

describe('the device’s ID', () => {
  it('is 16 to 64 letters, digits, hyphens and underscores', () => {
    expect(isDeviceId('a'.repeat(16))).toBe(true);
    expect(isDeviceId('Ab0-_'.repeat(12))).toBe(true);
    expect(isDeviceId('a'.repeat(64))).toBe(true);
    for (const bad of [
      'a'.repeat(15),
      'a'.repeat(65),
      `${'a'.repeat(15)}=`,
      `${'a'.repeat(15)} `,
      `${'a'.repeat(15)}+`,
      '',
      null,
      undefined,
      5,
    ]) {
      expect(isDeviceId(bad), String(bad)).toBe(false);
    }
  });

  it('is made of 16 bytes as 22 base64url characters, which is a valid device ID', () => {
    for (let n = 0; n < 50; n++) {
      const made = deviceIdOf(new Uint8Array(randomBytes(16)));
      expect(made).toHaveLength(22);
      expect(made).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isDeviceId(made)).toBe(true);
    }
  });

  it('is the base64url of its bytes, with no padding', () => {
    for (const length of [1, 2, 3, 4, 15, 16, 17, 32]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(deviceIdOf(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
    expect(deviceIdOf(new Uint8Array(16))).toBe('A'.repeat(22));
    expect(deviceIdOf(new Uint8Array(16).fill(255))).toBe(`${'_'.repeat(21)}w`);
  });
});

describe('the notes', () => {
  it('split a queue into notes of at most 50 items, in order', () => {
    const queue = Array.from({ length: 120 }, (_, n) => n);
    const notes = batches(queue);
    expect(notes.map((note) => note.length)).toEqual([50, 50, 20]);
    expect(notes.flat()).toEqual(queue);
    expect(batches([])).toEqual([]);
    expect(batches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(NOTE_ITEMS).toBe(50);
  });

  it('have a JSON body of the request ID, the device and the items', () => {
    const items = [{ kind: 'post' as const, id: '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d' }];
    expect(JSON.parse(noteBody('r', 'device-id-for-a-test', items))).toEqual({
      requestId: 'r',
      device: 'device-id-for-a-test',
      items,
    });
  });

  it('keep the numbers and the address the design gives', () => {
    expect([DWELL_MS, FLUSH_MS, ENDPOINT]).toEqual([1_000, 10_000, '/api/v1/social/views']);
  });
});

describe('the retry', () => {
  it('waits what a 429’s Retry-After says, at most 60 seconds, and 10 seconds when it is missing or not a number', () => {
    expect(retryAfterMs(429, '7')).toBe(7_000);
    expect(retryAfterMs(429, ' 30 ')).toBe(30_000);
    expect(retryAfterMs(429, '60')).toBe(60_000);
    expect(retryAfterMs(429, '600')).toBe(60_000);
    expect(retryAfterMs(429, '1.5')).toBe(1_500);
    for (const missing of [null, undefined, '', 'soon', '-3', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      expect(retryAfterMs(429, missing), String(missing)).toBe(10_000);
    }
  });

  it('waits 10 seconds for a 500 or more, and never retries any other answer', () => {
    for (const status of [500, 502, 503, 599]) expect(retryAfterMs(status, null)).toBe(10_000);
    for (const status of [200, 204, 400, 404, 409, 422]) {
      expect(retryAfterMs(status, '5'), String(status)).toBeNull();
    }
  });
});
