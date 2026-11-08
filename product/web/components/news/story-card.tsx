import type { DesignValues, IconName } from '@hrizzup/design';
import { Icon } from '@/components/icon.tsx';
import type { BoardStory } from '@/lib/design/examples.ts';
import { artRatio, pictureRatio } from '@/lib/design/masonry.ts';
import { ago } from '@/lib/design/time.ts';
import { cn } from '@/lib/utils.ts';
import { CategoryArt } from './category-art.tsx';
import { Picture } from './picture.tsx';
import { PulseStrip } from './pulse-strip.tsx';

export type CardContext = {
  values: DesignValues;
  categoryNames: Record<string, string>;
  locationNames: Record<string, string>;
  now: number;
  /** The most updates any story on the board had in the last day, to scale each card's heat. */
  busiest: number;
  /** Where the headline leads (the story page), for stories that have one. */
  href?: (id: string) => string | undefined;
};

function iconFor(category: string, values: DesignValues): IconName {
  const look = values.category[category as keyof typeof values.category] ?? values.categoryFallback;
  return look.icon as IconName;
}

function Media({ story, context }: { story: BoardStory; context: CardContext }) {
  const picture = story.picture;
  const { values } = context;
  // Inset pictures get their own corners; edge-to-edge ones take the card's.
  const frame = cn('m-(--hz-card-inset) overflow-hidden', values.card.inset > 0 && 'rounded-media');
  const recent = story.updateTimes.filter((t) => context.now - Date.parse(t) <= 86_400_000).length;
  if (!picture) {
    return (
      <div className={values.card.art === 'poster' ? '' : frame}>
        <CategoryArt
          art={values.card.art}
          icon={iconFor(story.categories[0] ?? '', values)}
          heat={context.busiest > 0 ? recent / context.busiest : 0}
          recent={recent}
          ratio={artRatio[values.card.art]}
        />
      </div>
    );
  }
  return <Picture picture={picture} ratio={pictureRatio(story) ?? 1} className={frame} />;
}

/** One story on the board: its picture or its category's look, its headline, and how it's moving. */
export function StoryCard({ story, context }: { story: BoardStory; context: CardContext }) {
  const { values, categoryNames, locationNames, now } = context;
  const category = story.categories[0] ?? '';
  const place = story.locations[0] ?? '';
  const poster = values.card.art === 'poster' && !story.picture;
  const updates = story.updateTimes.length;
  const link = context.href?.(story.id);
  // The whole card opens the story: the headline's link stretches over it.
  const title = link ? (
    <a href={link} className="no-underline after:absolute after:inset-0 after:content-['']">
      {story.title}
    </a>
  ) : (
    story.title
  );
  return (
    <article
      data-category={category}
      className={cn(
        'relative flex flex-1 flex-col overflow-hidden rounded-card border-(length:--hz-card-border) shadow-card',
        poster
          ? 'border-transparent bg-cat-fill text-cat-ink'
          : 'border-border bg-card text-card-foreground',
      )}
    >
      <Media story={story} context={context} />
      <div className="flex flex-1 flex-col gap-stack p-card">
        <p className="type-caption flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'font-semibold',
              poster ? 'text-cat-ink' : values.card.art === 'ink' ? 'text-cat-soft-ink' : '',
              values.card.art === 'poster' &&
                !poster &&
                'rounded-chip bg-cat-fill px-2 text-cat-ink',
              values.card.art === 'field' && 'inline-flex items-center gap-1',
            )}
          >
            {values.card.art === 'field' && <span className="size-2 rounded-[2px] bg-cat-fill" />}
            {categoryNames[category] ?? 'News'}
          </span>
          <span className={poster ? 'text-cat-ink' : 'text-muted-foreground'}>
            {locationNames[place]}
          </span>
        </p>
        <h2 className="type-headline text-balance">{title}</h2>
        {story.latest && (
          <p className={cn('type-callout', poster ? 'text-cat-ink' : 'text-muted-foreground')}>
            {story.latest}
          </p>
        )}
        {values.card.pulse && <PulseStrip times={story.updateTimes} now={now} />}
        <p
          className={cn(
            'type-caption mt-auto flex flex-wrap items-center gap-x-3 gap-y-1',
            poster ? 'text-cat-ink' : 'text-muted-foreground',
          )}
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="clock" size="small" />
            {ago(story.updatedAt, now)}
          </span>
          {updates > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="radio" size="small" />
              {updates} {updates === 1 ? 'update' : 'updates'}
            </span>
          )}
          {story.takes > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="messages-square" size="small" />
              {story.takes} {story.takes === 1 ? 'take' : 'takes'}
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
