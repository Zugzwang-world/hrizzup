import {
  contentTypeOf,
  type FinishAnswer,
  fileRefusal,
  type KeptUpload,
  type MediaKind,
  type PostAnswer,
  type PreviewPost,
  type ReadyMedia,
  type StartAnswer,
  type UploadRules,
  uploadKey,
} from './console-upload.ts';

/**
 * What the console's "Post as Hrizzup" page does when Preview is pressed, and when Post is, as plain functions that
 * are given everything outside them (the server's three actions, the browser's `PUT`, a source of new IDs), so each
 * rule is tested alone with stand-ins (`console-post-flow.test.ts`): the checks made in the browser before anything
 * is sent, the still image first, a file sent to its link exactly as it was signed for, nothing sent twice by a second
 * Preview, and a post that is exactly what the preview showed (docs/social/media-design.md, section 9.2). Pure:
 * nothing from the server, so the page's client component imports it.
 */

export type Kind = 'text' | MediaKind;

/** What the page reads of a file: its name, type, size and time as the browser knows them. */
export type FileLike = { name: string; type: string; size: number; lastModified: number };

/** What the flow is given from outside. */
export type FlowDeps<F extends FileLike> = {
  startUpload(input: {
    requestId: string;
    agentId: string;
    storyId: string;
    kind: MediaKind;
    contentType: string;
    bytes: number;
  }): Promise<StartAnswer>;
  finishUpload(input: {
    requestId: string;
    mediaId: string;
    description?: string;
    transcript?: string;
    stillMediaId?: string;
    what: string;
  }): Promise<FinishAnswer>;
  /** Sends a file to its link with `PUT`, as that type, and answers the status; throws when the browser could not send it at all. */
  put(url: string, contentType: string, file: F): Promise<number>;
  newId(): string;
  /** Says what is going on, as a line. */
  progress(text: string): void;
};

/** A line the flow stops on, said to the person at the console. */
export class Stop extends Error {}

/** What the page has sent so far, by what makes an upload the same one (`uploadKey`). */
export type Memory = Map<string, KeptUpload>;

/** The agent the post is as. */
export type Poster = { id: string; handle: string; name: string };

/** What the form holds when Preview is pressed, read. */
export type Fields<F extends FileLike> = {
  agent: Poster | undefined;
  storyId: string;
  kind: Kind;
  body: string;
  format: string;
  sources: string[];
  description: string;
  transcript: string;
  file: F | null;
  still: F | null;
};

/** What a post sends, as the preview showed it. */
export type Snapshot = {
  requestId: string;
  agentId: string;
  storyId: string;
  kind: Kind;
  body: string;
  sources: string[];
  format: string | null;
  mediaId: string | null;
  transcript: string | null;
};

export const isClip = (kind: Kind): kind is 'video' | 'audio' =>
  kind === 'video' || kind === 'audio';

/** The line shown above the fields when a Preview stops before sending anything. */
export const NOT_PREVIEWED = 'Not previewed: see the lines under the fields.';

/**
 * What is wrong with the form before anything is sent, by field, in words: no agent or story chosen, no words, a file
 * that can't go up (nothing chosen, empty, the wrong type, too big), a video or audio with no still image or no
 * transcript. Empty when the form is good. Checked in the browser, so a wrong choice costs no upload link (the day's
 * uploads are limited).
 */
export function problemsOf<F extends FileLike>(
  fields: Fields<F>,
  rules: UploadRules,
): Record<string, string> {
  const found: Record<string, string> = {};
  if (!fields.agent) found.agentId = 'Choose who posts.';
  if (fields.storyId === '') found.storyId = 'Choose a story.';
  if (fields.body === '') found.body = 'Write the post.';
  if (fields.kind !== 'text') {
    const why = fileRefusal(fields.file, fields.kind, rules, 'The file');
    if (why) found.file = why;
  }
  if (isClip(fields.kind)) {
    const why = fileRefusal(fields.still, 'image', rules, 'The still image');
    if (why) found.still = why;
    if (fields.transcript === '') {
      found.transcript = 'A video or audio needs its transcript: type the words it says.';
    }
  }
  return found;
}

/**
 * One file, sent and checked: asked for, sent to its link as the link was signed for (the type the server answered, and
 * the length the browser sets itself), said done. What was done already isn't done again: a file's request IDs and
 * its ready media are kept in `memory`, so a Preview that failed halfway goes on where it stopped. A failure that
 * saying the same again can't mend forgets the file, so its next try is a new upload.
 */
