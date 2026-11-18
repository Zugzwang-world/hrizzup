import { social } from '@hrizzup/api';
import { brand } from '@hrizzup/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Choices } from '@/components/sandbox/social/choices.tsx';
import { Desk } from '@/components/sandbox/social/desk.tsx';
import { SourceLinks } from '@/components/sandbox/social/post-card.tsx';
import { StoryTile } from '@/components/sandbox/social/story-tile.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { indiaTime } from '@/lib/console-format.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import {
  DESK_PAGE,
  type Query,
  refusedWith,
  type StoryView,
  storyHref,
  storyView,
  UPDATES_PAGE,
} from '@/lib/social/page-params.ts';

// The sandbox's layout sets its own title, which leaves a page's without the site's template: spelt out.
export const metadata: Metadata = { title: { absolute: `Story · ${brand.name}` } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Query> };

/**
 * A call's answer, or what it was refused with: a refusal named in `tolerate` is the answer's absence
 * (a withdrawn story has no brief), any other is thrown as it came.
 */
function settled<T>(result: PromiseSettledResult<T>, tolerate?: 'REFUSED'): T | null {
  if (result.status === 'fulfilled') return result.value;
  if (tolerate && refusedWith(result.reason, tolerate)) return null;
  throw result.reason;
}

function Notes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-4 text-sm" data-testid="story-notes">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

const moreLink = 'inline-flex min-h-11 items-center underline';

/**
 * One story (docs/social/build.md, section 7.11): its tile, the timeline of its updates, its desk (the
 * posts agents wrote on it, Top or Latest) and its brief, which is what an agent reads before it
 * writes. The story, its updates, its desk and its brief are read together. A story that was
 * withdrawn shows its reason alone; one that was merged shows the story it went into; one that
 * doesn't exist, or an address that is no story's, is "not found". The timeline and the desk page
 * on their own (`updates` and `posts` in the address, with `order` and `desk` for how each reads), so
 * each state is a link, and a value that isn't one of the lists is dropped with a plain line saying so.
 * The brief is shown as the plain text it is (the repository has no Markdown renderer for pages).
 * Plain stock components: the design waits for the founder's references (CLAUDE.md, "Design").
 */
