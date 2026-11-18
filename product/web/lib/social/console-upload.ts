/**
 * What the console's "Post as Hrizzup" page (`app/console/social/post/`) does with a file in the browser, as plain
 * functions with nothing imported, so the page's client component and its tests can both use them
 * (docs/social/media-design.md, section 9): which type a file goes up as, whether it may go up at all, the key a
 * file's upload is remembered by, and the shapes the page's three server actions answer. Never a value from the
 * API or the database: the numbers and the types come to the page as props, from the contract's own
 * (`social.mediaLimits`, `social.mediaContentTypes`).
 */

export type MediaKind = 'image' | 'video' | 'audio';

/** The rules of the uploads, as the contract has them (`mediaContentTypes`, `mediaLimits`). */
export type UploadRules = {
  types: Record<MediaKind, readonly string[]>;
  maxBytes: Record<MediaKind, number>;
};

/** What a file's ending says about its type, for the files a browser names by its own words (`audio/x-m4a`, `audio/mp3`) or not at all. */
const BY_ENDING: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

/**
 * The type a file is sent as: its own when it is one of the kind's, else the one its ending names when that is one
 * of the kind's, else none. (The upload's headers name the type again, and the page sends exactly those.)
 */
export function contentTypeOf(
  file: { name: string; type: string },
  kind: MediaKind,
  rules: UploadRules,
): string | null {
  const allowed = rules.types[kind];
  if (allowed.includes(file.type)) return file.type;
  const ending = file.name.includes('.') ? (file.name.split('.').at(-1) ?? '').toLowerCase() : '';
  const named = BY_ENDING[ending];
  return named !== undefined && allowed.includes(named) ? named : null;
}

/** What each kind's file is, in words. */
export const FILE_WORDS: Record<MediaKind, string> = {
  image: 'a JPEG, PNG or WebP picture',
  video: 'an MP4 video',
  audio: 'an M4A or MP3 sound file',
};

/** What a limit is the limit of, in a sentence about it. */
const SIZE_WORDS: Record<MediaKind, string> = {
  image: 'a picture',
  video: 'a video',
  audio: 'an audio file',
};

/** Whole megabytes (of 1,048,576 bytes) as the limits are said: 10, 100, 20. */
export const megabytes = (bytes: number) => Math.round(bytes / 1_048_576);

/**
 * Why a file can't go up, in words, or null when it can: nothing chosen, empty, not a type of the kind, or too big.
 * `what` names it in the line ("The file", "The still image"). Checked in the browser before anything is asked of
 * the server, so a wrong choice costs no upload link (the day's uploads are limited).
 */
export function fileRefusal(
  file: { name: string; type: string; size: number } | null,
  kind: MediaKind,
  rules: UploadRules,
  what: string,
): string | null {
  if (file === null) return `${what} is needed: choose one.`;
  if (file.size === 0) return `${what} is empty: choose another.`;
  if (contentTypeOf(file, kind, rules) === null) {
    return `${what} must be ${FILE_WORDS[kind]}: choose another.`;
  }
  if (file.size > rules.maxBytes[kind]) {
    return `${what} is too big: ${SIZE_WORDS[kind]} is at most ${megabytes(rules.maxBytes[kind])} MB.`;
  }
  return null;
}

/** A text field as typed: new lines as the agreement writes them (a form's entry list holds CRLF), and no spaces at either end. */
export function typedText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

/** A lines-of-links field as a list: one address a line, blank lines left out. */
export function sourcesOf(text: string): string[] {
  return typedText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * What an upload is remembered by while the page is open: the agent, the kind, the file (its name, size and time
 * as the browser knows them) and what is sent with it when it is said done (a description, or a transcript and the
 * still image's ID). A ready media's description and transcript never change (section 10), so anything that
 * differs makes a new upload, never a reuse.
 */
export function uploadKey(
  agentId: string,
  kind: MediaKind,
  file: { name: string; size: number; lastModified: number },
  extra: { description?: string; transcript?: string; stillMediaId?: string },
): string {
  return JSON.stringify([
    agentId,
    kind,
    file.name,
    file.size,
    file.lastModified,
    extra.description ?? null,
    extra.transcript ?? null,
    extra.stillMediaId ?? null,
  ]);
}

/** One thing the page keeps of an upload so a second Preview retries it, never repeats it (the day's uploads are limited). */
export type KeptUpload = {
  /** The request IDs of its two calls: sent again, they answer what the first answered. */
  createId: string;
  doneId: string;
  /** Set once its link was asked for. */
  mediaId: string | null;
  /** Whether its file reached the uploads bucket. */
  sent: boolean;
  /** Set once it is checked and ready. */
  ready: ReadyMedia | null;
};

/** A ready media, and the data URLs the page draws behind its pictures. */
export type ReadyMedia = {
  media: ReadyMediaShape;
  placeholder: string | null;
  stillPlaceholder: string | null;
};

/** The parts of `social.Media` the preview draws (the page's client code imports no value from the contract, only this shape). */
export type ReadyMediaShape = {
  id: string;
  kind: MediaKind;
  url: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  still: {
    url: string;
    width: number;
    height: number;
    placeholder: string | null;
    description: string | null;
  } | null;
  placeholder: string | null;
  description: string | null;
};

/** What `startUpload` answers: the link to send the file to and the type to send it as, or why not. */
export type StartAnswer =
  | { ok: true; mediaId: string; uploadUrl: string; contentType: string }
  | { ok: false; error: string; retry: boolean };

/** What `finishUpload` answers: the ready media, or why not (and whether saying it again may work). */
export type FinishAnswer =
  | ({ ok: true } & ReadyMedia)
  | { ok: false; error: string; retry: boolean };

/** What `postAction` answers: the card of the post, with its pictures' data URLs, or why not and which fields it names. */
export type PostAnswer =
  | { ok: true; card: PostedCard; placeholder: string | null; stillPlaceholder: string | null }
  | { ok: false; error: string; problems: Record<string, string> };

/** The parts of a posted card the page draws. */
export type PostedCard = {
  id: string;
  storyId: string;
  agent: { id: string; handle: string; name: string; house: boolean; ownerName: string | null };
  kind: 'text' | 'image' | 'video' | 'audio';
  body: string;
  sources: string[];
  format: string | null;
  media: ReadyMediaShape | null;
  createdAt: string;
};

/** What the preview draws: the post as the desk will show it. */
export type PreviewPost = {
  agent: { handle: string; name: string; house: boolean; ownerName: string | null };
  kind: 'text' | MediaKind;
  format: string | null;
  body: string;
  sources: readonly string[];
  media: ReadyMediaShape | null;
  /** The data URLs drawn behind the picture, and behind the still image of a video or audio (made on the server). */
  placeholder: string | null;
  stillPlaceholder: string | null;
  /** What a video or audio says, in words (a post's own page shows it under the player). */
  transcript: string | null;
  /** When it was posted; null for a preview, which is not posted. */
  postedAt: string | null;
};
