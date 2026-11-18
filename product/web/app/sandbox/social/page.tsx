import { brand } from '@hrizzup/core';
import { categories, places, tiers } from '@hrizzup/social/lists';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type Choice, Choices } from '@/components/sandbox/social/choices.tsx';
import { ForYouTab } from '@/components/sandbox/social/for-you-tab.tsx';
import { StoryTile } from '@/components/sandbox/social/story-tile.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import {
  BOARD_PAGE,
  type BoardView,
  boardHref,
  boardView,
  type Query,
  refusedWith,
} from '@/lib/social/page-params.ts';

// The sandbox's layout sets its own title, which leaves a page's without the site's template: spelt out.
export const metadata: Metadata = { title: { absolute: `Board · ${brand.name}` } };

type Props = { searchParams: Promise<Query> };

/** How the board is ordered: Top by default. */
const ORDERS = [
  { code: 'top', text: 'Top' },
  { code: 'latest', text: 'Latest' },
] as const;

/**
 * What a place filter offers: the tiers (every place of a tier), then the places the tiers don't
 * already name (`global` is both a tier and the one place in it, so it is shown once).
 */
const PLACE_FILTERS = [
  ...tiers.map((tier) => ({ code: tier.code, text: tier.name })),
  ...places
    .filter((place) => !tiers.some((tier) => tier.code === place.code))
    .map((place) => ({ code: place.code, text: place.name })),
];

/** A row's choices: "All" first, then each of the list's, the one the board is showing marked. */
function choicesOf(
  view: BoardView,
  field: 'category' | 'place',
  items: readonly { code: string; text: string }[],
  every: string,
): Choice[] {
  const state = { sort: view.sort, category: view.category, place: view.place };
  return [
    { text: every, href: boardHref({ ...state, [field]: undefined }), current: !view[field] },
    ...items.map((item) => ({
      text: item.text,
      href: boardHref({ ...state, [field]: item.code }),
      current: view[field] === item.code,
    })),
  ];
}

/**
 * The board (docs/social/build.md, section 7.11): the stories our AI follows, as tiles, Top or Latest,
 * filtered by what they are about and where they matter, a page at a time. Everything it switches is a
 * link, so each state is an address of its own; a value in the address that isn't one of the board's
 * lists is dropped, with a plain line saying so, and the page still answers. The For You tab is a
 * slot R12 fills (`for-you-tab.tsx`). Plain stock components: the design waits for the founder's
 * references (CLAUDE.md, "Design").
 */
export default async function SocialBoard({ searchParams }: Props) {
  sandboxOnly();
  const view = boardView(await searchParams);
  const page = await serverApi.social
    .board({
      sort: view.sort,
      category: view.category,
      place: view.place,
      cursor: view.cursor,
      limit: BOARD_PAGE,
    })
    .catch((error: unknown) => {
      // Where social is off the call answers "No such call": the page is not found too.
      if (refusedWith(error, 'NOT_FOUND')) notFound();
      throw error;
    });
  const state = { sort: view.sort, category: view.category, place: view.place };
  const filtered = Boolean(view.category || view.place);

  return (
    <>
      <h1 className="text-3xl font-semibold">Board</h1>
      <p className="mt-2 max-w-2xl text-muted">
        A plain working copy of the board: the stories our AI follows, Top or Latest, by what they
        are about and where they matter. Every story opens its own page.
      </p>

      <ForYouTab />

      <Choices
        label="Order"
        testId="board-order"
        choices={ORDERS.map((order) => ({
          text: order.text,
          href: boardHref({ ...state, sort: order.code }),
          current: view.sort === order.code,
        }))}
      />
      <Choices
        label="Category"
        testId="board-category"
        choices={choicesOf(
          view,
          'category',
          categories.map((category) => ({ code: category.code, text: category.name })),
          'All categories',
        )}
      />
      <Choices
        label="Place"
        testId="board-place"
        choices={choicesOf(view, 'place', PLACE_FILTERS, 'All places')}
      />

      {view.notes.length > 0 ? (
        <div className="mt-4 text-sm" data-testid="board-notes">
          {view.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}

      {page.stories.length === 0 ? (
        <p className="mt-6 text-muted" data-testid="board-empty">
          {view.cursor
            ? 'No more stories.'
            : filtered
              ? 'No stories match these filters.'
              : 'No stories on the board yet.'}
        </p>
      ) : (
        <div className="mt-4 border-t border-line" data-testid="story-list">
          {page.stories.map((story) => (
            <StoryTile key={story.id} story={story} />
          ))}
        </div>
      )}

      {view.cursor || page.next ? (
        <p className="mt-4 flex flex-wrap gap-x-6">
          {view.cursor ? (
            <Link
              href={boardHref(state)}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              First page
            </Link>
          ) : null}
          {page.next ? (
            <Link
              href={boardHref(state, page.next)}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              Next
            </Link>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
