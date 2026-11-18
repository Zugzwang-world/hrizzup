import { describe, expect, it, vi } from 'vitest';
import { checkUpload, type Outcome, type UploadToCheck, wireOutcome } from './check.ts';
import { type MemoryStorage, memoryStorage } from './memory-storage.ts';
import { sampleJpeg, sampleM4a, sampleMp3, sampleMp4, samplePng } from './samples.ts';
import { type Storage, StorageUnavailable } from './storage.ts';

/**
 * The check of one upload (docs/social/media-design.md, 7.5), against both buckets in memory: each outcome, the
 * copy's `If-Match` failing and its fallback, and a release on a failure or the deadline.
 */

const AGENT = '01a1e3a0-ab00-7ef9-810c-37c5772f543f';
const MEDIA_ID = '01a1e8e9-d140-77df-97c6-c25422098110';
const EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
} as const;

/** What `upload_begin` would answer for a file of this type and size, with a link good for ten more minutes. */
function uploadFor(
  contentType: keyof typeof EXTENSION,
  bytes: number,
  changes: Partial<UploadToCheck> = {},
): UploadToCheck {
  const kind = contentType.startsWith('image/')
    ? 'image'
    : contentType.startsWith('video/')
      ? 'video'
      : 'audio';
  return {
    id: MEDIA_ID,
    agent_id: AGENT,
    kind,
    content_type: contentType,
    bytes,
    upload_key: `social/${AGENT}/${MEDIA_ID}`,
    media_key: `social/${AGENT}/${MEDIA_ID}.${EXTENSION[contentType]}`,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...changes,
  };
}

/** A bucket pair holding `file` at the upload's key, and the upload that names it. */
function put(
  file: Uint8Array,
  contentType: keyof typeof EXTENSION,
  changes: Partial<UploadToCheck> = {},
) {
  const storage = memoryStorage();
  const upload = uploadFor(contentType, file.length, changes);
  storage.put(upload.upload_key, file, contentType);
  return { storage, upload };
}

const ready = (outcome: Outcome) => {
  if (outcome.outcome !== 'ready')
    throw new Error(`expected ready, got ${JSON.stringify(outcome)}`);
  return outcome;
};

