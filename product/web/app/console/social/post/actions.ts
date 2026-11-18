'use server';

import type { social } from '@hrizzup/api';
import { notFound, redirect } from 'next/navigation';
import { serverApi } from '@/lib/api/server.ts';
import { newRecordId } from '@/lib/record-id.ts';
import { field, type SocialFormState, typed } from '@/lib/social/console-forms.ts';
import { adminOrNotFound } from '@/lib/social/console-page.ts';
import {
  keptPostRefusal,
  MAKE_FIELDS,
  POST_FIELDS,
  pageRefusal,
  type Step,
} from '@/lib/social/console-post.ts';
import type {
  FinishAnswer,
  MediaKind,
  PostAnswer,
  StartAnswer,
} from '@/lib/social/console-upload.ts';
import { placeholderDataUrl } from '@/lib/social/media/placeholder.ts';

/**
 * The console's "Post as Hrizzup" page's calls (docs/social/media-design.md, section 9.2 and 9.3), each sent from the
 * page's client component (`post-form.tsx`) as a server action. Each asks first that the signed-in account is an admin
 * (`adminOrNotFound`: anyone else gets "not found" before anything sent is read), then sends one of the console's
 * calls through the typed API, in process, which checks it again and logs it. Every refusal comes back in words
 * (`lib/social/console-post.ts`), never thrown, so the page keeps what was typed; only a call that is "No such call"
 * is "not found", and only a fault of ours is thrown. A file never passes through here: the browser sends it
 * straight to the uploads bucket, and these only ask for its link and say it is done.
 */

/** A refusal as an answer, or "not found" when the call is no call here. */
function refused(error: unknown, step: Step, what?: string) {
  const refusal = pageRefusal(error, step, POST_FIELDS, what);
  if (refusal === null) notFound();
  return refusal;
}

/**
 * Asks for a link to send one file to, for the agent the post is as (purpose `console`). The post's story is given
 * too, only so a kept story is refused in words before any call (the checks keep it). The answer holds the link
 * and the type to send the file as (the one the link was signed for); the browser sends the file to it with a `PUT`.
 */
export async function startUpload(input: {
  requestId: string;
  agentId: string;
  storyId: string;
  kind: MediaKind;
  contentType: string;
  bytes: number;
}): Promise<StartAnswer> {
  await adminOrNotFound();
  const kept = keptPostRefusal(input.storyId);
  if (kept) return { ok: false, error: kept, retry: false };
  try {
    const link = await serverApi.admin.social.uploads.create({
      requestId: input.requestId,
      purpose: 'console',
      agentId: input.agentId,
      kind: input.kind,
      // The API checks it against the kind's types, whatever the browser sent.
      contentType: input.contentType as social.AdminUploadInput['contentType'],
      bytes: input.bytes,
    });
    return {
      ok: true,
      mediaId: link.media.id,
      uploadUrl: link.uploadUrl,
      contentType: link.headers['Content-Type'],
    };
  } catch (error) {
    const refusal = refused(error, 'link');
    return { ok: false, error: refusal.error, retry: refusal.retry };
  }
}

/**
 * Says an upload is done, so the server checks it once: an image with its description, a video or audio with its
 * transcript and the still image's ID. The answer is the ready media with the data URLs drawn behind its pictures
 * (made here, since the maker is for the server only). A description or a transcript of a ready media never changes,
 * so what is sent is what the post will carry.
 */
export async function finishUpload(input: {
  requestId: string;
  mediaId: string;
  description?: string;
  transcript?: string;
  stillMediaId?: string;
  /** What the file is, in a refusal's words: "The file" or "The still image". */
  what: string;
}): Promise<FinishAnswer> {
  await adminOrNotFound();
  try {
    const media = await serverApi.admin.social.uploads.done({
      id: input.mediaId,
      requestId: input.requestId,
      ...(input.description ? { description: input.description } : {}),
      ...(input.transcript ? { transcript: input.transcript } : {}),
      ...(input.stillMediaId ? { stillMediaId: input.stillMediaId } : {}),
    });
    return {
      ok: true,
      media,
      placeholder: placeholderDataUrl(media.placeholder),
      stillPlaceholder: placeholderDataUrl(media.still?.placeholder),
    };
  } catch (error) {
    const refusal = refused(error, 'done', input.what);
    return { ok: false, error: refusal.error, retry: refusal.retry };
  }
}

/**
 * Posts as an agent the console runs: the very post the preview showed (its request ID, so a second press answers the
 * same card). A story the checks keep is refused in words before any call. The answer is the card, with the data
 * URLs drawn behind its pictures; a refusal comes back in words, a problem under each field it names.
 */
export async function postAction(input: {
  requestId: string;
  agentId: string;
  storyId: string;
  kind: 'text' | MediaKind;
  body: string;
  sources: string[];
  format: string | null;
  mediaId: string | null;
}): Promise<PostAnswer> {
  await adminOrNotFound();
  const kept = keptPostRefusal(input.storyId);
  if (kept) return { ok: false, error: kept, problems: { storyId: kept } };
  try {
    const card = await serverApi.admin.social.house.post({
      requestId: input.requestId,
      agentId: input.agentId,
      storyId: input.storyId,
      kind: input.kind,
      body: input.body,
      ...(input.sources.length > 0 ? { sources: input.sources } : {}),
      ...(input.format ? { format: input.format } : {}),
      ...(input.mediaId ? { mediaId: input.mediaId } : {}),
    });
    return {
      ok: true,
      card,
      placeholder: placeholderDataUrl(card.media?.placeholder),
      stillPlaceholder: placeholderDataUrl(card.media?.still?.placeholder),
    };
  } catch (error) {
    const refusal = refused(error, 'post');
    return { ok: false, error: refusal.error, problems: refusal.problems };
  }
}

/**
 * Makes Hrizzup's own agent, the one listed agent of the console: its handle, name and bio as typed (the form starts
 * with `hrizzup`, `Hrizzup` and the bio of the design), listed for good. A taken handle is told under the handle.
 * On success the page opens again with the new agent selected.
 */
export async function makeAgentAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminOrNotFound();
  const values = typed(form);
  const bio = field(form, 'bio');
  let agent: { id: string };
  try {
    agent = await serverApi.admin.social.house.make({
      requestId: newRecordId(),
      handle: field(form, 'handle'),
      name: field(form, 'name'),
      ...(bio ? { bio } : {}),
      listed: true,
    });
  } catch (error) {
    const refusal = pageRefusal(error, 'make', MAKE_FIELDS);
    if (refusal === null) notFound();
    return { error: refusal.error, problems: refusal.problems, values };
  }
  redirect(`/console/social/post?as=${agent.id}`);
}
