import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, harness, json } from './harness.ts';
import { sendRaw } from './http.ts';
import { pace, REQUESTS_PER_WINDOW, STALE_LOCK_MS, WINDOW_MS } from './pace.ts';
import { Store } from './store.ts';

/** Test group 5, pacing: at most 40 requests to staging in any 60 seconds, shared by every process. */

let h: Harness;
beforeEach(() => {
  h = harness();
  h.server.on('GET', '/api/v1/social/board', () => json(200, { stories: [] }));
});
afterEach(() => h.cleanup());

describe('pacing', () => {
  it('lets 40 requests through at once, and makes the 41st wait until the first is a minute old', async () => {
    for (let i = 0; i < REQUESTS_PER_WINDOW; i++) await pace(h.store, h.clock);
    expect(h.clock.sleeps).toEqual([]);
    const before = h.clock.now();
    await pace(h.store, h.clock);
    expect(h.clock.sleeps).toEqual([WINDOW_MS]);
    expect(h.clock.now() - before).toBe(WINDOW_MS);
  });

  it('spreads later requests over the window, never more than 40 in any 60 seconds', async () => {
    const times: number[] = [];
    for (let i = 0; i < 130; i++) {
      await pace(h.store, h.clock);
      times.push(h.clock.now());
      h.clock.advance(300);
    }
    for (const [i, start] of times.entries()) {
      const inWindow = times.filter((time, at) => at >= i && time < start + WINDOW_MS).length;
      expect(inWindow).toBeLessThanOrEqual(REQUESTS_PER_WINDOW);
    }
  });

  it('is shared by every process: two of them together get 40, and the 41st waits', async () => {
    const other = Store.open(h.home);
    for (let i = 0; i < 20; i++) await pace(h.store, h.clock);
    for (let i = 0; i < 20; i++) await pace(other, h.clock);
    expect(h.clock.sleeps).toEqual([]);
    await pace(other, h.clock);
    expect(h.clock.sleeps).toEqual([WINDOW_MS]);
    for (let i = 0; i < 39; i++) await pace(h.store, h.clock);
    await pace(h.store, h.clock);
    expect(h.clock.sleeps.length).toBe(2);
  });

  it('counts each request to staging, a retry as well, and no other', async () => {
    for (let i = 0; i < 12; i++) await sendRaw(h.ctx, { method: 'GET', path: '/social/board' });
    const state = h.store.readJson<{ at: number[] }>('pace.json');
    expect(state?.at).toHaveLength(12);
  });

  it('breaks a stale lock, and waits for one that is held', async () => {
    h.store.writeText('pace.lock', String(h.clock.now() - STALE_LOCK_MS - 1000));
    await pace(h.store, h.clock);
    expect(h.clock.sleeps).toEqual([]);
    expect(h.store.exists('pace.lock')).toBe(false);

    // A lock held a second ago: the next request waits (50 ms at a time) until it is let go.
    h.store.writeText('pace.lock', String(h.clock.now() - 1000));
    const sleep = h.clock.sleep;
    let slept = 0;
    h.clock.sleep = async (ms) => {
      await sleep(ms);
      if (++slept === 3) h.store.remove('pace.lock');
    };
    await pace(h.store, h.clock);
    expect(slept).toBe(3);
    expect(h.store.exists('pace.lock')).toBe(false);
  });

  it('breaks a lock left behind by a process that died, once it is stale by its own time', async () => {
    h.store.writeText('pace.lock', String(h.clock.now()));
    await pace(h.store, h.clock);
    expect(h.clock.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(STALE_LOCK_MS);
    expect(h.clock.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(STALE_LOCK_MS + 1000);
  });

  it('tries again at once when the lock is let go between its try and its look', async () => {
    h.store.writeText('pace.lock', String(h.clock.now() - 1000));
    const read = h.store.readText.bind(h.store);
    let vanished = false;
    h.store.readText = (rel) => {
      if (rel === 'pace.lock' && !vanished) {
        vanished = true;
        h.store.remove('pace.lock');
        return null;
      }
      return read(rel);
    };
    await pace(h.store, h.clock);
    expect(vanished).toBe(true);
    expect(h.clock.sleeps).toEqual([]);
  });

  it('lets go of the lock when a write fails', async () => {
    h.store.hooks.beforeRename = () => {
      throw new Error('the disk');
    };
    await expect(pace(h.store, h.clock)).rejects.toThrow('the disk');
    h.store.hooks.beforeRename = undefined;
    expect(h.store.exists('pace.lock')).toBe(false);
  });
});
