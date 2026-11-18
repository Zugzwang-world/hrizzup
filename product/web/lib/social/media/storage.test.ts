import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaStorage, plainEtag, StorageChanged, StorageUnavailable } from './storage.ts';

/**
 * The storage's network half (docs/social/media-design.md, 7.2), with `fetch` stood in for: what each call sends
 * (the address, the method, `If-Match`, `Range`, the copy's headers) and how each answer is read. The names
 * and keys here are made up, and no request leaves the process.
 */

const ENV = {
  R2_ENDPOINT: 'https://account.r2.example.test/',
  R2_BUCKET_UPLOADS: 'uploads-for-tests',
  R2_BUCKET_MEDIA: 'media-for-tests',
  R2_ACCESS_KEY_ID: 'access-key-for-tests',
  R2_SECRET_ACCESS_KEY: 'secret-for-tests',
};
const KEY = 'social/019a7b10-0000-7000-8000-0000000000b1/019a7b10-0000-7000-8000-0000000000e1';
const MEDIA_KEY = `${KEY}.mp4`;

type Sent = { method: string; url: string; headers: Headers };
const sent: Sent[] = [];
let reply: (request: Sent) => Response | Promise<Response> = () =>
  new Response(null, { status: 200 });

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: Request) => {
    const request = { method: input.method, url: input.url, headers: input.headers };
    sent.push(request);
    return reply(request);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
  reply = () => new Response(null, { status: 200 });
});

const storage = () => {
  const made = mediaStorage(ENV);
  if (made === null) throw new Error('A storage is made from five names');
  return made;
};

