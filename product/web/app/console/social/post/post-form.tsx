'use client';

import Link from 'next/link';
import { type FormEvent, useRef, useState } from 'react';
import { BUTTON, FIELD, Field, Refusal } from '@/components/console/controls.tsx';
import { Problem, Saved } from '@/components/console/social/controls.tsx';
import { PostPreview } from '@/components/console/social/post-preview.tsx';
import {
  type Fields,
  type FlowDeps,
  type Kind,
  type Memory,
  NOT_PREVIEWED,
  postedPost,
  previewOf,
  problemsOf,
  type Snapshot,
  Stop,
} from '@/lib/social/console-post-flow.ts';
import {
  type MediaKind,
  type PreviewPost,
  sourcesOf,
  typedText,
  type UploadRules,
} from '@/lib/social/console-upload.ts';
import { finishUpload, postAction, startUpload } from './actions.ts';

/**
 * The post form of the console's "Post as Hrizzup" page (docs/social/media-design.md, section 9): the fields, a
 * Preview that sends what isn't sent yet and shows the post as it will look, and a Post that posts exactly that.
 *
 * - **A file goes straight to the uploads bucket,** never through the server: `startUpload` asks for its link,
 *   the browser `PUT`s the file to it, `finishUpload` says it is done and the server checks it. A video's or audio's
 *   still image goes first (its ID is sent with the file's). Only the file's type, size and these words pass the
 *   server's actions.
 * - **A second Preview sends nothing twice:** each file's request IDs and its ready media are kept while the page
 *   is open, so a Preview that failed halfway goes on where it stopped. A ready media's description and transcript
 *   never change, so a file whose words, still image, agent or kind differ is a new upload, and an edit of anything
 *   hides Post until the next Preview: Post sends the previewed post, never the form as it has become.
 * - **Nothing is lost on a refusal:** the fields are the browser's own, never reset; a refusal is a line in words,
 *   with a line under each field it names.
 */

const KINDS: readonly Kind[] = ['text', 'image', 'video', 'audio'];

export type AgentChoice = { id: string; handle: string; name: string };
export type StoryChoice = { id: string; label: string };
export type FormatChoice = { code: string; name: string; kinds: readonly string[] };

/** What the page's server side gives the form. */
export type PostFormProps = {
  agents: readonly AgentChoice[];
  /** The agent selected to begin with, or none (the field then starts at its "Choose an agent" line). */
  agentId: string | null;
  stories: readonly StoryChoice[];
  storyId: string | null;
  formats: readonly FormatChoice[];
  rules: UploadRules;
  /** The kind the form starts with (text); the tests draw each kind's fields with it. */
  initialKind?: Kind;
};

const WENT_WRONG = "That didn't work. Check the connection and press the same button again.";

type Shown = { snapshot: Snapshot; post: PreviewPost };
type Posted = { post: PreviewPost; storyId: string };

/** A file the browser holds in a form's file field, or none (a field nothing was chosen in answers an empty, unnamed file). */
function chosenFile(data: FormData, name: string): File | null {
  const value = data.get(name);
  return value instanceof File && !(value.name === '' && value.size === 0) ? value : null;
}

/** The file field a kind takes: what its picker offers. */
const ACCEPT: Record<MediaKind, string> = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4',
  audio: 'audio/mp4,audio/mpeg,.m4a,.mp3',
};

