import { describe, expect, it } from 'vitest';
import { cut, type KeyValueStore, MAX_PIECE_BYTES, piecewise } from './pieces.ts';

/** A store in memory, like SecureStore: it can be told to fail its next write. */
function memoryStore() {
  const values = new Map<string, string>();
  let failNextSet = false;
  const store: KeyValueStore & { values: Map<string, string>; failNextSet(): void } = {
    values,
    failNextSet: () => {
      failNextSet = true;
    },
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      if (failNextSet) {
        failNextSet = false;
        throw new Error('The phone switched off');
      }
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
  return store;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** A session-sized value: about 3 KB of JSON, with a name in Devanagari and an emoji. */
const SESSION = JSON.stringify({
  access_token: 'a'.repeat(1200),
  refresh_token: 'r'.repeat(12),
  user: { email: 'reader@example.com', user_metadata: { full_name: 'हृषिकेश 🙂'.repeat(60) } },
});

describe('cutting a value into pieces', () => {
  it('keeps every piece within the limit, in bytes of UTF-8, and loses nothing', () => {
    const pieces = cut(SESSION);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(bytes(piece)).toBeLessThanOrEqual(MAX_PIECE_BYTES);
    expect(pieces.join('')).toBe(SESSION);
  });

  it('never cuts a character in two', () => {
    const pieces = cut('🙂'.repeat(10), 9);
    expect(pieces).toEqual(['🙂🙂', '🙂🙂', '🙂🙂', '🙂🙂', '🙂🙂']);
  });

  it('keeps a short value whole', () => {
    expect(cut('short')).toEqual(['short']);
  });
});

describe('the session, kept in pieces', () => {
  const KEY = 'sb-project-auth-token';

  it('reads back exactly what was written', async () => {
    const store = memoryStore();
    const storage = piecewise(store);
    await storage.setItem(KEY, SESSION);
    expect(await storage.getItem(KEY)).toBe(SESSION);
    for (const value of store.values.values()) {
      expect(bytes(value)).toBeLessThanOrEqual(MAX_PIECE_BYTES);
    }
  });

  it('uses only key names SecureStore accepts (letters, digits, ".", "-" and "_")', async () => {
    const store = memoryStore();
    await piecewise(store).setItem(KEY, SESSION);
    for (const key of store.values.keys()) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('replaces a value whole, leaving none of the old pieces behind', async () => {
    const store = memoryStore();
    const storage = piecewise(store);
    await storage.setItem(KEY, SESSION);
    await storage.setItem(KEY, 'a shorter session');
    expect(await storage.getItem(KEY)).toBe('a shorter session');
    expect([...store.values.keys()].filter((key) => key.startsWith(`${KEY}.`))).toHaveLength(1);
  });

  it('keeps the last whole value when a write is cut short', async () => {
    const store = memoryStore();
    let n = 0;
    const storage = piecewise(store, () => `g${++n}`);
    await storage.setItem(KEY, SESSION);
    // The new value's pieces are written, then the switch to them fails.
    const pieces = cut('the next session').length;
    const realSet = store.set;
    let writes = 0;
    store.set = async (key, value) => {
      writes += 1;
      if (writes > pieces) store.failNextSet();
      return realSet(key, value);
    };
    await expect(storage.setItem(KEY, 'the next session')).rejects.toThrow();
    expect(await storage.getItem(KEY)).toBe(SESSION);
  });

  it('reads a value missing a piece as no value at all', async () => {
    const store = memoryStore();
    const storage = piecewise(store, () => 'g1');
    await storage.setItem(KEY, SESSION);
    store.values.delete(`${KEY}.g1.1`);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('removes every piece', async () => {
    const store = memoryStore();
    const storage = piecewise(store);
    await storage.setItem(KEY, SESSION);
    await storage.setItem('other-key', 'kept');
    await storage.removeItem(KEY);
    expect(await storage.getItem(KEY)).toBeNull();
    expect([...store.values.keys()].every((key) => key.startsWith('other-key'))).toBe(true);
  });

  it("reads nothing where nothing was written, or where the key isn't one of ours", async () => {
    const store = memoryStore();
    const storage = piecewise(store);
    expect(await storage.getItem(KEY)).toBeNull();
    await store.set(KEY, 'written by something else');
    expect(await storage.getItem(KEY)).toBeNull();
  });
});
