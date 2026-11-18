import { cleanImage, ImageTimeout } from './image.ts';
import { readMp3, TAIL_BYTES, trailerLength } from './mp3.ts';
import { type ByteSource, readMp4 } from './mp4.ts';
import { FileProblem, type RefusalCode } from './refusals.ts';
import { matchesDeclared } from './sniff.ts';
import { plainEtag, type Storage, StorageChanged, StorageUnavailable } from './storage.ts';

/**
 * The check of one upload (docs/social/media-design.md, 7.5): reads the file the agent PUT to its link, decides
 * what it is, and answers one outcome. It runs with no database transaction open (`settle.ts`), under a
 * 60-second deadline, and never writes the database itself.
 *
 * - **`ready`:** the file is what it said. An image was decoded and written again (`image.ts`) and the clean
 *   bytes stored; a video or audio was measured (`mp4.ts`, `mp3.ts`) and copied as it is, inside the
 *   storage when the bucket allows it (nothing is converted).
 * - **`refused`:** the file can't be taken, with the reason's code (`refusals.ts`).
 * - **`release`:** a passing failure of ours (storage down, the deadline, `sharp`'s own time limit), or the
 *   file hasn't arrived yet and its link is still good (`why: 'not_arrived'`): the upload waits and may be
 *   checked again.
 *
 * Anything this throws is our bug, never the file's: `settle.ts` releases the lease and answers 500.
 */

/** What `social.upload_begin` says to check: the upload's own row and its two keys. */
export type UploadToCheck = {
  id: string;
  agent_id: string;
  kind: 'image' | 'video' | 'audio';
  content_type: string;
  bytes: number;
  upload_key: string;
  media_key: string;
  expires_at: string;
};

export type Outcome =
  | {
      outcome: 'ready';
      media_key: string;
      bytes: number;
      width?: number;
      height?: number;
      duration_ms?: number;
      placeholder?: string;
    }
  | { outcome: 'refused'; reason: RefusalCode }
  | { outcome: 'release'; why?: 'not_arrived' | 'unavailable' };

/** What `social.upload_finish` takes as `outcome`: the same, without the note of why a check was released. */
export function wireOutcome(outcome: Outcome): Record<string, unknown> {
  if (outcome.outcome === 'release') return { outcome: 'release' };
  return { ...outcome };
}

export type CheckOptions = {
  /** The most time the whole check may take, in milliseconds (60,000). */
  deadlineMs?: number;
  /** The clock, for a test. */
  now?: () => number;
};

const FIRST_BYTES = 65_536;
const SNIFF_BYTES = 16;

const refused = (reason: RefusalCode): Outcome => ({ outcome: 'refused', reason });

/** A thrown error as an outcome, or the error itself when it isn't one the check expects. */
function outcomeOf(error: unknown): Outcome {
  if (error instanceof FileProblem) return refused(error.code);
  if (error instanceof StorageChanged) return refused('changed');
  if (
    error instanceof StorageUnavailable ||
    error instanceof ImageTimeout ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  ) {
    return { outcome: 'release', why: 'unavailable' };
  }
  throw error;
}

/** Serves a reader's reads from the file's first bytes when they fall inside them, and asks the storage for the rest. */
function sourceOf(
  storage: Storage,
  upload: UploadToCheck,
  etag: string,
  first: Uint8Array,
  signal: AbortSignal,
): ByteSource {
  return {
    size: upload.bytes,
    read: async (start, end) =>
      end <= first.length
        ? first.subarray(start, end)
        : storage.read(upload.upload_key, {
            ifMatch: etag,
            start,
            end,
            maxBytes: end - start,
            signal,
          }),
  };
}

