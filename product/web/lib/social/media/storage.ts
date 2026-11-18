import { AwsClient } from 'aws4fetch';

/**
 * Where uploads are signed, read and kept (docs/social/media-design.md, 7.2 and 7.3): the website's two R2
 * buckets of its environment, reached with `aws4fetch` (S3's own protocol, path-style addresses). The
 * uploads bucket holds what an agent PUT to its one-time link until it is checked (its own one-day rule
 * clears the rest); the media bucket holds what passed, under a key that never changes.
 *
 * - **`mediaStorage()` is null** unless all five names are set (`R2_ENDPOINT`, `R2_BUCKET_UPLOADS`,
 *   `R2_BUCKET_MEDIA`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`): a place with no storage answers uploads
 *   with a 503, never a half-made upload.
 * - **A network failure or a 5xx** (and the same for 408 and 429) throws `StorageUnavailable`: the check is
 *   released and tried again. **A file that changed or vanished while it was being checked** throws
 *   `StorageChanged` (the check's `If-Match` failed): the upload is refused.
 * - **Every read says which version of the file it wants** (`If-Match`, the ETag the check began with), and
 *   no read holds more bytes than the caller allowed.
 * - **Nothing here ever prints a key or a signed address.**
 */

/** The storage was unreachable or failed (a network error, a 5xx, a rate limit): a passing failure. */
export class StorageUnavailable extends Error {
  constructor(what: string) {
    super(`Storage was unavailable: ${what}`);
    this.name = 'StorageUnavailable';
  }
}

/** The file changed or went away after the check began. */
export class StorageChanged extends Error {
  constructor(what: string) {
    super(`The upload changed during its check: ${what}`);
    this.name = 'StorageChanged';
  }
}

/** What `HEAD` says about a stored file. */
export type ObjectHead = { size: number; etag: string; contentType: string | null };

/** A signed `PUT` for one upload: where to send it and the headers to send, exactly. */
export type Presigned = {
  url: string;
  headers: { 'Content-Type': string; 'Content-Length': string };
};

type Signal = { signal?: AbortSignal };

/** What a copy between the buckets did. `refused` is a bucket that won't copy this way (the caller reads and puts instead). */
export type CopyResult =
  | { status: 'copied'; etag: string | null }
  | { status: 'changed' }
  | { status: 'missing' }
  | { status: 'refused' };

/** The storage the checks use: this interface, so a test can hold both buckets in memory. */
export type Storage = {
  /** A link to PUT one file to the uploads bucket, good for `seconds` (60 to 600). No network. */
  presignPut(input: {
    key: string;
    contentType: string;
    bytes: number;
    seconds: number;
  }): Promise<Presigned>;
  /** The upload's size, ETag and stored type; null when no file is there. */
  head(key: string, options?: Signal): Promise<ObjectHead | null>;
  /** Bytes of the upload (`start` to `end`, exclusive; the whole file when both are left out) of the version `ifMatch`, at most `maxBytes`. */
  read(
    key: string,
    options: { ifMatch: string; maxBytes: number; start?: number; end?: number } & Signal,
  ): Promise<Uint8Array>;
  /** The whole upload of the version `ifMatch`, as a stream of chunks. */
  stream(key: string, options: { ifMatch: string } & Signal): Promise<AsyncIterable<Uint8Array>>;
  /** Stores a checked file in the media bucket, to be served for a year without change. */
  putMedia(key: string, body: Uint8Array, contentType: string, options?: Signal): Promise<void>;
  /** Copies the upload of the version `etag` to the media bucket, without it passing through here. */
  copyToMedia(
    uploadKey: string,
    mediaKey: string,
    options: { etag: string; contentType: string } & Signal,
  ): Promise<CopyResult>;
  /** Deletes an upload once it is settled. Never rejects: the bucket's own one-day rule clears what a failure leaves. */
  removeUpload(key: string): Promise<void>;
  /** Deletes a file from the media bucket (a copy that turned out not to be the one checked). Never rejects. */
  removeMedia(key: string): Promise<void>;
};