describe('the storage', () => {
  it('is none unless all five names are set', () => {
    for (const name of Object.keys(ENV)) {
      expect(mediaStorage({ ...ENV, [name]: undefined }), name).toBeNull();
      expect(mediaStorage({ ...ENV, [name]: '' }), name).toBeNull();
    }
    expect(mediaStorage({})).toBeNull();
    expect(mediaStorage(ENV)).not.toBeNull();
  });

  it('signs a PUT link with the type and size as headers, no network', async () => {
    const link = await storage().presignPut({
      key: KEY,
      contentType: 'video/mp4',
      bytes: 1234,
      seconds: 300,
    });
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe(
      `https://account.r2.example.test/uploads-for-tests/${KEY}`,
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(link.headers).toEqual({ 'Content-Type': 'video/mp4', 'Content-Length': '1234' });
    expect(sent).toHaveLength(0);
    expect(link.url).not.toContain('secret-for-tests');
  });

  it('heads a file: its size, ETag and type; null when it is not there; a passing failure otherwise', async () => {
    reply = () =>
      new Response(null, {
        status: 200,
        headers: { 'content-length': '42', etag: '"abc"', 'content-type': 'video/mp4' },
      });
    // `HEAD` answers no body, so the length is its header's.
    expect(await storage().head(KEY)).toEqual({
      size: 42,
      etag: '"abc"',
      contentType: 'video/mp4',
    });
    expect(sent[0]).toMatchObject({
      method: 'HEAD',
      url: `https://account.r2.example.test/uploads-for-tests/${KEY}`,
    });
    reply = () => new Response(null, { status: 404 });
    expect(await storage().head(KEY)).toBeNull();
    reply = () => new Response(null, { status: 403 });
    await expect(storage().head(KEY)).rejects.toBeInstanceOf(StorageUnavailable);
    reply = () => new Response(null, { status: 200, headers: { etag: '"abc"' } });
    await expect(storage().head(KEY)).rejects.toBeInstanceOf(StorageUnavailable);
  });

  it('treats a network failure, and a 5xx after its retries, as a passing failure', async () => {
    reply = () => {
      throw new TypeError('fetch failed');
    };
    await expect(storage().head(KEY)).rejects.toBeInstanceOf(StorageUnavailable);
    sent.length = 0;
    reply = () => new Response(null, { status: 503 });
    await expect(storage().head(KEY)).rejects.toBeInstanceOf(StorageUnavailable);
    // The library retries a 5xx twice, not ten times.
    expect(sent.length).toBeLessThanOrEqual(3);
  });

  it('reads a range of the version it was told, within the bytes it was allowed', async () => {
    reply = () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 });
    const bytes = await storage().read(KEY, { ifMatch: '"abc"', start: 10, end: 14, maxBytes: 4 });
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(sent[0]?.method).toBe('GET');
    expect(sent[0]?.headers.get('range')).toBe('bytes=10-13');
    expect(sent[0]?.headers.get('if-match')).toBe('"abc"');
    // A whole read has no range.
    reply = () => new Response(new Uint8Array(3), { status: 200 });
    await storage().read(KEY, { ifMatch: '"abc"', maxBytes: 3 });
    expect(sent[1]?.headers.get('range')).toBeNull();
    // More than was allowed is a file that changed, however it says its length.
    reply = () => new Response(new Uint8Array(10), { status: 200 });
    await expect(storage().read(KEY, { ifMatch: '"abc"', maxBytes: 5 })).rejects.toBeInstanceOf(
      StorageChanged,
    );
  });

  it('reads a file that changed (412) or went away (404) as changed, and any other failure as passing', async () => {
    for (const status of [412, 404]) {
      reply = () => new Response(null, { status });
      await expect(storage().read(KEY, { ifMatch: '"abc"', maxBytes: 5 })).rejects.toBeInstanceOf(
        StorageChanged,
      );
      await expect(storage().stream(KEY, { ifMatch: '"abc"' })).rejects.toBeInstanceOf(
        StorageChanged,
      );
    }
    reply = () => new Response(null, { status: 500 });
    await expect(storage().read(KEY, { ifMatch: '"abc"', maxBytes: 5 })).rejects.toBeInstanceOf(
      StorageUnavailable,
    );
  });

  it('streams the file, and a read that drops on the way is a passing failure, as a failed read is', async () => {
    reply = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    const chunks: number[] = [];
    for await (const chunk of await storage().stream(KEY, { ifMatch: '"abc"' }))
      chunks.push(...chunk);
    expect(chunks).toEqual([1, 2, 3]);
    expect(sent[0]?.headers.get('if-match')).toBe('"abc"');
    reply = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.error(new TypeError('terminated'));
          },
        }),
        { status: 200 },
      );
    await expect(
      (async () => {
        for await (const _ of await storage().stream(KEY, { ifMatch: '"abc"' })) {
          // reading
        }
      })(),
    ).rejects.toBeInstanceOf(StorageUnavailable);
  });

  it('stores a checked file in the media bucket for a year', async () => {
    await storage().putMedia(MEDIA_KEY, new Uint8Array([9, 9]), 'video/mp4');
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      url: `https://account.r2.example.test/media-for-tests/${MEDIA_KEY}`,
    });
    expect(sent[0]?.headers.get('content-type')).toBe('video/mp4');
    expect(sent[0]?.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    reply = () => new Response(null, { status: 403 });
    await expect(
      storage().putMedia(MEDIA_KEY, new Uint8Array(1), 'video/mp4'),
    ).rejects.toBeInstanceOf(StorageUnavailable);
  });

  it('copies between the buckets with the version checked, and reads each answer', async () => {
    reply = () =>
      new Response('<CopyObjectResult><ETag>"abc"</ETag></CopyObjectResult>', { status: 200 });
    const options = { etag: '"abc"', contentType: 'video/mp4' };
    expect(await storage().copyToMedia(KEY, MEDIA_KEY, options)).toEqual({
      status: 'copied',
      etag: '"abc"',
    });
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      url: `https://account.r2.example.test/media-for-tests/${MEDIA_KEY}`,
    });
    const headers = sent[0]?.headers;
    expect(headers?.get('x-amz-copy-source')).toBe(`/uploads-for-tests/${KEY}`);
    expect(headers?.get('x-amz-copy-source-if-match')).toBe('"abc"');
    expect(headers?.get('x-amz-metadata-directive')).toBe('REPLACE');
    expect(headers?.get('content-type')).toBe('video/mp4');
    expect(headers?.get('cache-control')).toBe('public, max-age=31536000, immutable');

    for (const [status, expected] of [
      [412, { status: 'changed' }],
      [404, { status: 'missing' }],
      [400, { status: 'refused' }],
      [403, { status: 'refused' }],
      [501, { status: 'refused' }],
    ] as const) {
      reply = () => new Response(null, { status });
      expect(await storage().copyToMedia(KEY, MEDIA_KEY, options), `${status}`).toEqual(expected);
    }
    // A copy that answers 200 with no ETag is a copy with none to compare; a 200 that holds an error isn't one.
    reply = () => new Response('<CopyObjectResult></CopyObjectResult>', { status: 200 });
    expect(await storage().copyToMedia(KEY, MEDIA_KEY, options)).toEqual({
      status: 'copied',
      etag: null,
    });
    reply = () => new Response('<Error><Code>InternalError</Code></Error>', { status: 200 });
    await expect(storage().copyToMedia(KEY, MEDIA_KEY, options)).rejects.toBeInstanceOf(
      StorageUnavailable,
    );
    reply = () => new Response(null, { status: 500 });
    await expect(storage().copyToMedia(KEY, MEDIA_KEY, options)).rejects.toBeInstanceOf(
      StorageUnavailable,
    );
  });

  it('deletes from each bucket, and never rejects, whatever happens', async () => {
    await storage().removeUpload(KEY);
    await storage().removeMedia(MEDIA_KEY);
    expect(sent.map((one) => [one.method, new URL(one.url).pathname])).toEqual([
      ['DELETE', `/uploads-for-tests/${KEY}`],
      ['DELETE', `/media-for-tests/${MEDIA_KEY}`],
    ]);
    reply = () => {
      throw new TypeError('fetch failed');
    };
    await expect(storage().removeUpload(KEY)).resolves.toBeUndefined();
    reply = () => new Response(null, { status: 500 });
    await expect(storage().removeMedia(MEDIA_KEY)).resolves.toBeUndefined();
  });

  it('compares ETags without their quotes or a weak mark', () => {
    expect(plainEtag('"abc"')).toBe('abc');
    expect(plainEtag('W/"abc"')).toBe('abc');
    expect(plainEtag('abc')).toBe('abc');
  });
});
