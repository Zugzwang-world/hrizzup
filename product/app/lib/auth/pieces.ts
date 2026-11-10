/**
 * Supabase's session (a few kilobytes of JSON: the tokens and the account) kept in a store whose
 * values must stay small: Expo's SecureStore, encrypted by Android's Keystore (iOS's Keychain),
 * keeps each value to 2,048 bytes. So a value is split into pieces of at most `MAX_PIECE_BYTES`
 * bytes of UTF-8, never cutting a character in two (a name may be written in any script).
 *
 * A value is written as a new generation: its pieces first, under `<key>.<generation>.<n>`, then
 * `<key>` itself, naming the generation and how many pieces it has (`<generation>:<count>`), then
 * the old generation's pieces are deleted. `<key>` changes in one write, so a write cut short (the
 * app closed, the phone switched off) leaves the last whole value, never a mix of two. Pure, so it
 * can be tested without a phone; lib/auth/storage.ts gives it SecureStore.
 */

/** A small asynchronous key-value store, as SecureStore offers. */
export type KeyValueStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

/** The storage Supabase's sign-in client asks for. */
export type SessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Under SecureStore's 2,048 bytes a value, with room to spare. */
export const MAX_PIECE_BYTES = 1800;

function utf8Bytes(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** A value cut into pieces of at most `max` bytes of UTF-8, whole characters each. */
export function cut(value: string, max = MAX_PIECE_BYTES): string[] {
  const pieces: string[] = [];
  let piece = '';
  let bytes = 0;
  for (const character of value) {
    const size = utf8Bytes(character.codePointAt(0) ?? 0);
    if (bytes + size > max) {
      pieces.push(piece);
      piece = '';
      bytes = 0;
    }
    piece += character;
    bytes += size;
  }
  if (piece || pieces.length === 0) pieces.push(piece);
  return pieces;
}

type Pointer = { generation: string; count: number };

const POINTER = /^([a-z0-9]{1,24}):([1-9][0-9]{0,3})$/;

function readPointer(raw: string | null): Pointer | null {
  const match = raw ? POINTER.exec(raw) : null;
  return match ? { generation: match[1] ?? '', count: Number(match[2]) } : null;
}

let generations = 0;

/** A generation's name: letters and digits only, as SecureStore's keys allow. */
function newGeneration(): string {
  generations += 1;
  return `${Date.now().toString(36)}${generations.toString(36)}`;
}

/** Storage for Supabase's client, kept in pieces in `store`, as above. */
export function piecewise(store: KeyValueStore, generation = newGeneration): SessionStorage {
  const pieceKey = (key: string, pointer: Pointer, n: number) =>
    `${key}.${pointer.generation}.${n}`;

  async function removePieces(key: string, pointer: Pointer) {
    for (let n = 0; n < pointer.count; n++) await store.delete(pieceKey(key, pointer, n));
  }

  return {
    async getItem(key) {
      const pointer = readPointer(await store.get(key));
      if (!pointer) return null;
      const pieces: string[] = [];
      for (let n = 0; n < pointer.count; n++) {
        const piece = await store.get(pieceKey(key, pointer, n));
        if (piece === null) return null; // a value never written whole: as if there were none
        pieces.push(piece);
      }
      return pieces.join('');
    },

    async setItem(key, value) {
      const old = readPointer(await store.get(key));
      const pieces = cut(value);
      const next = { generation: generation(), count: pieces.length };
      for (const [n, piece] of pieces.entries()) await store.set(pieceKey(key, next, n), piece);
      await store.set(key, `${next.generation}:${next.count}`);
      if (old && old.generation !== next.generation) await removePieces(key, old);
    },

    async removeItem(key) {
      const old = readPointer(await store.get(key));
      await store.delete(key);
      if (old) await removePieces(key, old);
    },
  };
}
