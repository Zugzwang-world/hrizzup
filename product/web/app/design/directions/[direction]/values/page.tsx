import {
  type CategoryCode,
  type ColorRole,
  categoryCodes,
  colorRoles,
  type DesignValues,
  directions,
  type IconName,
  iconNames,
  isDirectionKey,
  type RadiusRole,
  radiusRoles,
  type SpaceRole,
  spaceRoles,
  textPairs,
  typeRoles,
} from '@hrizzup/design';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/icon.tsx';
import { Choice } from '@/components/news/board.tsx';
import { CategoryArt } from '@/components/news/category-art.tsx';
import { type CardContext, StoryCard } from '@/components/news/story-card.tsx';
import { TakeCard } from '@/components/news/take.tsx';
import { Timeline } from '@/components/news/timeline.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  boardStories,
  categoryNames,
  locationNames,
  recentUpdates,
} from '@/lib/design/examples.ts';
import { artRatio } from '@/lib/design/masonry.ts';
import { storyPage } from '@/lib/design/story.ts';
import { DESIGN_NOW } from '@/lib/design/time.ts';

type Props = { params: Promise<{ direction: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { direction } = await params;
  return {
    title: isDirectionKey(direction) ? `${directions[direction].name}: values` : 'Values',
  };
}

const COLOR_NAMES: Record<ColorRole, string> = {
  background: 'Page',
  foreground: 'Text',
  card: 'Card',
  cardForeground: 'Text on a card',
  popover: 'Menu',
  popoverForeground: 'Text in a menu',
  primary: 'Main action',
  primaryForeground: 'Text on the main action',
  secondary: 'Second action',
  secondaryForeground: 'Text on the second action',
  muted: 'Quiet surface',
  mutedForeground: 'Quiet text',
  accent: 'Hover and selected',
  accentForeground: 'Text on hover and selected',
  destructive: 'Danger',
  destructiveForeground: 'Text on danger',
  border: 'Lines',
  input: 'Field edges',
  ring: 'Focus ring',
  live: 'Live',
  liveForeground: 'Text on live',
  notice: 'Correction',
  noticeForeground: 'Text on a correction',
};

const SPACE_NAMES: Record<SpaceRole, string> = {
  gutter: 'Page margin',
  laneGap: 'Between cards',
  cardPad: 'Inside a card',
  stack: 'Between lines of a card',
  section: 'Between sections',
};

const TYPE_SAMPLES: Record<(typeof typeRoles)[number], string> = {
  brand: 'Hrizzup',
  display: "Delhi NCR's air turns 'severe' as readings pass 450",
  title: 'How it developed',
  headline: 'India beat Australia by four wickets to level the series',
  body: 'Thick smog has covered Delhi NCR since Monday morning, and the emergency rules are in force.',
  callout: 'The series is level at 1-1, with the decider in Chennai on Sunday',
  label: 'Latest',
  caption: '35 min ago, 30 updates',
};

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        style={{ background: hex }}
        className="size-8 shrink-0 rounded-control border border-border"
      />
      <span className="type-caption flex flex-col">
        <span className="text-muted-foreground">{label}</span>
        <span>{hex}</span>
      </span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="type-title">{title}</h2>
      {children}
    </section>
  );
}

function spec(values: DesignValues, role: (typeof typeRoles)[number]): string {
  const t = values.type[role];
  const family =
    values.font[t.font].family === 'system' ? "the phone's own" : values.font[t.font].family;
  const parts = [`${family}, ${t.size}/${t.line} px, weight ${t.weight}`];
  if (t.width && t.width !== 100) parts.push(`width ${t.width}%`);
  if (t.tracking) parts.push(`spacing ${t.tracking} em`);
  if (t.numbers) parts.push('tabular numbers');
  return parts.join(', ');
}

/**
 * Every design value of one direction, and the core components built from them: the page the
 * founder approves the values on (PLAN.md step 1.4). Colours show both settings' values; the
 * components follow the device's own setting.
 */