describe('an image', () => {
  it('is cleaned, stored under its media key for a year, and ready with its size and placeholder', async () => {
    const file = await sampleJpeg({ width: 40, height: 20, orientation: 6, location: true });
    const { storage, upload } = put(file, 'image/jpeg');
    const outcome = ready(await checkUpload(storage, upload));
    expect(outcome).toMatchObject({ media_key: upload.media_key, width: 20, height: 40 });
    expect(outcome.placeholder).toMatch(/^[A-Za-z0-9+/]{16,100}={0,2}$/);
    const stored = storage.media.get(upload.media_key);
    expect(stored?.contentType).toBe('image/jpeg');
    expect(stored?.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(outcome.bytes).toBe(stored?.bytes.length);
    expect(Buffer.from(stored?.bytes ?? []).includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(
      false,
    );
    // The check never deletes the upload: that is for after the answer is committed.
    expect(storage.uploads.has(upload.upload_key)).toBe(true);
    expect(wireOutcome(outcome)).toEqual(outcome);
  });

  it('is refused as it is found: wrong type, wrong size, unreadable, and nothing is stored', async () => {
    const png = await samplePng({ width: 20, height: 20 });
    const wrongType = put(png, 'image/jpeg');
    expect(await checkUpload(wrongType.storage, wrongType.upload)).toEqual({
      outcome: 'refused',
      reason: 'wrong_type',
    });
    const wrongSize = put(png, 'image/png', { bytes: png.length + 1 });
    expect(await checkUpload(wrongSize.storage, wrongSize.upload)).toEqual({
      outcome: 'refused',
      reason: 'size_mismatch',
    });
    const junk = put(Buffer.from('this is not a picture, but long enough'), 'image/png');
    // Its first bytes aren't a PNG's: the real type is wrong.
    expect(await checkUpload(junk.storage, junk.upload)).toEqual({
      outcome: 'refused',
      reason: 'wrong_type',
    });
    for (const one of [wrongType, wrongSize, junk]) expect(one.storage.media.size).toBe(0);
  });
});

describe('a file that has not arrived', () => {
  it('is released while its link is good, and refused as missing once it is not', async () => {
    const storage = memoryStorage();
    expect(await checkUpload(storage, uploadFor('image/png', 100))).toEqual({
      outcome: 'release',
      why: 'not_arrived',
    });
    const expired = uploadFor('image/png', 100, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await checkUpload(storage, expired)).toEqual({ outcome: 'refused', reason: 'missing' });
    // The note of why isn't sent to the database.
    expect(wireOutcome({ outcome: 'release', why: 'not_arrived' })).toEqual({ outcome: 'release' });
  });
});

describe('a video', () => {
  const file = () =>
    sampleMp4({ seconds: 3, width: 1080, height: 1920, tracks: ['video', 'audio'] });

  it('is measured and copied as it is, with its length and size', async () => {
    const { storage, upload } = put(file(), 'video/mp4');
    const outcome = ready(await checkUpload(storage, upload));
    expect(outcome).toEqual({
      outcome: 'ready',
      media_key: upload.media_key,
      bytes: file().length,
      duration_ms: 3000,
      width: 1080,
      height: 1920,
    });
    const stored = storage.media.get(upload.media_key);
    expect(Buffer.from(stored?.bytes ?? []).equals(file())).toBe(true);
    expect(stored?.contentType).toBe('video/mp4');
    expect(stored?.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(storage.log.some((line) => line.startsWith('copyToMedia'))).toBe(true);
    expect(storage.log.some((line) => line.startsWith('putMedia'))).toBe(false);
  });

  it('is read and put when the bucket refuses to copy between buckets, and says so in the log', async () => {
    const { storage, upload } = put(file(), 'video/mp4');
    storage.copies = 'refuse';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outcome = ready(await checkUpload(storage, upload));
    expect(warn).toHaveBeenCalledTimes(1);
    const said = String(warn.mock.calls[0]?.[0]);
    expect(said).toContain('would not copy between buckets');
    expect(said).not.toContain(upload.upload_key);
    warn.mockRestore();
    expect(outcome.duration_ms).toBe(3000);
    expect(Buffer.from(storage.media.get(upload.media_key)?.bytes ?? []).equals(file())).toBe(true);
    expect(storage.log.some((line) => line.startsWith('putMedia'))).toBe(true);
  });

  it('is refused as changed when the file is replaced after its check began (the copy’s If-Match fails)', async () => {
    const { storage, upload } = put(file(), 'video/mp4');
    storage.onCall = (name) => {
      if (name === 'copyToMedia')
        storage.replace(upload.upload_key, Buffer.concat([file(), Buffer.from('x')]));
    };
    expect(await checkUpload(storage, upload)).toEqual({ outcome: 'refused', reason: 'changed' });
    expect(storage.media.size).toBe(0);
  });

  it('is refused as changed when a read finds another version, and when a copy answers another ETag (the copy is deleted)', async () => {
    const reading = put(file(), 'video/mp4');
    reading.storage.onCall = (name) => {
      if (name === 'read') reading.storage.replace(reading.upload.upload_key, file());
    };
    // Replacing with the same bytes keeps the ETag (md5): replace with different ones.
    reading.storage.onCall = (name) => {
      if (name === 'read')
        reading.storage.replace(
          reading.upload.upload_key,
          Buffer.concat([file(), Buffer.from('y')]),
        );
    };
    expect(await checkUpload(reading.storage, reading.upload)).toEqual({
      outcome: 'refused',
      reason: 'changed',
    });

    const { storage, upload } = put(file(), 'video/mp4');
    const other: Storage = {
      ...storage,
      copyToMedia: async (uploadKey, mediaKey, options) => {
        const copied = await storage.copyToMedia(uploadKey, mediaKey, options);
        return copied.status === 'copied'
          ? { status: 'copied', etag: '"not-the-one-checked"' }
          : copied;
      },
    };
    expect(await checkUpload(other, upload)).toEqual({ outcome: 'refused', reason: 'changed' });
    expect(storage.media.has(upload.media_key)).toBe(false);
  });

  it('is refused when it is the wrong kind of file, too long or fragmented', async () => {
    const png = put(await samplePng({ width: 20, height: 20 }), 'video/mp4');
    expect(await checkUpload(png.storage, png.upload)).toEqual({
      outcome: 'refused',
      reason: 'wrong_type',
    });
    const long = put(
      sampleMp4({ seconds: 61, width: 10, height: 10, tracks: ['video'] }),
      'video/mp4',
    );
    expect(await checkUpload(long.storage, long.upload)).toEqual({
      outcome: 'refused',
      reason: 'too_long',
    });
    const fragmented = put(
      sampleMp4({ seconds: 3, width: 10, height: 10, tracks: ['video'], fragmented: true }),
      'video/mp4',
    );
    expect(await checkUpload(fragmented.storage, fragmented.upload)).toEqual({
      outcome: 'refused',
      reason: 'fragmented',
    });
    const sound = put(
      sampleMp4({ seconds: 3, width: 10, height: 10, tracks: ['audio'] }),
      'video/mp4',
    );
    expect(await checkUpload(sound.storage, sound.upload)).toEqual({
      outcome: 'refused',
      reason: 'wrong_tracks',
    });
    for (const one of [png, long, fragmented, sound]) expect(one.storage.media.size).toBe(0);
  });

  it('is refused as wrong_type when the stored type isn’t the declared one', async () => {
    const storage = memoryStorage();
    const upload = uploadFor('video/mp4', file().length);
    storage.put(upload.upload_key, file(), 'video/quicktime');
    expect(await checkUpload(storage, upload)).toEqual({
      outcome: 'refused',
      reason: 'wrong_type',
    });
  });
});

describe('audio', () => {
  it('an M4A is measured (no size) and copied', async () => {
    const m4a = sampleM4a({ seconds: 151 });
    const { storage, upload } = put(m4a, 'audio/mp4');
    expect(ready(await checkUpload(storage, upload))).toEqual({
      outcome: 'ready',
      media_key: upload.media_key,
      bytes: m4a.length,
      duration_ms: 151_000,
    });
    expect(storage.media.get(upload.media_key)?.contentType).toBe('audio/mp4');
  });

  it('an MP3 is walked frame by frame, behind its tags, and copied', async () => {
    const mp3 = Buffer.concat([
      sampleMp3({ seconds: 4, id3: 5000 }),
      Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)]),
    ]);
    const { storage, upload } = put(mp3, 'audio/mpeg');
    const outcome = ready(await checkUpload(storage, upload));
    expect(outcome.duration_ms).toBe(Math.ceil((153 * 1152 * 1000) / 44_100));
    expect(Buffer.from(storage.media.get(upload.media_key)?.bytes ?? []).equals(mp3)).toBe(true);
    expect(storage.log.some((line) => line.startsWith('stream'))).toBe(true);
  });

  it('an MP3 that is 5 minutes and a frame is too long, and an MP4 declared as MP3 is the wrong type', async () => {
    const long = put(sampleMp3({ frames: 11_485 }), 'audio/mpeg');
    expect(await checkUpload(long.storage, long.upload)).toEqual({
      outcome: 'refused',
      reason: 'too_long',
    });
    const mp4 = put(sampleM4a({ seconds: 3 }), 'audio/mpeg');
    expect(await checkUpload(mp4.storage, mp4.upload)).toEqual({
      outcome: 'refused',
      reason: 'wrong_type',
    });
  });
});

