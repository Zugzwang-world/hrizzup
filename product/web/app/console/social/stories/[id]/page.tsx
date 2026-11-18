import { categoryNames, placeNames } from '@hrizzup/social/lists';
import { ORPCError } from '@orpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Facts, Frame } from '@/components/console/social/frame.tsx';
import { UpdateForm } from '@/components/console/social/story-forms.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { indiaTime } from '@/lib/console-format.ts';
import { testStoriesEnabled } from '@/lib/env.ts';
import { newRecordId } from '@/lib/record-id.ts';
import { RECORD_ID } from '@/lib/social/console-forms.ts';
import { adminOrNotFound } from '@/lib/social/console-page.ts';

export const metadata: Metadata = {
  title: 'Story',
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

/**
 * One story in the console (R5; docs/social/build.md, section 7.10): its tile, its newest updates, and, on staging,
 * a form to add an update, with a link to its page in the sandbox. Read through the story's own public read, which
 * answers an unlisted story by its ID too. A story that doesn't exist, or an address that is no story's, is "not
 * found"; a story that was withdrawn shows its reason alone.
 */
export default async function ConsoleStoryPage({ params }: Props) {
  await adminOrNotFound();
  const { id: asked } = await params;
  const id = asked.toLowerCase();
  if (!RECORD_ID.test(id)) notFound();
  // No such story, or no such call where social is off: "not found". Anything else is ours to fix.
  const story = await serverApi.social.stories.get({ id }).catch((error: unknown) => {
    if (error instanceof ORPCError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const back = { href: '/console/social/stories', text: 'Stories' };

  if (story.state === 'withdrawn') {
    return (
      <Frame title="This story was withdrawn" back={back}>
        <p className="mt-4 break-words" data-testid="story-withdrawn">
          {story.withdrawnReason ?? 'No reason was given.'}
        </p>
      </Frame>
    );
  }

  const categories = categoryNames();
  const places = placeNames();
  return (
    <Frame title={story.title} back={back}>
      <p className="mt-2 max-w-3xl break-words">{story.summary}</p>
      <Facts testId="story-facts">
        {story.listed ? 'listed on the board' : 'unlisted'} ·{' '}
        {story.categories.map((code) => categories[code] ?? code).join(', ')} ·{' '}
        {story.places.map((code) => places[code] ?? code).join(', ')} · latest{' '}
        {indiaTime(story.latestAt)}
      </Facts>
      <p className="mt-4">
        <Link
          href={`/sandbox/social/stories/${story.id}`}
          prefetch={false}
          className="inline-flex min-h-11 items-center underline"
          data-testid="sandbox-story-link"
        >
          Open its page in the sandbox
        </Link>
      </p>

      <h2 className="mt-8 text-xl font-semibold">Updates</h2>
      {story.updates.length === 0 ? (
        <p className="mt-4 text-muted" data-testid="updates-empty">
          No updates yet.
        </p>
      ) : (
        <ol
          className="mt-2 divide-y divide-line border-y border-line"
          data-testid="console-updates"
        >
          {story.updates.map((update) => (
            <li key={update.id} className="min-w-0 py-4" data-testid="console-update">
              <h3 className="font-medium break-words">{update.headline}</h3>
              <Facts>{indiaTime(update.reportedAt)}</Facts>
              {update.body ? (
                <p className="mt-1 break-words whitespace-pre-line">{update.body}</p>
              ) : null}
              {update.sources.length > 0 ? (
                <ul className="mt-1 grid gap-1 text-sm">
                  {update.sources.map((source) => (
                    <li key={source} className="break-all">
                      {source}
                    </li>
                  ))}
                </ul>
              ) : null}
              {update.corrects ? <Facts>Corrects an earlier update.</Facts> : null}
            </li>
          ))}
        </ol>
      )}
      {story.moreUpdates ? (
        <p className="mt-2 text-sm text-muted">Only the newest {story.updates.length} are shown.</p>
      ) : null}

      <h2 className="mt-8 text-xl font-semibold">Add an update</h2>
      {testStoriesEnabled() ? (
        <UpdateForm
          storyId={story.id}
          id={newRecordId()}
          earlier={story.updates.map((update) => ({ id: update.id, headline: update.headline }))}
        />
      ) : (
        <p className="mt-2 text-muted">Updates are added on staging only.</p>
      )}
    </Frame>
  );
}