export default async function ValuesPage({ params }: Props) {
  const { direction } = await params;
  if (!isDirectionKey(direction)) notFound();
  const values = directions[direction];
  const pairs = textPairs(values);
  const lowest = Math.min(...pairs.map((p) => p.ratio));
  const busiest = Math.max(1, ...boardStories.map((s) => recentUpdates(s, DESIGN_NOW)));
  const context: CardContext = {
    values,
    categoryNames,
    locationNames,
    now: DESIGN_NOW,
    busiest,
  };
  const cards = [
    '01a19849-40e0-7f5f-8c4f-d23d4351e7aa',
    '01a1a57b-8ca0-7c96-8905-93eb7d0b0d54',
    '01a1a0e7-aca0-71ed-94ec-7086aeb1161e',
  ]
    .map((id) => boardStories.find((s) => s.id === id))
    .filter((s) => s !== undefined);
  const smog = storyPage('01a199e9-d180-75ec-8a81-134dd403419a');
  const bitcoin = storyPage('01a19849-40e0-7f5f-8c4f-d23d4351e7aa');

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-section px-gutter pt-6 pb-16">
      <header className="flex flex-col gap-2">
        <h1 className="type-display">{values.name}: the design values</h1>
        <p className="type-body text-muted-foreground">{values.summary}</p>
        <ul className="type-callout list-disc pl-5 text-muted-foreground">
          {values.references.map((reference) => (
            <li key={reference}>{reference}</li>
          ))}
        </ul>
      </header>

      <Section title="Colours">
        <p className="type-callout text-muted-foreground">
          Each colour has a light and a dark version; screens follow the phone's setting. Every text
          colour on its background reaches at least {lowest.toFixed(1)} to 1 (the check asks for
          4.5).
        </p>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-x-6 gap-y-4">
          {colorRoles.map((role) => (
            <li key={role} className="flex flex-col gap-1.5">
              <span className="type-label">{COLOR_NAMES[role]}</span>
              <span className="flex flex-wrap gap-x-4 gap-y-2">
                <Swatch hex={values.color[role].light} label="Light" />
                <Swatch hex={values.color[role].dark} label="Dark" />
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Each category's own look">
        <p className="type-callout text-muted-foreground">
          The picture of every story without a creator's image or video (the agreement's decision
          D5).
        </p>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(10rem,100%),1fr))] gap-3">
          {categoryCodes.map((code: CategoryCode) => (
            <li
              key={code}
              data-category={code}
              className="flex flex-col overflow-hidden rounded-card bg-cat-fill text-cat-ink"
            >
              <CategoryArt
                art={values.card.art}
                icon={values.category[code].icon as IconName}
                heat={0.5}
                recent={3}
                ratio={artRatio[values.card.art]}
              />
              <p className="type-label px-card pb-card pt-2">{categoryNames[code]}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typefaces">
        <ul className="flex flex-col gap-3">
          {(['display', 'text'] as const).map((role) => {
            const font = values.font[role];
            return (
              <li key={role} className="flex flex-col gap-1">
                <p className={role === 'display' ? 'type-title' : 'type-body font-semibold'}>
                  {font.family === 'system' ? "The phone's own typeface" : font.family}
                </p>
                <p className="type-caption text-muted-foreground">
                  For {role === 'display' ? 'headlines' : 'reading text'}. {font.licence}.{' '}
                  {font.family !== 'system' && (
                    <a href={font.source} className="underline">
                      Specimen
                    </a>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Text styles">
        <ul className="flex flex-col gap-5">
          {typeRoles.map((role) => (
            <li key={role} className="flex flex-col gap-2.5">
              <p className={`type-${role}`}>{TYPE_SAMPLES[role]}</p>
              <p className="type-caption text-muted-foreground">
                {role}: {spec(values, role)}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Spacing and corners">
        <ul className="flex flex-col gap-2">
          {spaceRoles.map((role: SpaceRole) => (
            <li key={role} className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden
                style={{ width: `${values.space[role] / 16}rem` }}
                className="h-4 shrink-0 rounded-[2px] bg-primary"
              />
              <span className="type-caption">
                {SPACE_NAMES[role]}: {values.space[role]} px
              </span>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-4">
          {radiusRoles.map((role: RadiusRole) => (
            <li key={role} className="flex flex-col items-center gap-1">
              <span
                aria-hidden
                style={{ borderRadius: Math.min(values.radius[role], 28) }}
                className="size-14 border-2 border-primary bg-secondary"
              />
              <span className="type-caption">
                {role}: {values.radius[role] >= 999 ? 'round' : `${values.radius[role]} px`}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Icons">
        <p className="type-callout text-muted-foreground">
          Lucide's, drawn with lines {values.icon.stroke} units thick on a 24-unit grid.
        </p>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(6.5rem,100%),1fr))] gap-2">
          {iconNames.map((name) => (
            <li
              key={name}
              className="flex flex-col items-center gap-1 rounded-control bg-muted p-2"
            >
              <Icon name={name} size="large" />
              <span className="type-caption break-all text-center text-muted-foreground">
                {name}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Buttons, badges and choices">
        <div className="flex flex-wrap gap-2">
          <Button>Follow the story</Button>
          <Button variant="secondary">Share</Button>
          <Button variant="outline">Bookmark</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Report post</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="live">Live</Badge>
          <Badge variant="notice">Correction</Badge>
          <Badge variant="outline">Creator</Badge>
          <span data-category="sports">
            <Badge variant="category">Sports</Badge>
          </span>
          <span data-category="ai">
            <Badge variant="poster">AI</Badge>
          </span>
        </div>
        <div role="radiogroup" aria-label="Example choices" className="flex flex-wrap gap-1.5">
          <Choice
            name="example"
            value="all"
            checked
            className="bg-secondary text-secondary-foreground has-checked:bg-primary has-checked:text-primary-foreground"
          >
            All
          </Choice>
          {(['crypto', 'politics'] as const).map((c) => (
            <Choice
              key={c}
              name="example"
              value={c}
              category={c}
              className="bg-cat-soft text-cat-soft-ink has-checked:bg-cat-fill has-checked:text-cat-ink"
            >
              {categoryNames[c]}
            </Choice>
          ))}
        </div>
      </Section>

      <Section title="Story cards">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(10rem,100%),1fr))] items-start gap-lane">
          {cards.map((story) => (
            <li key={story.id} className="flex flex-col">
              <StoryCard story={story} context={context} />
            </li>
          ))}
        </ul>
      </Section>

      {smog && (
        <Section title="A timeline, with a correction">
          <Timeline entries={smog.entries.slice(0, 3)} now={DESIGN_NOW} />
        </Section>
      )}

      <Section title="Takes, credited by their route">
        <ol className="flex flex-col gap-3">
          {[...(bitcoin?.takes ?? []), ...(smog?.takes.slice(0, 1) ?? [])].map((take) => (
            <li key={take.id}>
              <TakeCard take={take} now={DESIGN_NOW} />
            </li>
          ))}
        </ol>
      </Section>
    </main>
  );
}
