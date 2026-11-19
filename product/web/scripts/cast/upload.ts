import { createHash } from 'node:crypto';
import type { Ctx } from './context.ts';
import { noAnswer, refuse } from './errors.ts';
import { inFolder, memberOf } from './files.ts';
import { assertUploadLink } from './guard.ts';
import { reasonOf, refusedBy, sendRaw } from './http.ts';
import { MAX_ATTEMPT } from './ids.ts';
import { object, text } from './lenient.ts';
import { appendLog } from './log.ts';
import { learn } from './redact.ts';
import { needOpenRun, readState } from './state.ts';

/**
 * `upload <member> <file> (--description f | --transcript f --still <id>)` (rule 16): asks for the
 * one-time link, sends the file to it, says it is done, and prints the media's id. The file comes
 * only from `<store>/work/`; its type is worked out from its first bytes, never from its name.
 * The link's host and bucket are checked before any byte goes to it, and no credential goes with it.
 */

export type MediaKind = 'image' | 'video' | 'audio';

/** The limits of `GET /social/formats` (`mediaLimits` in the API's contract; a test holds the two equal). */
export const LIMITS: Record<MediaKind, number> = {
  image: 10_485_760,
  video: 104_857_600,
  audio: 20_971_520,
};

const startsWith = (head: Uint8Array, at: number, bytes: readonly number[]) =>
  head.length >= at + bytes.length && bytes.every((byte, i) => head[at + i] === byte);

const ascii = (word: string) => [...word].map((letter) => letter.charCodeAt(0));

/** Brands that mark an MP4 container as audio only (M4A, M4B, and the older F4A). */
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'F4A ']);

/** What a file is, from its first bytes (JPEG, PNG, WebP, MP4, M4A, MP3), or null. */
export function sniffFile(head: Uint8Array): { kind: MediaKind; contentType: string } | null {
  if (startsWith(head, 0, [0xff, 0xd8, 0xff])) return { kind: 'image', contentType: 'image/jpeg' };
  if (startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', contentType: 'image/png' };
  }
  if (startsWith(head, 0, ascii('RIFF')) && startsWith(head, 8, ascii('WEBP'))) {
    return { kind: 'image', contentType: 'image/webp' };
  }
  if (startsWith(head, 4, ascii('ftyp'))) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    return AUDIO_BRANDS.has(brand)
      ? { kind: 'audio', contentType: 'audio/mp4' }
      : { kind: 'video', contentType: 'video/mp4' };
  }
  const [b0, b1] = [head[0], head[1]];
  const frame =
    b0 === 0xff &&
    b1 !== undefined &&
    (b1 & 0xe0) === 0xe0 &&
    ((b1 >> 3) & 3) !== 1 &&
    ((b1 >> 1) & 3) === 1;
  if (startsWith(head, 0, ascii('ID3')) || frame)
    return { kind: 'audio', contentType: 'audio/mpeg' };
  return null;
}

