import { directionKeys, directions, type IconName, isDirectionKey } from '@hrizzup/design';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/icon.tsx';
import { CategoryArt } from '@/components/news/category-art.tsx';
import { Picture } from '@/components/news/picture.tsx';
import { TakeCard } from '@/components/news/take.tsx';
import { Timeline } from '@/components/news/timeline.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { boardStories, categoryNames, locationNames, stories } from '@/lib/design/examples.ts';
import { artRatio } from '@/lib/design/masonry.ts';
import { storyIds, storyPage } from '@/lib/design/story.ts';
import { ago, DESIGN_NOW } from '@/lib/design/time.ts';
import { cn } from '@/lib/utils.ts';

type Props = { params: Promise<{ direction: string; id: string }> };

export function generateStaticParams() {
  return directionKeys.flatMap((direction) => storyIds.map((id) => ({ direction, id })));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: stories.find((s) => s.id === id)?.title ?? 'Story' };
}

/**
 * A story page at phone size (step 2.2: every story shows how it developed): the story's
 * picture or its category's look, its headline and summary, its timeline, and the takes on
 * it from all three routes, each credited by its route.
 */
export default async function StoryPage({ params }: Props) {
  const { direction, id } = await params;
  const page = storyPage(id);
  if (!isDirectionKey(direction) || !page) notFound();
  const values = directions[direction];
  const { story, entries, takes } = page;
  const board = `/design/directions/${direction}`;
  const category = story.categories[0] ?? '';
  const card = boardStories.find((s) => s.id === id);
  const recent = entries.filter((e) => DESIGN_NOW - Date.parse(e.reportedAt) <= 86_400_000).length;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-section px-gutter pt-3 pb-16">
      <nav aria-label="Story" className="flex flex-wrap items-center justify-between gap-2">
        <a href={board} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <Icon name="chevron-left" size="small" />
          Board
        </a>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
            <Icon name="share-2" label="Share" />
          </button>
          <label
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon' }),
              'relative cursor-pointer has-checked:bg-secondary has-checked:text-secondary-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring',
            )}
          >
            <input type="checkbox" className="peer pointer-events-none absolute opacity-0" />
            <Icon name="bookmark" label="Bookmark" className="peer-checked:hidden" />
            <Icon name="bookmark-check" label="Bookmarked" className="hidden peer-checked:block" />
          </label>
        </div>
      </nav>

      {story.state === 'merged' ? (
        <section className="flex flex-col gap-3 rounded-card bg-notice p-card text-notice-foreground">
          <h1 className="type-title">This story is now part of a bigger one</h1>
          <p className="type-body">
            It turned out to be the same news as another story, so its updates have moved there.
          </p>
          {story.merged_into && (
            <a
              href={`${board}/story/${story.merged_into}`}
              className={cn(buttonVariants({ variant: 'default' }), 'w-fit')}
            >
              Go to the story
            </a>
          )}
        </section>
      ) : story.state === 'withdrawn' ? (
        <section className="flex flex-col gap-3 rounded-card bg-notice p-card text-notice-foreground">
          <h1 className="type-title">This story was withdrawn</h1>
          <p className="type-body">{story.withdrawn_reason}</p>
        </section>
      ) : (
        <>
          <header data-category={category} className="flex flex-col gap-4">
            {card?.picture ? (
              <Picture
                picture={card.picture}
                ratio={Math.min(card.picture.height / card.picture.width, 0.75)}
                className="rounded-card"
              />
            ) : (
              <div
                className={cn(
                  'overflow-hidden rounded-card',
                  values.card.art === 'poster' && 'bg-cat-fill',
                )}
              >
                <CategoryArt
                  art={values.card.art}
                  icon={
                    (
                      values.category[category as keyof typeof values.category] ??
                      values.categoryFallback
                    ).icon as IconName
                  }
                  heat={1}
                  recent={recent}
                  ratio={artRatio[values.card.art] * 0.6}
                />
              </div>
            )}
            <p className="flex flex-wrap items-center gap-2">
              {story.categories.map((c) => (
                <span key={c} data-category={c}>
                  <Badge variant={values.card.art === 'poster' ? 'poster' : 'category'}>
                    {categoryNames[c] ?? c}
                  </Badge>
                </span>
              ))}
              {story.locations.map((l) => (
                <Badge key={l} variant="outline">
                  <Icon name="map-pin" size="small" />
                  {locationNames[l] ?? l}
                </Badge>
              ))}
            </p>
            <h1 className="type-display text-balance">{story.title}</h1>
            <p className="type-body text-muted-foreground">{story.summary}</p>
            <p className="type-caption flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Icon name="clock" size="small" />
                Updated {ago(story.updated_at, DESIGN_NOW)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="radio" size="small" />
                {entries.length} {entries.length === 1 ? 'update' : 'updates'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="messages-square" size="small" />
                {takes.length} {takes.length === 1 ? 'take' : 'takes'}
              </span>
            </p>
          </header>

          <section aria-labelledby="timeline" className="flex flex-col gap-4">
            <h2 id="timeline" className="type-title">
              How it developed
            </h2>
            <Timeline entries={entries} now={DESIGN_NOW} />
          </section>

          <section aria-labelledby="takes" className="flex flex-col gap-4">
            <h2 id="takes" className="type-title">
              Takes
            </h2>
            {takes.length === 0 ? (
              <p className="type-body rounded-card bg-muted p-card text-muted-foreground">
                No takes yet. When creators post about this story, their takes show here.
              </p>
            ) : (
              <ol
                // biome-ignore lint/a11y/noRedundantRoles: Safari reads a list without bullets as no list unless the role says so
                role="list"
                className="flex flex-col gap-3"
              >
                {takes.map((take) => (
                  <li key={take.id}>
                    <TakeCard take={take} now={DESIGN_NOW} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </main>
  );
}
