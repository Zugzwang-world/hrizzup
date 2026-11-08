import type { DesignValues } from '@hrizzup/design';
import { Icon } from '@/components/icon.tsx';
import type { BoardStory } from '@/lib/design/examples.ts';
import { recentUpdates } from '@/lib/design/examples.ts';
import { rowSpan } from '@/lib/design/masonry.ts';
import { cn } from '@/lib/utils.ts';
import { type CardContext, StoryCard } from './story-card.tsx';

type Props = {
  stories: BoardStory[];
  values: DesignValues;
  categoryNames: Record<string, string>;
  categoryOrder: string[];
  locationNames: Record<string, string>;
  locationOrder: string[];
  /** Story IDs in "Top" order. */
  topOrder: string[];
  /** Which stories "For you" holds: the reader's favourite categories and bookmarks. */
  forYou: (story: BoardStory) => boolean;
  now: number;
  href?: (id: string) => string | undefined;
};

const TABS = [
  { value: 'latest', label: 'Latest' },
  { value: 'top', label: 'Top' },
  { value: 'for-you', label: 'For you' },
] as const;

/**
 * The CSS that makes the board's choices work with no script: each choice is a radio button,
 * and the board hides or reorders its cards to match whichever is checked.
 */
function choiceCss(categories: string[], locations: string[]): string {
  const at = (name: string, value: string) =>
    `[data-board]:has([name="${name}"][value="${value}"]:checked)`;
  return [
    ...categories.map(
      (c) => `${at('category', c)} [data-card]:not([data-categories~="${c}"]){display:none}`,
    ),
    ...locations.map(
      (l) =>
        `${at('location', l)} [data-card]:not([data-locations~="${l}"]){display:none}` +
        `${at('location', l)} [data-place]:not([data-place="${l}"]){display:none}`,
    ),
    `[data-board]:not(:has([name="location"]:not([value="everywhere"]):checked)) [data-place]:not([data-place="everywhere"]){display:none}`,
    `${at('tab', 'top')} [data-card]{order:var(--top)}`,
    `${at('tab', 'for-you')} [data-card]:not([data-for-you]){display:none}`,
  ].join('\n');
}

/** A choice that looks like a chip or a tab: a label around a hidden radio button. */
export function Choice({
  name,
  value,
  checked,
  category,
  children,
  className,
}: {
  name: string;
  value: string;
  checked?: boolean;
  /** Colours the choice in this category's own look. */
  category?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      {...(category ? { 'data-category': category } : {})}
      className={cn(
        'type-label relative inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-chip px-3 select-none',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        className="peer pointer-events-none absolute opacity-0"
      />
      {children}
    </label>
  );
}

/**
 * The board (PLAN.md section 2): Latest, Top and For you; a place and a category to narrow it;
 * then the stories as a masonry of cards (lib/design/masonry.ts). The choices run on CSS
 * alone, so the board ships no script.
 */
export function Board(props: Props) {
  const { stories, values, categoryNames, categoryOrder, locationNames, locationOrder } = props;
  const busiest = Math.max(1, ...stories.map((s) => recentUpdates(s, props.now)));
  const context: CardContext = {
    values,
    categoryNames,
    locationNames,
    now: props.now,
    busiest,
    ...(props.href ? { href: props.href } : {}),
  };
  const topRank = new Map(props.topOrder.map((id, i) => [id, i]));
  const places = ['everywhere', ...locationOrder];
  const placeName = (p: string) => (p === 'everywhere' ? 'Everywhere' : (locationNames[p] ?? p));

  return (
    <div data-board className="flex flex-col gap-4">
      <style>{choiceCss(categoryOrder, locationOrder)}</style>

      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-4">
        <p className="type-brand text-foreground">Hrizzup</p>
        <details className="group min-w-0 max-w-full">
          <summary className="type-label flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-1.5 rounded-chip bg-secondary px-3.5 text-secondary-foreground [&::-webkit-details-marker]:hidden">
            <Icon name="map-pin" size="small" />
            {places.map((p) => (
              <span key={p} data-place={p}>
                {placeName(p)}
              </span>
            ))}
            <Icon name="chevron-down" size="small" className="group-open:rotate-180" />
          </summary>
          {/* Hidden outright while closed: some browsers still lay out a closed panel. */}
          <div
            role="radiogroup"
            aria-label="Place"
            className="mt-2 hidden flex-wrap gap-1.5 rounded-card bg-popover p-2 text-popover-foreground shadow-card group-open:flex"
          >
            {places.map((p) => (
              <Choice
                key={p}
                name="location"
                value={p}
                checked={p === 'everywhere'}
                className="has-checked:bg-primary has-checked:text-primary-foreground"
              >
                {placeName(p)}
              </Choice>
            ))}
          </div>
        </details>
      </header>

      <div
        role="radiogroup"
        aria-label="Order"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((tab) => (
          <Choice
            key={tab.value}
            name="tab"
            value={tab.value}
            checked={tab.value === 'latest'}
            className="rounded-none border-b-2 border-transparent text-muted-foreground has-checked:border-primary has-checked:text-foreground"
          >
            {tab.label}
          </Choice>
        ))}
      </div>

      <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1.5">
        <Choice
          name="category"
          value="all"
          checked
          className="bg-secondary text-secondary-foreground has-checked:bg-primary has-checked:text-primary-foreground"
        >
          All
        </Choice>
        {categoryOrder.map((c) => (
          <Choice
            key={c}
            name="category"
            value={c}
            category={c}
            className="bg-cat-soft text-cat-soft-ink has-checked:bg-cat-fill has-checked:text-cat-ink"
          >
            {categoryNames[c]}
          </Choice>
        ))}
      </div>

      <ol
        aria-label="Stories"
        className={cn(
          'grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(min(10rem,100%),1fr))] auto-rows-[minmax(0.25rem,auto)] gap-x-lane',
          'supports-[display:grid-lanes]:[display:grid-lanes]',
        )}
      >
        {stories.map((story) => (
          <li
            key={story.id}
            data-card
            data-categories={story.categories.join(' ')}
            data-locations={story.locations.join(' ')}
            {...(props.forYou(story) ? { 'data-for-you': '' } : {})}
            style={
              {
                '--rows': rowSpan(story, values),
                '--top': topRank.get(story.id) ?? 0,
              } as React.CSSProperties
            }
            className="row-span-(--rows) mb-lane flex flex-col supports-[display:grid-lanes]:[grid-row:auto]"
          >
            <StoryCard story={story} context={context} />
          </li>
        ))}
      </ol>
    </div>
  );
}