export type UploadArgs = {
  member: string;
  file: string;
  description?: string;
  transcript?: string;
  still?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WAITS_MS = [2_000, 8_000, 30_000];

/** Reads a line of words from a file in `work/` (the description or the transcript), trimmed at both ends. */
function words(ctx: Ctx, name: string, what: string, max: number): string {
  const content = ctx.store.readText(inFolder(ctx, 'work', name));
  const trimmed = content?.trim();
  if (!trimmed) throw refuse(`The ${what} file is missing or empty`);
  if ([...trimmed].length > max) throw refuse(`The ${what} is over ${max} characters`);
  return trimmed;
}

/** Sends the file to its link. Answers the status; a failure to get any answer is retried, then exit 3. */
async function put(
  ctx: Ctx,
  link: string,
  headers: Record<string, string>,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<number> {
  for (let tried = 0; ; tried++) {
    try {
      const response = await ctx.fetch(link, {
        method: 'PUT',
        headers,
        body: bytes,
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      });
      await response.arrayBuffer();
      if (response.status >= 500 && WAITS_MS[tried] !== undefined) {
        await ctx.clock.sleep(WAITS_MS[tried] ?? 0);
        continue;
      }
      return response.status;
    } catch (error) {
      const cause = String(
        (error as { cause?: { message?: unknown } } | null)?.cause?.message ?? '',
      );
      if (/redirect/i.test(cause)) throw refuse('PUT upload link was redirected: refused');
      const waited = WAITS_MS[tried];
      if (waited === undefined) throw noAnswer('PUT upload link got no answer');
      await ctx.clock.sleep(waited);
    }
  }
}

export async function uploadCommand(ctx: Ctx, args: UploadArgs): Promise<void> {
  const who = memberOf(ctx, args.member);
  const run = needOpenRun(readState(ctx.store));
  const bytes = ctx.store.readBytes(inFolder(ctx, 'work', args.file));
  if (!bytes || bytes.length === 0) throw refuse('The file is missing or empty');
  const sniffed = sniffFile(bytes.subarray(0, 16));
  if (!sniffed) throw refuse('The file is not a JPEG, PNG, WebP, MP4, M4A or MP3');
  const { kind, contentType } = sniffed;
  if (bytes.length > LIMITS[kind]) {
    throw refuse(`A ${kind} is at most ${LIMITS[kind]} bytes; this one is ${bytes.length}`);
  }

  // What saying it is done must carry: an image its description; a video or audio its transcript and still.
  let done: Record<string, unknown>;
  if (kind === 'image') {
    if (args.transcript !== undefined || args.still !== undefined) {
      throw refuse('An image takes --description only');
    }
    if (args.description === undefined) throw refuse('An image needs --description <file>');
    done = { description: words(ctx, args.description, 'description', 1000) };
  } else {
    if (args.description !== undefined)
      throw refuse('A video or audio takes --transcript and --still, not a description');
    if (args.transcript === undefined) throw refuse(`A ${kind} needs --transcript <file>`);
    if (!args.still || !UUID.test(args.still)) throw refuse(`A ${kind} needs --still <media id>`);
    done = {
      transcript: words(ctx, args.transcript, 'transcript', 20_000),
      stillMediaId: args.still,
    };
  }

  const fileSha256 = createHash('sha256').update(bytes).digest('hex');
  for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
    const id = { subject: who.entry.handle, run: run.n, fileSha256, attempt };
    // 1. The link. A link that has already run out is a dead replay: the next attempt is a new request.
    const asked = {
      method: 'POST',
      path: '/social/me/uploads',
      key: who.key,
      body: { kind, contentType, bytes: bytes.length },
      id,
    } as const;
    const link = await sendRaw(ctx, asked);
    if (!link.ok) throw refusedBy(asked, link);
    const media = object(link.body.media);
    const mediaId = text(media.id);
    const uploadUrl = text(link.body.uploadUrl);
    const sent = object(link.body.headers);
    if (!mediaId || !uploadUrl) throw refuse('The upload answer has no link: refused');
    learn(uploadUrl);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(sent))
      if (typeof value === 'string') headers[name] = value;
    const expires = Date.parse(text(link.body.expiresAt) ?? '');
    if (Number.isFinite(expires) && expires <= ctx.clock.now()) continue;
    assertUploadLink(uploadUrl, headers);

    // 2. The file, to the link, with exactly the headers the API gave.
    const status = await put(ctx, uploadUrl, headers, bytes as Uint8Array<ArrayBuffer>);
    if (status === 403 || status === 400) continue; // the link has run out, or was refused
    if (status < 200 || status >= 300) throw refuse(`PUT upload link was refused (${status})`);

    // 3. Say it is done, so it is checked.
    const finish = {
      method: 'POST',
      path: `/social/me/uploads/${mediaId}/done`,
      key: who.key,
      body: done,
      id,
    } as const;
    const answer = await sendRaw(ctx, finish);
    if (answer.status === 422 && reasonOf(answer.body) === 'media_refused') continue; // refused stays refused
    if (!answer.ok) throw refusedBy(finish, answer);
    appendLog(ctx.store, run.n, {
      t: new Date(ctx.clock.now()).toISOString(),
      member: who.member.key,
      type: 'upload',
      mediaId,
      kind,
      fileSha256,
    });
    ctx.io.out(mediaId);
    return;
  }
  throw refuse(`${args.member}: the upload did not become ready in ${MAX_ATTEMPT} attempts`);
}