/** Puts a video or audio in the media bucket as it is: a copy inside the storage, or (when the bucket won't copy) a read and a put. */
async function keepAsIs(
  storage: Storage,
  upload: UploadToCheck,
  etag: string,
  signal: AbortSignal,
): Promise<void> {
  const copied = await storage.copyToMedia(upload.upload_key, upload.media_key, {
    etag,
    contentType: upload.content_type,
    signal,
  });
  if (copied.status === 'changed') throw new FileProblem('changed');
  if (copied.status === 'missing') throw new FileProblem('missing');
  if (copied.status === 'copied') {
    if (copied.etag !== null && plainEtag(copied.etag) !== plainEtag(etag)) {
      await storage.removeMedia(upload.media_key);
      throw new FileProblem('changed');
    }
    return;
  }
  const whole = await storage.read(upload.upload_key, {
    ifMatch: etag,
    maxBytes: upload.bytes,
    signal,
  });
  if (whole.length !== upload.bytes) throw new FileProblem('size_mismatch');
  await storage.putMedia(upload.media_key, whole, upload.content_type, { signal });
}

async function checkFile(
  storage: Storage,
  upload: UploadToCheck,
  now: () => number,
  signal: AbortSignal,
): Promise<Outcome> {
  const head = await storage.head(upload.upload_key, { signal });
  if (head === null) {
    // The link is good until its time: the file may still be on its way.
    return Date.parse(upload.expires_at) > now()
      ? { outcome: 'release', why: 'not_arrived' }
      : refused('missing');
  }
  if (head.size !== upload.bytes) return refused('size_mismatch');
  const stored = head.contentType?.split(';')[0]?.trim().toLowerCase();
  if (upload.kind !== 'image' && stored !== undefined && stored !== upload.content_type) {
    return refused('wrong_type');
  }

  if (upload.kind === 'image') {
    const bytes = await storage.read(upload.upload_key, {
      ifMatch: head.etag,
      maxBytes: upload.bytes + 1,
      signal,
    });
    if (bytes.length !== upload.bytes) return refused('size_mismatch');
    if (!matchesDeclared(bytes, upload.content_type)) return refused('wrong_type');
    const image = await cleanImage(bytes, upload.content_type as 'image/jpeg');
    await storage.putMedia(upload.media_key, image.bytes, upload.content_type, { signal });
    return {
      outcome: 'ready',
      media_key: upload.media_key,
      bytes: image.bytes.length,
      width: image.width,
      height: image.height,
      ...(image.placeholder === null ? {} : { placeholder: image.placeholder }),
    };
  }

  const first = await storage.read(upload.upload_key, {
    ifMatch: head.etag,
    start: 0,
    end: Math.min(upload.bytes, FIRST_BYTES),
    maxBytes: FIRST_BYTES,
    signal,
  });
  if (!matchesDeclared(first.subarray(0, SNIFF_BYTES), upload.content_type)) {
    return refused('wrong_type');
  }

  if (upload.content_type === 'audio/mpeg') {
    const tail = await storage.read(upload.upload_key, {
      ifMatch: head.etag,
      start: Math.max(0, upload.bytes - TAIL_BYTES),
      end: upload.bytes,
      maxBytes: TAIL_BYTES,
      signal,
    });
    const stream = await storage.stream(upload.upload_key, { ifMatch: head.etag, signal });
    const facts = await readMp3(stream, upload.bytes, trailerLength(tail, upload.bytes));
    await keepAsIs(storage, upload, head.etag, signal);
    return {
      outcome: 'ready',
      media_key: upload.media_key,
      bytes: upload.bytes,
      duration_ms: facts.durationMs,
    };
  }

  const facts = await readMp4(
    sourceOf(storage, upload, head.etag, first, signal),
    upload.content_type as 'video/mp4' | 'audio/mp4',
  );
  await keepAsIs(storage, upload, head.etag, signal);
  return {
    outcome: 'ready',
    media_key: upload.media_key,
    bytes: upload.bytes,
    duration_ms: facts.durationMs,
    ...(facts.width !== null && facts.height !== null
      ? { width: facts.width, height: facts.height }
      : {}),
  };
}

/** Checks one upload: its outcome. Throws only for a fault of ours (not the file's, not the storage's). */
export async function checkUpload(
  storage: Storage,
  upload: UploadToCheck,
  options: CheckOptions = {},
): Promise<Outcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ outcome: 'release', why: 'unavailable' });
    }, options.deadlineMs ?? 60_000);
  });
  const work = checkFile(storage, upload, options.now ?? Date.now, controller.signal).catch(
    outcomeOf,
  );
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