export default async function SocialStory({ params, searchParams }: Props) {
  sandboxOnly();
  const { id: asked } = await params;
  if (!social.storyAddress.safeParse({ id: asked }).success) notFound();
  const id = asked.toLowerCase();
  const view = storyView(await searchParams);

  const [story, updates, desk, brief] = await Promise.allSettled([
    serverApi.social.stories.get({ id }),
    serverApi.social.stories.updates({ id, cursor: view.updates, limit: UPDATES_PAGE }),
    serverApi.social.stories.posts({ id, sort: view.desk, cursor: view.posts, limit: DESK_PAGE }),
    serverApi.social.stories.brief({ id }),
  ]);
  if (story.status === 'rejected') {
    // No such story (or, where social is off, no such call): not found. Anything else is ours to fix.
    if (refusedWith(story.reason, 'NOT_FOUND')) notFound();
    throw story.reason;
  }
  if (story.value.state === 'withdrawn') {
    return (
      <>
        <h1 className="text-3xl font-semibold">This story was withdrawn</h1>
        <p className="mt-2 max-w-2xl break-words" data-testid="story-withdrawn">
          {story.value.withdrawnReason ?? 'No reason was given.'}
        </p>
        <p className="mt-4">
          <Link href="/sandbox/social" prefetch={false} className={moreLink}>
            Back to the board
          </Link>
        </p>
      </>
    );
  }

  const page = settled(updates);
  const posts = settled(desk);
  const text = settled(brief, 'REFUSED');
  if (page === null || posts === null) throw new Error('A story read answered nothing');

  const state: Omit<StoryView, 'notes'> = {
    order: view.order,
    updates: view.updates,
    desk: view.desk,
    posts: view.posts,
  };
  // Every address on the page is the story's own, which is the survivor's when the one asked for was merged into it.
  const href = (change: Partial<Omit<StoryView, 'notes'>>) =>
    storyHref(story.value.id, { ...state, ...change });
  // What a page of the timeline says about corrections: the updates it shows that are corrected by
  // another it shows, and the headline of one a correction names, when that one is on the page too.
  const headlines = new Map(page.updates.map((update) => [update.id, update.headline]));
  const corrected = new Set(
    page.updates.flatMap((update) => (update.corrects ? [update.corrects] : [])),
  );
  const shown = view.order === 'oldest' ? [...page.updates].reverse() : page.updates;

  return (
    <>
      <StoryTile story={story.value} current />
      {story.value.requestedId ? (
        <p className="mt-2 text-sm" data-testid="story-merged">
          The address you opened was a story that has been merged into this one.{' '}
          <Link href={`/sandbox/social/stories/${story.value.id}`} className="underline">
            Open it at its own address
          </Link>
          .
        </p>
      ) : null}
      <Notes notes={view.notes} />

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Updates</h2>
        <Choices
          label="Timeline"
          testId="story-order"
          choices={[
            {
              text: 'Newest first',
              href: href({ order: 'newest' }),
              current: view.order === 'newest',
            },
            {
              text: 'This page, oldest first',
              href: href({ order: 'oldest' }),
              current: view.order === 'oldest',
            },
          ]}
        />
        {view.updates || page.next ? (
          <p className="mt-2 text-sm text-muted" data-testid="timeline-page-note">
            Only one page of the timeline is shown: "This page, oldest first" reorders just these
            updates, and a correction is marked only when it is on the same page as the update it
            corrects.
          </p>
        ) : null}
        {shown.length === 0 ? (
          <p className="mt-4 text-muted" data-testid="updates-empty">
            No updates yet.
          </p>
        ) : (
          <ol className="mt-2 border-t border-line" data-testid="story-updates">
            {shown.map((update) => {
              const was = update.corrects ? headlines.get(update.corrects) : undefined;
              return (
                <li
                  key={update.id}
                  className="min-w-0 border-b border-line py-4"
                  data-testid="story-update"
                >
                  <h3 className="font-medium break-words">{update.headline}</h3>
                  <p className="mt-1 text-sm text-muted">{indiaTime(update.reportedAt)}</p>
                  {update.corrects ? (
                    <p className="mt-1 text-sm break-words" data-testid="update-corrects">
                      Correction: this puts right an earlier update{was ? `, "${was}"` : ''}.
                    </p>
                  ) : null}
                  {corrected.has(update.id) ? (
                    <p className="mt-1 text-sm" data-testid="update-corrected">
                      Corrected by a later update.
                    </p>
                  ) : null}
                  {update.body ? (
                    <p className="mt-1 break-words whitespace-pre-line">{update.body}</p>
                  ) : null}
                  <SourceLinks sources={update.sources} />
                </li>
              );
            })}
          </ol>
        )}
        {view.updates || page.next ? (
          <p className="mt-4 flex flex-wrap gap-x-6">
            {view.updates ? (
              <Link href={href({ updates: undefined })} prefetch={false} className={moreLink}>
                Back to the newest updates
              </Link>
            ) : null}
            {page.next ? (
              <Link href={href({ updates: page.next })} prefetch={false} className={moreLink}>
                More updates
              </Link>
            ) : null}
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Desk</h2>
        <p className="mt-1 text-sm text-muted">What our agents have posted on this story.</p>
        <Desk
          posts={posts.posts}
          orders={[
            {
              text: 'Top',
              href: href({ desk: 'top', posts: undefined }),
              current: view.desk === 'top',
            },
            {
              text: 'Latest',
              href: href({ desk: 'latest', posts: undefined }),
              current: view.desk === 'latest',
            },
          ]}
          firstHref={view.posts ? href({ posts: undefined }) : null}
          nextHref={posts.next ? href({ posts: posts.next }) : null}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Brief</h2>
        {text ? (
          <>
            <p className="mt-1 text-sm text-muted">
              What an agent reads before it writes on this story. Version {text.version}, built{' '}
              {indiaTime(text.builtAt)}.
            </p>
            <div
              className="mt-2 break-words whitespace-pre-wrap wrap-anywhere"
              data-testid="story-brief"
            >
              {text.markdown}
            </div>
          </>
        ) : (
          <p className="mt-1 text-muted">This story has no brief.</p>
        )}
      </section>
    </>
  );
}
