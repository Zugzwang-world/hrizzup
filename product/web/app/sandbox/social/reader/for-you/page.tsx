import { brand } from '@hrizzup/core';
import { ORPCError } from '@orpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BoardTabs } from '@/components/sandbox/social/for-you-tab.tsx';
import { StoryTile } from '@/components/sandbox/social/story-tile.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { viewer } from '@/lib/sandbox/data.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import type { Query } from '@/lib/social/page-params.ts';
import { FOR_YOU_PATH, READER_PATH, SIGN_IN_PATH } from '../tab-choice.ts';

// The sandbox's layout sets its own title, which leaves a page's without the site's template: spelt out.
export const metadata: Metadata = { title: { absolute: `For You · ${brand.name}` } };

type Props = { searchParams: Promise<Query> };

/** How many stories a page of For You holds. */
const FOR_YOU_PAGE = 20;

/** What the For You call says of a cursor from another build: the contract's own sentence. */
const REBUILT = 'Your For You was rebuilt: start again from the first page';

/** The sandbox's primary button for a link, as My agent's sign-in link (`PRIMARY` without the disabled style). */
const SIGN_IN =
  'min-h-11 min-w-0 rounded-md border border-ink bg-ink px-5 font-medium break-words text-paper';

/** Whether a call was refused for its cursor: a 400 with an issue on `cursor`, which this page answers with the first page and a note. */
function cursorRefused(error: unknown): string | null {
  const refused = error as {
    status?: unknown;
    message?: unknown;
    data?: { issues?: unknown };
  } | null;
  if (refused?.status !== 400) return null;
  const issues = Array.isArray(refused.data?.issues) ? refused.data.issues : [];
  if (!issues.some((issue: { path?: unknown }) => issue?.path === 'cursor')) return null;
  return refused.message === REBUILT
    ? 'Your For You was rebuilt: showing the first page'
    : "That page link isn't one of your For You pages: showing the first page";
}

/**
 * For You (/sandbox/social/reader/for-you; docs/social/r12-design.md, sections 4.3 and 4.4): the reader's feed, built by
 * plain code from their reading profile and the board's top 300 stories, a page at a time. R5's own tile for each
 * story, used as it is. The tab strip has For You current and Board, which remembers the reader's choice of the board
 * for the browser session. A cursor from a build that has changed is shown as the first page with a note, never an
 * error, and any other failure is a plain line under the tab strip, so a reader (whom every address of the board
 * sends here) can always press Board. Signed out, a link to sign in. Plain stock components; the real screens come from the design chat.
 */
export default async function ForYou({ searchParams }: Props) {
  sandboxOnly();
  const who = await viewer();
  if (!who.signedIn) {
    return (
      <>
        <h1 className="text-3xl font-semibold">For You</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Sign in to get a feed built from your own reading profile: more of what you like, none of
          what you don't.
        </p>
        <Link
          href={SIGN_IN_PATH}
          prefetch={false}
          className={`${SIGN_IN} mt-6 inline-flex items-center justify-center no-underline`}
        >
          Sign in to get your own For You
        </Link>
      </>
    );
  }

  const query = await searchParams;
  const raw = typeof query.cursor === 'string' && query.cursor !== '' ? query.cursor : undefined;
  const asked = (cursor?: string) =>
    serverApi.reader.forYou({ ...(cursor ? { cursor } : {}), limit: FOR_YOU_PAGE });
  let note: string | null = null;
  let page: Awaited<ReturnType<typeof asked>>;
  let state: Awaited<ReturnType<typeof serverApi.reader.get>>;
  try {
    const [held, first] = await Promise.all([
      serverApi.reader.get(),
      asked(raw).then(
        (answer) => ({ answer }),
        (error: unknown) => {
          const said = raw === undefined ? null : cursorRefused(error);
          if (said === null) throw error;
          return { said };
        },
      ),
    ]);
    state = held;
    if ('answer' in first) {
      page = first.answer;
    } else {
      note = first.said;
      page = await asked();
    }
  } catch (error) {
    // A failure (the database busy, say) never leaves the reader without the tab strip: every address of the board
    // sends a reader whose profile holds something here, and this page is then the only way back to the board.
    console.error(
      JSON.stringify({
        event: 'for_you_page_failed',
        code: error instanceof ORPCError ? error.code : 'unknown',
      }),
    );
    return (
      <>
        <h1 className="text-3xl font-semibold">For You</h1>
        <BoardTabs current="for-you" />
        <p className="mt-4 max-w-2xl" data-testid="for-you-failed">
          Your For You can't be shown right now: reload in a moment, or press Board.
        </p>
      </>
    );
  }
  // What the page is built from: the reader's profile, or the board's Top when it holds nothing.
  const cursor = note === null ? raw : undefined;

  return (
    <>
      <h1 className="text-3xl font-semibold">For You</h1>
      <BoardTabs current="for-you" />
      <p className="mt-3 max-w-2xl text-muted" data-testid="for-you-built">
        {state.holdsSomething ? (
          'Built from your reading profile'
        ) : (
          <>
            Your profile is empty, so this is the board's Top: tell your{' '}
            <Link href={READER_PATH} prefetch={false} className="underline">
              reader agent
            </Link>{' '}
            what you like
          </>
        )}
      </p>
      {state.holdsSomething ? (
        <p className="mt-1">
          <Link
            href={READER_PATH}
            prefetch={false}
            className="inline-flex min-h-11 items-center underline"
          >
            Your reader agent and profile
          </Link>
        </p>
      ) : null}

      {note ? (
        <p className="mt-4 text-sm" data-testid="for-you-note">
          {note}
        </p>
      ) : null}

      {page.stories.length === 0 ? (
        <p className="mt-6 text-muted" data-testid="for-you-empty">
          {cursor ? 'No more stories.' : 'No stories match your profile right now'}
        </p>
      ) : (
        <div className="mt-4 border-t border-line" data-testid="story-list">
          {page.stories.map((story) => (
            <StoryTile key={story.id} story={story} />
          ))}
        </div>
      )}

      {cursor || page.next ? (
        <p className="mt-4 flex flex-wrap gap-x-6">
          {cursor ? (
            <Link
              href={FOR_YOU_PATH}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              First page
            </Link>
          ) : null}
          {page.next ? (
            <Link
              href={`${FOR_YOU_PATH}?cursor=${page.next}`}
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
