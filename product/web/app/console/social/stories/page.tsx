import { categoryNames, placeNames } from '@hrizzup/social/lists';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Facts, Frame } from '@/components/console/social/frame.tsx';
import { StoryForm } from '@/components/console/social/story-forms.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { indiaTime } from '@/lib/console-format.ts';
import { testStoriesEnabled } from '@/lib/env.ts';
import { newRecordId } from '@/lib/record-id.ts';
import { adminOrNotFound, pageOf, textOf } from '@/lib/social/console-page.ts';
import { storyChoices } from '@/lib/social/console-stories.ts';

export const metadata: Metadata = {
  title: 'Stories',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ after?: string | string[] }> };

/** How many stories a page holds. */
const PAGE = 20;
/** A story list's cursor is the API's own opaque text: URL-safe letters, digits and a few marks, at most 200. */
const CURSOR = /^[A-Za-z0-9_=.~-]{1,200}$/;

/**
 * The stories (R5; docs/social/build.md, sections 7.9 and 7.10): the console's list, newest first, a page at a
 * time, and, on staging only, a form for a new test story. A test story is made the way the pipeline's are (a
 * `story/1` record, checked by the agreement), listed on the board or not as chosen when it is made. The calls
 * that make one answer "No such call" anywhere but staging, so the page says so and shows nothing else.
 */
export default async function StoriesPage({ searchParams }: Props) {
  await adminOrNotFound();
  if (!testStoriesEnabled()) {
    return (
      <Frame title="Stories">
        <p className="mt-6" data-testid="stories-staging-only">
          Test stories are made on staging only: this environment has none to show or to make.
        </p>
      </Frame>
    );
  }
  const after = textOf((await searchParams).after);
  const cursor = after && CURSOR.test(after) ? after : undefined;
  const { page, dropped } = await pageOf(
    (input) => serverApi.admin.social.stories.list(input),
    PAGE,
    cursor,
  );
  const notACursor = dropped || (after !== undefined && cursor === undefined);
  const categories = categoryNames();
  const places = placeNames();
  const choices = storyChoices();

  return (
    <Frame
      title="Stories"
      intro="Make a test story with a few updates, then see it on the board and open its page in the sandbox. Staging only."
    >
      <h2 className="mt-8 text-xl font-semibold">Make a test story</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Its title, summary, categories and places, and whether it is listed on the board: chosen
        now, for good. Its updates are added on its own page, once it is saved.
      </p>
      <StoryForm id={newRecordId()} categories={choices.categories} places={choices.places} />

      <h2 className="mt-10 text-xl font-semibold">Stories, newest first</h2>
      {notACursor ? (
        <p className="mt-2 text-sm text-muted">That page link isn't one: showing the newest.</p>
      ) : null}
      {page.stories.length === 0 ? (
        <p className="mt-4 text-muted" data-testid="stories-empty">
          {cursor ? 'No older stories.' : 'No stories yet.'}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line" data-testid="story-list">
          {page.stories.map((story) => (
            <li key={story.id} className="min-w-0 py-4" data-testid="story-row">
              <Link
                href={`/console/social/stories/${story.id}`}
                className="font-medium break-words underline"
              >
                {story.title}
              </Link>
              <Facts>
                {story.listed ? 'listed' : 'unlisted'} · made by{' '}
                {story.madeBy === 'console' ? 'the console' : 'the pipeline'} · {story.state} ·
                latest {indiaTime(story.latestAt)}
              </Facts>
              <Facts>
                {story.categories.map((code) => categories[code] ?? code).join(', ')} ·{' '}
                {story.places.map((code) => places[code] ?? code).join(', ')}
              </Facts>
            </li>
          ))}
        </ul>
      )}
      {page.next || cursor ? (
        <p className="mt-6 flex flex-wrap gap-x-6">
          {cursor ? (
            <Link
              href="/console/social/stories"
              className="inline-flex min-h-11 items-center underline"
            >
              Back to the newest
            </Link>
          ) : null}
          {page.next ? (
            <Link
              href={`/console/social/stories?after=${page.next}`}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              Older stories
            </Link>
          ) : null}
        </p>
      ) : null}
    </Frame>
  );
}