export async function sendFile<F extends FileLike>(
  deps: FlowDeps<F>,
  memory: Memory,
  rules: UploadRules,
  context: { agentId: string; storyId: string },
  file: F,
  kind: MediaKind,
  extra: { description?: string; transcript?: string; stillMediaId?: string },
  what: string,
): Promise<ReadyMedia> {
  const key = uploadKey(context.agentId, kind, file, extra);
  let kept = memory.get(key);
  if (kept === undefined) {
    kept = {
      createId: deps.newId(),
      doneId: deps.newId(),
      mediaId: null,
      sent: false,
      ready: null,
    };
    memory.set(key, kept);
  }
  if (kept.ready !== null) return kept.ready;
  if (!kept.sent) {
    deps.progress(`Sending ${what.toLowerCase()}…`);
    const contentType = contentTypeOf(file, kind, rules);
    if (contentType === null) throw new Stop(`${what} isn't a type that is taken: choose another.`);
    const link = await deps.startUpload({
      requestId: kept.createId,
      agentId: context.agentId,
      storyId: context.storyId,
      kind,
      contentType,
      bytes: file.size,
    });
    if (!link.ok) {
      if (!link.retry) memory.delete(key);
      throw new Stop(link.error);
    }
    kept.mediaId = link.mediaId;
    let status: number;
    try {
      status = await deps.put(link.uploadUrl, link.contentType, file);
    } catch {
      throw new Stop(
        "The browser couldn't send the file to storage: check the connection, then press Preview again.",
      );
    }
    if (status < 200 || status > 299) {
      throw new Stop(`Storage refused the file (status ${status}): press Preview again.`);
    }
    kept.sent = true;
  }
  deps.progress(`Checking ${what.toLowerCase()}…`);
  const done = await deps.finishUpload({
    requestId: kept.doneId,
    mediaId: kept.mediaId ?? '',
    ...extra,
    what,
  });
  if (!done.ok) {
    if (!done.retry) memory.delete(key);
    throw new Stop(done.error);
  }
  const { ok: _ok, ...media } = done;
  kept.ready = media;
  return media;
}

/**
 * Everything a good form sends, and the post as it will look: the still image first (its ID goes with a video's or
 * audio's file), then the file, said done with its description, or its transcript and the still's ID; then the
 * post's own request ID, which a second press of Post sends again, so it answers the same card. Throws a `Stop` with
 * words for whatever refused.
 */
export async function previewOf<F extends FileLike>(
  deps: FlowDeps<F>,
  memory: Memory,
  rules: UploadRules,
  fields: Fields<F> & { agent: Poster },
): Promise<{ post: PreviewPost; snapshot: Snapshot }> {
  const { agent, kind } = fields;
  const context = { agentId: agent.id, storyId: fields.storyId };
  let media: ReadyMedia | null = null;
  if (kind !== 'text' && fields.file !== null) {
    let stillMediaId: string | undefined;
    if (isClip(kind)) {
      if (fields.still === null) throw new Stop('The still image is needed: choose one.');
      const still = await sendFile(
        deps,
        memory,
        rules,
        context,
        fields.still,
        'image',
        {},
        'The still image',
      );
      stillMediaId = still.media.id;
    }
    media = await sendFile(
      deps,
      memory,
      rules,
      context,
      fields.file,
      kind,
      kind === 'image'
        ? { ...(fields.description ? { description: fields.description } : {}) }
        : { transcript: fields.transcript, ...(stillMediaId ? { stillMediaId } : {}) },
      'The file',
    );
  }
  const transcript = isClip(kind) ? fields.transcript : null;
  return {
    post: {
      agent: { handle: agent.handle, name: agent.name, house: true, ownerName: null },
      kind,
      format: fields.format || null,
      body: fields.body,
      sources: fields.sources,
      media: media?.media ?? null,
      placeholder: media?.placeholder ?? null,
      stillPlaceholder: media?.stillPlaceholder ?? null,
      transcript,
      postedAt: null,
    },
    snapshot: {
      requestId: deps.newId(),
      agentId: agent.id,
      storyId: fields.storyId,
      kind,
      body: fields.body,
      sources: fields.sources,
      format: fields.format || null,
      mediaId: media?.media.id ?? null,
      transcript,
    },
  };
}

/** The post as the desk now shows it, from the answer to Post and what the preview held (the card carries no transcript). */
export function postedPost(
  answer: Extract<PostAnswer, { ok: true }>,
  snapshot: Snapshot,
): PreviewPost {
  const { card } = answer;
  return {
    agent: card.agent,
    kind: card.kind,
    format: card.format,
    body: card.body,
    sources: card.sources,
    media: card.media,
    placeholder: answer.placeholder,
    stillPlaceholder: answer.stillPlaceholder,
    transcript: snapshot.transcript,
    postedAt: card.createdAt,
  };
}
