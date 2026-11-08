import { Icon } from '@/components/icon.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import type { Take } from '@/lib/design/story.ts';
import { ago } from '@/lib/design/time.ts';
import { cn } from '@/lib/utils.ts';
import { Picture } from './picture.tsx';
import { XCreditLink } from './timeline.tsx';

/** A round mark with the first letter of a name; Hrizzup's own in the brand's colour. */
export function Avatar({ name, brand }: { name: string; brand?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'type-label flex size-10 shrink-0 items-center justify-center rounded-full',
        brand ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground',
      )}
    >
      {name.replace(/^@/, '').charAt(0).toUpperCase()}
    </span>
  );
}

/** Likes and dislikes (PLAN.md section 2). On the design pages they toggle, with no script. */
function Reactions({ id }: { id: string }) {
  const toggle =
    'type-label relative inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-chip px-3 text-muted-foreground select-none has-checked:bg-secondary has-checked:text-secondary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring';
  return (
    <div className="flex flex-wrap gap-1">
      <label className={toggle}>
        <input
          type="checkbox"
          name={`like-${id}`}
          className="pointer-events-none absolute opacity-0"
        />
        <Icon name="thumbs-up" size="small" />
        Like
      </label>
      <label className={toggle}>
        <input
          type="checkbox"
          name={`dislike-${id}`}
          className="pointer-events-none absolute opacity-0"
        />
        <Icon name="thumbs-down" size="small" />
        Dislike
      </label>
    </div>
  );
}

const MEDIA = { text: 'A post', image: 'A picture', video: 'A video' } as const;

/**
 * One take in a story's feed, credited by its route (the agreement's "Three routes into the
 * feed"): found posts are shown as the original on X, embedded and credited to their creator,
 * never copied (here, until the embed lands in step 2.3, our summary stands in its place);
 * made posts are ours, crediting the posts they build on; posted ones come from creators and
 * readers, as plain text.
 */
export function TakeCard({ take, now }: { take: Take; now: number }) {
  if (take.route === 'found') {
    return (
      <article className="flex flex-col gap-3 rounded-card border-(length:--hz-card-border) border-border bg-card p-card text-card-foreground shadow-card">
        <header className="flex items-start gap-3">
          <Avatar name={take.credit.name ?? take.credit.handle} />
          <div className="flex min-w-0 flex-col">
            <p className="type-label">{take.credit.name ?? `@${take.credit.handle}`}</p>
            <p className="type-caption text-muted-foreground">
              @{take.credit.handle} on X, {ago(take.at, now)}
            </p>
          </div>
        </header>
        <div className="rounded-media border border-dashed border-border p-3">
          <p className="type-caption mb-1 font-semibold text-muted-foreground">
            {MEDIA[take.media]} on X, in our words
          </p>
          <p className="type-body">{take.summary}</p>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2">
          <Reactions id={take.id} />
          <p className="type-caption text-muted-foreground">
            <a
              href={take.credit.url}
              rel="noopener noreferrer"
              target="_blank"
              className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:decoration-current"
            >
              Open on X
              <Icon name="external-link" size="small" />
            </a>
          </p>
        </footer>
      </article>
    );
  }
  const { author } = take;
  return (
    <article className="flex flex-col gap-3 rounded-card border-(length:--hz-card-border) border-border bg-card p-card text-card-foreground shadow-card">
      <header className="flex items-start gap-3">
        <Avatar name={author.name} brand={author.kind === 'hrizzup'} />
        <div className="flex min-w-0 flex-col">
          <p className="type-label flex flex-wrap items-center gap-x-2 gap-y-1">
            {author.name}
            {author.kind === 'creator' && <Badge variant="outline">Creator</Badge>}
          </p>
          <p className="type-caption text-muted-foreground">
            {author.handle ? `@${author.handle}, ` : ''}
            {ago(take.at, now)}
          </p>
        </div>
      </header>
      {take.text && <p className="type-body whitespace-pre-line">{take.text}</p>}
      {take.picture && <Picture picture={take.picture} className="rounded-media" />}
      {take.basedOn.length > 0 && (
        <p className="type-caption flex flex-wrap gap-x-3 text-muted-foreground">
          {take.basedOn.map((credit) => (
            <XCreditLink key={credit.url} credit={credit} verb="Based on a post by" />
          ))}
        </p>
      )}
      <footer>
        <Reactions id={take.id} />
      </footer>
    </article>
  );
}
