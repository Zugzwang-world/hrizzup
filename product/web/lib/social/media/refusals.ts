import { ORPCError } from '@orpc/server';

/**
 * Why a checked upload is refused, and how the API says it (docs/social/media-design.md, 7.6). The check
 * stores a short code on the media row (`refused_reason`); the API answers it as 422 `REFUSED` with a
 * `data.reason` the contract names (`uploadRefusals`) and words that say what to do next. Unknown codes
 * (a row an older or newer version refused) answer `media_refused`, "This upload was refused".
 */

/** Every code the check can refuse an upload with. */
export const REFUSAL_CODES = [
  'expired',
  'missing',
  'size_mismatch',
  'too_big',
  'wrong_type',
  'wrong_tracks',
  'animated',
  'too_large_image',
  'dimensions',
  'too_long',
  'fragmented',
  'unreadable',
  'changed',
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** The reasons of a 422 the check's refusals use (the contract's `uploadRefusals`). */
export type RefusalReason = 'media_refused' | 'media_kind' | 'media_too_big' | 'media_too_long';

/**
 * A file the check can't accept, found while reading it: carries the code the row is refused with. Thrown by
 * the readers (`sniff`, `image`, `mp4`, `mp3`) and caught only by `check.ts`.
 */
export class FileProblem extends Error {
  readonly code: RefusalCode;
  constructor(code: RefusalCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = 'FileProblem';
    this.code = code;
  }
}

const NO_FILE = 'No file reached its upload link in time: ask for a new link';

const WORDS: Record<RefusalCode, { reason: RefusalReason; message: string }> = {
  expired: { reason: 'media_refused', message: NO_FILE },
  missing: { reason: 'media_refused', message: NO_FILE },
  size_mismatch: {
    reason: 'media_refused',
    message: "The file isn't the size you declared: ask for a new link with its real size",
  },
  too_big: {
    reason: 'media_too_big',
    message: 'Too big for its kind, even cleaned: images are at most 10 MB',
  },
  wrong_type: {
    reason: 'media_kind',
    message:
      "The file isn't what you declared: a video needs a video track, audio a sound track and no video",
  },
  wrong_tracks: {
    reason: 'media_kind',
    message:
      "The file isn't what you declared: a video needs a video track, audio a sound track and no video",
  },
  animated: {
    reason: 'media_refused',
    message: "Animated images aren't taken: upload a still image",
  },
  too_large_image: {
    reason: 'media_refused',
    message: 'Images are at most 50 megapixels: make it smaller',
  },
  dimensions: { reason: 'media_refused', message: 'A video is at most 10,000 pixels a side' },
  too_long: {
    reason: 'media_too_long',
    message: 'Video is at most 60 seconds and audio 5 minutes: cut it',
  },
  fragmented: {
    reason: 'media_refused',
    message: "A fragmented MP4 isn't taken: export a regular one (FFmpeg: -movflags +faststart)",
  },
  unreadable: {
    reason: 'media_refused',
    message: "This file can't be read as its type: export it again",
  },
  changed: {
    reason: 'media_refused',
    message: 'The file changed after it was checked: ask for a new link and upload it again',
  },
};

const UNKNOWN = { reason: 'media_refused', message: 'This upload was refused' } as const;

/** The API's reason and words for a stored refusal code. */
export function refusalWords(code: string): { reason: RefusalReason; message: string } {
  return (WORDS as Record<string, { reason: RefusalReason; message: string }>)[code] ?? UNKNOWN;
}

/** The 422 an upload refused with this code answers, as the shared map's refusals are made. */
export function refusalError(code: string): ORPCError<string, unknown> {
  const { reason, message } = refusalWords(code);
  return new ORPCError('REFUSED', { status: 422, message, data: { reason } });
}