describe('a failure that is ours, not the file’s', () => {
  it('is a release when the storage fails, whichever call it is', async () => {
    for (const name of ['head', 'read', 'putMedia', 'copyToMedia', 'stream']) {
      const mp3 = name === 'stream';
      const file = mp3
        ? sampleMp3({ seconds: 2 })
        : name === 'putMedia'
          ? await samplePng({ width: 30, height: 30 })
          : sampleMp4({ seconds: 3, width: 10, height: 10, tracks: ['video'] });
      const { storage, upload } = put(
        file,
        mp3 ? 'audio/mpeg' : name === 'putMedia' ? 'image/png' : 'video/mp4',
      );
      storage.fail.add(name);
      expect(await checkUpload(storage, upload), name).toEqual({
        outcome: 'release',
        why: 'unavailable',
      });
      expect(storage.media.size, name).toBe(0);
    }
  });

  it('is a release when the check passes its deadline, and the storage is told to stop', async () => {
    const { storage, upload } = put(await samplePng({ width: 10, height: 10 }), 'image/png');
    let stopped = false;
    const slow: Storage = {
      ...storage,
      head: (_key, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            stopped = true;
            reject(new StorageUnavailable('aborted'));
          });
        }),
    };
    expect(await checkUpload(slow, upload, { deadlineMs: 30 })).toEqual({
      outcome: 'release',
      why: 'unavailable',
    });
    expect(stopped).toBe(true);
  });

  it('throws an error that is none of those (our bug), for the caller to release and answer 500', async () => {
    const { storage, upload } = put(await samplePng({ width: 10, height: 10 }), 'image/png');
    const broken: MemoryStorage = Object.assign(storage, {
      putMedia: async () => {
        throw new TypeError('a bug of ours');
      },
    });
    await expect(checkUpload(broken, upload)).rejects.toThrow('a bug of ours');
  });
});
