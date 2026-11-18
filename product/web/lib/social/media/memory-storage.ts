import { createHash } from 'node:crypto';
import {
  type CopyResult,
  type ObjectHead,
  type Presigned,
  type Storage,
  StorageChanged,
  StorageUnavailable,
} from './storage.ts';

/**
 * Both buckets in memory, for tests (docs/social/media-design.md, 7.2; section 11.3): the same `Storage` the
 * checks use, so the whole upload runs without a network. Not used by any route. A test PUTs a file the way
 * an agent would (`put`), and may make a call fail (`fail`), make the bucket refuse copies (`copies`), change a
 * file mid-check (`replace`) or watch every call (`log`, `onCall`).
 */

export type MemoryStorage = Storage & {
  /** The files of the uploads bucket, by key. */
  uploads: Map<string, { bytes: Uint8Array; contentType: string; etag: string }>;
  /** The files of the media bucket, by key. */
  media: Map<string, { bytes: Uint8Array; contentType: string; cacheControl: string }>;
  /** Every call made, by name and key, in order. */
  log: string[];
  /** Called as each storage call starts (a test checks what else is open then). */
  onCall: ((name: string) => void) | null;
  /** Calls made to fail with `StorageUnavailable`, by name. */
  fail: Set<string>;
  /** `refuse` makes the media bucket decline copies (as a bucket that can't copy between buckets does). */
  copies: 'copy' | 'refuse';
  /** What `presignPut` was asked for. */
  presigned: { key: string; contentType: string; bytes: number; seconds: number }[];
  /** Stores a file as an agent's PUT would. */
  put(key: string, bytes: Uint8Array, contentType: string): void;
  /** Replaces a stored file (a new ETag), as a second PUT to the same link would. */
  replace(key: string, bytes: Uint8Array, contentType?: string): void;
};

const etagOf = (bytes: Uint8Array) => `"${createHash('md5').update(bytes).digest('hex')}"`;

export function memoryStorage(): MemoryStorage {
  const store: MemoryStorage = {
    uploads: new Map(),
    media: new Map(),
    log: [],
    onCall: null,
    fail: new Set(),
    copies: 'copy',
    presigned: [],
    put(key, bytes, contentType) {
      store.uploads.set(key, { bytes, contentType, etag: etagOf(bytes) });
    },
    replace(key, bytes, contentType) {
      const was = store.uploads.get(key);
      store.put(key, bytes, contentType ?? was?.contentType ?? 'application/octet-stream');
    },

    async presignPut(input): Promise<Presigned> {
      await enter('presignPut', input.key);
      store.presigned.push(input);
      return {
        url: `https://storage.test/uploads/${input.key}?X-Amz-Expires=${input.seconds}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost`,
        headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.bytes) },
      };
    },

    async head(key): Promise<ObjectHead | null> {
      await enter('head', key);
      const file = store.uploads.get(key);
      return file === undefined
        ? null
        : { size: file.bytes.length, etag: file.etag, contentType: file.contentType };
    },

    async read(key, options) {
      await enter('read', key);
      const file = held(key, options.ifMatch);
      const bytes =
        options.start !== undefined && options.end !== undefined
          ? file.bytes.subarray(options.start, options.end)
          : file.bytes;
      if (bytes.length > options.maxBytes) throw new StorageChanged('more bytes than asked for');
      return bytes.slice();
    },

    async stream(key, options) {
      await enter('stream', key);
      const file = held(key, options.ifMatch);
      // Chunks of 1,000 bytes: more than one, and not on a frame's edge.
      return (async function* () {
        for (let at = 0; at < file.bytes.length; at += 1000) yield file.bytes.slice(at, at + 1000);
      })();
    },

    async putMedia(key, bytes, contentType) {
      await enter('putMedia', key);
      store.media.set(key, {
        bytes: bytes.slice(),
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      });
    },

    async copyToMedia(uploadKey, mediaKey, options): Promise<CopyResult> {
      await enter('copyToMedia', mediaKey);
      if (store.copies === 'refuse') return { status: 'refused' };
      const file = store.uploads.get(uploadKey);
      if (file === undefined) return { status: 'missing' };
      if (file.etag !== options.etag) return { status: 'changed' };
      store.media.set(mediaKey, {
        bytes: file.bytes.slice(),
        contentType: options.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      });
      return { status: 'copied', etag: file.etag };
    },

    async removeUpload(key) {
      await enter('removeUpload', key);
      store.uploads.delete(key);
    },

    async removeMedia(key) {
      await enter('removeMedia', key);
      store.media.delete(key);
    },
  };

  async function enter(name: string, key: string): Promise<void> {
    store.log.push(`${name} ${key}`);
    store.onCall?.(name);
    if (store.fail.has(name)) throw new StorageUnavailable(`${name} failed on purpose`);
  }

  function held(key: string, ifMatch: string) {
    const file = store.uploads.get(key);
    if (file === undefined || file.etag !== ifMatch)
      throw new StorageChanged('a read of another version');
    return file;
  }

  return store;
}
