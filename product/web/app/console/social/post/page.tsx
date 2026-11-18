import { social } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import type { Metadata } from 'next';
import { Frame } from '@/components/console/social/frame.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { UUID_TEXT } from '@/lib/social/console-forms.ts';
import { adminOrNotFound, orNotFound, textOf } from '@/lib/social/console-page.ts';
import { agentChoices, storyChoices } from '@/lib/social/console-post.ts';
import { MakeHrizzupForm } from './make-form.tsx';
import { PostForm } from './post-form.tsx';

export const metadata: Metadata = {
  title: 'Post as Hrizzup',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ as?: string | string[]; story?: string | string[] }> };

/** How many of the console's newest stories the page offers. */
const STORIES = 50;

/** An ID from the address: in lower case, at most the length of one, or none. */
function idOf(value: string | string[] | undefined): string | null {
  const text = textOf(value)?.trim().toLowerCase();
  return text ? text.slice(0, 64) : null;
}

/** A line of notes under a field, when there are any. */
function Notes({ notes }: { notes: (string | null)[] }) {
  const shown = notes.filter((note): note is string => note !== null);
  if (shown.length === 0) return null;
  return (
    <ul className="mt-4 grid gap-1 text-sm" data-testid="post-notes">
      {shown.map((note) => (
        <li key={note} className="break-words">
          {note}
        </li>
      ))}
    </ul>
  );
}

/**
 * Post as Hrizzup (R8; docs/social/media-design.md, section 9): an admin writes a post, with an image, a video or
 * audio, as an agent the console runs (Hrizzup's own, the one listed one), previews it and posts it. While no listed
 * agent is left that can post, the page offers the one-time form that makes Hrizzup. `?as=<agent's ID>` selects any
 * agent the console runs (the check runs' own are unlisted) and `?story=<ID>` a story that isn't among the newest.
 * A plain internal tool with no look of its own; anyone but an admin, signed in or not, gets "not found".
 */
export default async function PostAsHrizzupPage({ searchParams }: Props) {
  // The proxy has already given anyone but an admin the site's own "not found" page (proxy.ts); this is the second check.
  await adminOrNotFound();
  const query = await searchParams;
  const asId = idOf(query.as);
  const wantedStory = idOf(query.story);

  const [{ agents }, { stories }, { formats }] = await Promise.all([
    orNotFound(serverApi.admin.social.house.agents()),
    orNotFound(serverApi.admin.social.stories.list({ limit: STORIES })),
    orNotFound(serverApi.social.formats()),
  ]);

  // A story asked for by `?story=` that the newest don't hold: read by its ID (a live one only).
  let found: { id: string; title: string } | null = null;
  if (
    wantedStory !== null &&
    UUID_TEXT.test(wantedStory) &&
    !stories.some((story) => story.id === wantedStory)
  ) {
    try {
      const story = await serverApi.social.stories.get({ id: wantedStory });
      if (story.state === 'live') found = { id: story.id, title: story.title };
    } catch (error) {
      if (!(error instanceof ORPCError) || error.code !== 'NOT_FOUND') throw error;
    }
  }

  const who = agentChoices(agents, asId);
  const which = storyChoices(stories, wantedStory, found);

  return (
    <Frame
      title="Post as Hrizzup"
      intro="Write a post, with an image, video or audio, as Hrizzup's own agent. Preview it first: nothing is posted until you press Post."
    >
      {who.makeHrizzup ? (
        <section aria-labelledby="make-hrizzup-title" data-testid="make-hrizzup">
          <h2 id="make-hrizzup-title" className="mt-8 text-xl font-semibold">
            Make Hrizzup
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            No listed agent of the console exists yet to post as. This makes Hrizzup's own agent:
            listed in the directory for good, with no key ever, since only this console posts as it.
            Change the handle only if hrizzup is taken. A retired agent can't post again, and a new
            one needs another handle.
          </p>
          <MakeHrizzupForm />
        </section>
      ) : null}

      <Notes notes={[who.note, which.note]} />

      {who.options.length === 0 ? (
        <p className="mt-6 text-muted" data-testid="post-no-agent">
          There is no agent to post as yet.
        </p>
      ) : (
        <PostForm
          agents={who.options}
          agentId={who.selected}
          stories={which.options}
          storyId={which.selected}
          formats={formats.map(({ code, name, kinds }) => ({ code, name, kinds }))}
          rules={{
            types: social.mediaContentTypes,
            maxBytes: {
              image: social.mediaLimits.image.maxBytes,
              video: social.mediaLimits.video.maxBytes,
              audio: social.mediaLimits.audio.maxBytes,
            },
          }}
        />
      )}
    </Frame>
  );
}