type Env = Readonly<Record<string, string | undefined>>;

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** A stored ETag without its quotes (a weak mark too), to compare two. */
export const plainEtag = (etag: string) => etag.replace(/^W\//, '').replaceAll('"', '');

/** The storage for this environment, or null when any of its five names isn't set. */
export function mediaStorage(env: Env = process.env): Storage | null {
  const endpoint = env.R2_ENDPOINT?.replace(/\/$/, '');
  const [uploads, media] = [env.R2_BUCKET_UPLOADS, env.R2_BUCKET_MEDIA];
  const [accessKeyId, secretAccessKey] = [env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY];
  if (!endpoint || !uploads || !media || !accessKeyId || !secretAccessKey) return null;
  // Two retries of a 5xx or 429 (the library's default is ten, with waits that outlast a check's deadline).
  const aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
    retries: 2,
  });
  const address = (bucket: string, key: string) => `${endpoint}/${bucket}/${key}`;

  /** One signed request; a network failure (or an abort) is `StorageUnavailable`. */
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await aws.fetch(url, init);
    } catch (error) {
      throw new StorageUnavailable(error instanceof Error ? error.name : 'a network failure');
    }
  };
  /** Throws for any answer that isn't one of the `allowed` statuses: a passing failure. */
  const unlessOk = async (response: Response, ...allowed: number[]): Promise<Response> => {
    if (allowed.includes(response.status)) return response;
    await response.body?.cancel().catch(() => undefined);
    throw new StorageUnavailable(`status ${response.status}`);
  };
  const reading = (options: { ifMatch: string } & Signal) => ({
    headers: { 'If-Match': options.ifMatch },
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return {
    async presignPut({ key, contentType, bytes, seconds }) {
      const target = new URL(address(uploads, key));
      target.searchParams.set('X-Amz-Expires', String(seconds));
      const headers = { 'Content-Type': contentType, 'Content-Length': String(bytes) } as const;
      const signed = await aws.sign(target.href, {
        method: 'PUT',
        headers,
        aws: { signQuery: true, allHeaders: true },
      });
      return { url: signed.url, headers: { ...headers } };
    },

    async head(key, options) {
      const response = await send(address(uploads, key), {
        method: 'HEAD',
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (response.status === 404) return null;
      await unlessOk(response, 200);
      const size = Number(response.headers.get('content-length'));
      const etag = response.headers.get('etag');
      if (!Number.isSafeInteger(size) || size < 0 || etag === null) {
        throw new StorageUnavailable('a file with no size or no ETag');
      }
      return { size, etag, contentType: response.headers.get('content-type') };
    },

    async read(key, options) {
      const ranged = options.start !== undefined && options.end !== undefined;
      const response = await send(address(uploads, key), {
        method: 'GET',
        headers: {
          'If-Match': options.ifMatch,
          ...(ranged ? { Range: `bytes=${options.start}-${(options.end ?? 1) - 1}` } : {}),
        },
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (response.status === 412 || response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        throw new StorageChanged(`status ${response.status}`);
      }
      await unlessOk(response, 200, 206);
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > options.maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new StorageChanged('more bytes than asked for');
      }
      const reader = response.body?.getReader();
      if (!reader) return new Uint8Array(0);
      const parts: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } catch (error) {
          throw new StorageUnavailable(error instanceof Error ? error.name : 'a read failed');
        }
        if (next.done) break;
        total += next.value.length;
        if (total > options.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new StorageChanged('more bytes than asked for');
        }
        parts.push(next.value);
      }
      const whole = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        whole.set(part, at);
        at += part.length;
      }
      return whole;
    },

    async stream(key, options) {
      const response = await send(address(uploads, key), { method: 'GET', ...reading(options) });
      if (response.status === 412 || response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        throw new StorageChanged(`status ${response.status}`);
      }
      await unlessOk(response, 200);
      if (!response.body) throw new StorageUnavailable('an answer with no body');
      return response.body as unknown as AsyncIterable<Uint8Array>;
    },

    async putMedia(key, body, contentType, options) {
      const response = await send(address(media, key), {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Cache-Control': IMMUTABLE },
        body: body as unknown as BodyInit,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      await unlessOk(response, 200);
      await response.body?.cancel().catch(() => undefined);
    },

    async copyToMedia(uploadKey, mediaKey, options) {
      const response = await send(address(media, mediaKey), {
        method: 'PUT',
        headers: {
          'x-amz-copy-source': `/${uploads}/${uploadKey}`,
          'x-amz-copy-source-if-match': options.etag,
          'x-amz-metadata-directive': 'REPLACE',
          'Content-Type': options.contentType,
          'Cache-Control': IMMUTABLE,
        },
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (response.status === 412) return { status: 'changed' };
      if (response.status === 404) return { status: 'missing' };
      if ([400, 403, 501].includes(response.status)) return { status: 'refused' };
      await unlessOk(response, 200);
      const text = await response.text().catch(() => '');
      if (text.includes('<Error>')) throw new StorageUnavailable('a copy that answered an error');
      return { status: 'copied', etag: /<ETag>([^<]+)<\/ETag>/.exec(text)?.[1] ?? null };
    },

    async removeUpload(key) {
      await send(address(uploads, key), { method: 'DELETE' })
        .then((response) => response.body?.cancel())
        .catch(() => undefined);
    },

    async removeMedia(key) {
      await send(address(media, key), { method: 'DELETE' })
        .then((response) => response.body?.cancel())
        .catch(() => undefined);
    },
  };
}