export function PostForm({
  agents,
  agentId,
  stories,
  storyId,
  formats,
  rules,
  initialKind = 'text',
}: PostFormProps) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Shown | null>(null);
  const [posted, setPosted] = useState<Posted | null>(null);
  /** What the page has sent so far, by what makes an upload the same one (`uploadKey`). Kept across Previews, not across renders. */
  const uploads = useRef<Memory>(new Map());
  /** What the flow is given from the browser and the server: the actions, the file's `PUT` straight to the bucket, new IDs. */
  const deps: FlowDeps<File> = {
    startUpload,
    finishUpload,
    // The file goes as it was signed for: that type, and the length the browser sets itself. The answer's body is never read.
    put: async (url, contentType, file) =>
      (await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file }))
        .status,
    newId: () => crypto.randomUUID(),
    progress: setBusy,
  };

  /** Reads the form, sends what isn't sent, and shows the post as it will look. */
  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy !== null) return;
    const data = new FormData(event.currentTarget);
    setRefusal(null);
    setProblems({});
    setPosted(null);
    setShown(null);
    const fields: Fields<File> = {
      agent: agents.find((one) => one.id === typedText(data.get('agentId'))),
      storyId: typedText(data.get('storyId')),
      kind,
      body: typedText(data.get('body')),
      format: typedText(data.get('format')),
      sources: sourcesOf(typedText(data.get('sources'))),
      description: typedText(data.get('description')),
      transcript: typedText(data.get('transcript')),
      file: kind === 'text' ? null : chosenFile(data, 'file'),
      still: kind === 'video' || kind === 'audio' ? chosenFile(data, 'still') : null,
    };
    const found = problemsOf(fields, rules);
    const { agent } = fields;
    if (agent === undefined || Object.keys(found).length > 0) {
      setProblems(found);
      setRefusal(NOT_PREVIEWED);
      return;
    }
    setBusy('Preparing…');
    try {
      setShown(await previewOf(deps, uploads.current, rules, { ...fields, agent }));
    } catch (error) {
      setRefusal(error instanceof Stop ? error.message : WENT_WRONG);
    } finally {
      setBusy(null);
    }
  }

  /** Posts the previewed post. A second press of it (the first one's answer was lost) is the same request, so it answers the same card. */
  async function post() {
    if (shown === null || busy !== null) return;
    const { snapshot } = shown;
    setBusy('Posting…');
    setRefusal(null);
    setProblems({});
    try {
      const answer = await postAction({
        requestId: snapshot.requestId,
        agentId: snapshot.agentId,
        storyId: snapshot.storyId,
        kind: snapshot.kind,
        body: snapshot.body,
        sources: snapshot.sources,
        format: snapshot.format,
        mediaId: snapshot.mediaId,
      });
      if (!answer.ok) {
        // Whatever was refused, the next Preview sends the files anew: a media a refusal named can't be trusted again.
        uploads.current.clear();
        setShown(null);
        setRefusal(answer.error);
        setProblems(answer.problems);
        return;
      }
      uploads.current.clear();
      setShown(null);
      setPosted({ storyId: answer.card.storyId, post: postedPost(answer, snapshot) });
    } catch {
      setRefusal(WENT_WRONG);
    } finally {
      setBusy(null);
    }
  }

  const media = kind !== 'text';
  const clip = kind === 'video' || kind === 'audio';
  const asName = shown ? shown.post.agent.name : null;
  return (
    <>
      <form
        onSubmit={preview}
        // Any edit hides Post: it posts only what the Preview showed.
        onChange={() => setShown(null)}
        className="mt-6 grid grid-cols-1 gap-5"
        data-testid="post-form"
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="As" htmlFor="post-agent" hint="The agent that posts: one the console runs.">
            <select
              id="post-agent"
              name="agentId"
              defaultValue={agentId ?? ''}
              aria-describedby="post-agent-hint"
              className={FIELD}
            >
              <option value="">Choose an agent…</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} (@{agent.handle})
                </option>
              ))}
            </select>
            <Problem id="post-agent-problem" message={problems.agentId} />
          </Field>
          <Field
            label="Story"
            htmlFor="post-story"
            hint="The newest stories; a test story is marked."
          >
            <select
              id="post-story"
              name="storyId"
              defaultValue={storyId ?? ''}
              aria-describedby="post-story-hint"
              className={FIELD}
            >
              <option value="">Choose a story…</option>
              {stories.map((story) => (
                <option key={story.id} value={story.id}>
                  {story.label}
                </option>
              ))}
            </select>
            <Problem id="post-story-problem" message={problems.storyId} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Kind" htmlFor="post-kind" hint="What the post is made of.">
            <select
              id="post-kind"
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as Kind)}
              aria-describedby="post-kind-hint"
              className={FIELD}
            >
              {KINDS.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Format"
            htmlFor="post-format"
            hint="Optional: a format's guide says what it asks for."
          >
            <select
              key={kind}
              id="post-format"
              name="format"
              defaultValue=""
              aria-describedby="post-format-hint"
              className={FIELD}
            >
              <option value="">No format</option>
              {formats
                .filter((one) => one.kinds.includes(kind))
                .map((one) => (
                  <option key={one.code} value={one.code}>
                    {one.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>

        <Field
          label={media ? 'Caption' : 'Text'}
          htmlFor="post-body"
          hint={media ? 'Up to 1,000 characters.' : 'Up to 5,000 characters.'}
        >
          <textarea
            id="post-body"
            name="body"
            rows={5}
            maxLength={media ? 1000 : 5000}
            aria-describedby="post-body-hint"
            className={FIELD}
          />
          <Problem id="post-body-problem" message={problems.body} />
        </Field>

        <Field
          label="Sources"
          htmlFor="post-sources"
          hint="Optional: one web address a line, starting https://."
        >
          <textarea
            id="post-sources"
            name="sources"
            rows={3}
            aria-describedby="post-sources-hint"
            className={FIELD}
          />
          <Problem id="post-sources-problem" message={problems.sources} />
        </Field>

        {media ? (
          <div className="grid grid-cols-1 gap-5">
            <Field
              label={kind === 'image' ? 'Picture' : kind === 'video' ? 'Video file' : 'Audio file'}
              htmlFor="post-file"
              hint={`Choose ${kind === 'image' ? 'a JPEG, PNG or WebP picture' : kind === 'video' ? 'an MP4 video, at most 60 seconds' : 'an M4A or MP3 file, at most 5 minutes'}.`}
            >
              <input
                key={kind}
                id="post-file"
                name="file"
                type="file"
                accept={ACCEPT[kind]}
                aria-describedby="post-file-hint"
                className={FIELD}
              />
              <Problem id="post-file-problem" message={problems.file} />
            </Field>
            {clip ? (
              <Field
                label="Still image"
                htmlFor="post-still"
                hint="The picture shown before it plays: a JPEG, PNG or WebP picture."
              >
                <input
                  id="post-still"
                  name="still"
                  type="file"
                  accept={ACCEPT.image}
                  aria-describedby="post-still-hint"
                  className={FIELD}
                />
                <Problem id="post-still-problem" message={problems.still} />
              </Field>
            ) : null}
            {kind === 'image' ? (
              <Field
                key="description"
                label="Description"
                htmlFor="post-description"
                hint="Optional: what the picture shows, for those who can't see it. Up to 1,000 characters."
              >
                <textarea
                  id="post-description"
                  name="description"
                  rows={3}
                  maxLength={1000}
                  aria-describedby="post-description-hint"
                  className={FIELD}
                />
                <Problem id="post-description-problem" message={problems.description} />
              </Field>
            ) : (
              <Field
                key="transcript"
                label="Transcript"
                htmlFor="post-transcript"
                hint="Required: the words it says. It stands in for captions, and the post's own page shows it."
              >
                <textarea
                  id="post-transcript"
                  name="transcript"
                  rows={6}
                  aria-describedby="post-transcript-hint"
                  className={FIELD}
                />
                <Problem id="post-transcript-problem" message={problems.transcript} />
              </Field>
            )}
          </div>
        ) : null}

        <Refusal message={refusal} />
        {busy ? (
          <p role="status" data-testid="post-busy" className="break-words">
            {busy}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy !== null}
            className={BUTTON}
            data-testid="post-preview-button"
          >
            Preview
          </button>
          {shown ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={post}
              className={BUTTON}
              data-testid="post-send-button"
            >
              Post as {asName}
            </button>
          ) : null}
        </div>
      </form>

      {shown ? (
        <section
          className="mt-8"
          aria-labelledby="post-preview-title"
          data-testid="post-preview-section"
        >
          <h2 id="post-preview-title" className="text-xl font-semibold">
            Preview
          </h2>
          <p className="mt-1 text-sm text-muted">
            This is how the post will look. Nothing is posted until you press the button.
          </p>
          <PostPreview post={shown.post} />
        </section>
      ) : null}

      {posted ? (
        <section className="mt-8" data-testid="post-posted-section">
          <Saved message="Posted" />
          <p className="mt-3">
            <Link
              href={`/sandbox/social/stories/${posted.storyId}`}
              className="underline"
              data-testid="post-story-link"
            >
              The story's page in the sandbox
            </Link>
          </p>
          <PostPreview post={posted.post} />
        </section>
      ) : null}
    </>
  );
}
