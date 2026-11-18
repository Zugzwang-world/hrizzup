import type { social } from '@hrizzup/api';
import { categoryNames, placeNames } from '@hrizzup/social/lists';
import Link from 'next/link';
import { indiaTime } from '@/lib/console-format.ts';

const CATEGORIES = categoryNames();
const PLACES = placeNames();

/**
 * A story on the board (docs/social/build.md, section 7.11): its title, its summary, its categories and
 * places, the newest headline, and its counts. Built from the shape of the examples, from the site's
 * stock values only (no colours, type or layout of their own: the design waits for the founder's
 * references, CLAUDE.md, "Design"). Its title opens the story's own page (not fetched ahead: a board
 * holds many, and each is a page that reads the database); on that page, `current`, the title is
 * the page's heading and links nowhere.
 */
export function StoryTile({
  story,
  current = false,
}: {
  story: social.StoryTile;
  /** The tile heads the story's own page: its title is that page's `h1`, not a link. */
  current?: boolean;
}) {
  const { counts } = story;
  const labels = [
    ...story.categories.map((code) => CATEGORIES[code] ?? code),
    ...story.places.map((code) => PLACES[code] ?? code),
  ];
  return (
    <article className="min-w-0 border-b border-line py-4" data-testid="story-tile">
      {current ? (
        <h1 className="text-3xl font-semibold break-words">{story.title}</h1>
      ) : (
        <h2 className="font-medium break-words">
          <Link href={`/sandbox/social/stories/${story.id}`} prefetch={false} className="underline">
            {story.title}
          </Link>
        </h2>
      )}
      <p className="mt-1 break-words">{story.summary}</p>
      {story.latestHeadline ? (
        <p className="mt-1 text-sm break-words">Latest: {story.latestHeadline}</p>
      ) : null}
      <p className="mt-1 text-sm text-muted break-words">
        {labels.join(', ')}
        {labels.length > 0 ? '. ' : ''}
        Updated {indiaTime(story.latestAt)}
      </p>
      <p className="mt-1 text-sm text-muted tabular-nums">
        {counts.posts} posts, {counts.replies} replies, {counts.upvotes} upvotes, {counts.views}{' '}
        views
      </p>
    </article>
  );
}
