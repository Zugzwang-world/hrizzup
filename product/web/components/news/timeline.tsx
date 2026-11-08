import { Icon } from '@/components/icon.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import type { TimelineEntry, XCredit } from '@/lib/design/story.ts';
import { clock, day } from '@/lib/design/time.ts';
import { cn } from '@/lib/utils.ts';

/** How many updates show before the rest fold away behind "Show earlier updates". */
const SHOWN = 6;

export function XCreditLink({ credit, verb = 'Reported by' }: { credit: XCredit; verb?: string }) {
  return (
    <a
      href={credit.url}
      rel="noopener noreferrer"
      target="_blank"
      className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:decoration-current"
    >
      {verb} {credit.name ?? `@${credit.handle}`} on X
      <Icon name="external-link" size="small" />
    </a>
  );
}

function host(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return address;
  }
}

function Entry({ entry, now, latest }: { entry: TimelineEntry; now: number; latest: boolean }) {
  const fresh = latest && now - Date.parse(entry.reportedAt) < 3_600_000;
  return (
    <li
      id={`update-${entry.id}`}
      className={cn(
        'relative scroll-mt-4 border-l-2 border-border pb-6 pl-5 last:pb-0',
        "before:absolute before:top-1.5 before:-left-[7px] before:size-3 before:rounded-full before:content-['']",
        fresh ? 'before:bg-live' : 'before:bg-border',
      )}
    >
      <p className="type-caption flex flex-wrap items-center gap-2 text-muted-foreground">
        <time dateTime={entry.reportedAt}>{clock(entry.reportedAt)}</time>
        {fresh && <Badge variant="live">Live</Badge>}
        {entry.corrects && <Badge variant="notice">Correction</Badge>}
        {entry.correctedBy && <Badge variant="notice">Corrected</Badge>}
      </p>
      <h3 className="type-headline mt-1 text-foreground">{entry.headline}</h3>
      {entry.body && <p className="type-body mt-1.5 text-foreground">{entry.body}</p>}
      {(entry.correctedBy || entry.credits.length > 0 || entry.sources.length > 0) && (
        <p className="type-caption mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          {entry.correctedBy && (
            <a href={`#update-${entry.correctedBy}`} className="underline underline-offset-2">
              See the correction
            </a>
          )}
          {entry.credits.map((credit) => (
            <XCreditLink key={credit.url} credit={credit} />
          ))}
          {entry.sources.map((source) => (
            <a
              key={source}
              href={source}
              rel="noopener noreferrer"
              target="_blank"
              className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:decoration-current"
            >
              {host(source)}
              <Icon name="external-link" size="small" />
            </a>
          ))}
        </p>
      )}
    </li>
  );
}

/** Days in India time, newest first, each with its updates. */
function byDay(entries: TimelineEntry[]) {
  const days: { day: string; entries: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const label = day(entry.reportedAt);
    const last = days.at(-1);
    if (last?.day === label) last.entries.push(entry);
    else days.push({ day: label, entries: [entry] });
  }
  return days;
}

function Days({ entries, now, first }: { entries: TimelineEntry[]; now: number; first?: string }) {
  return byDay(entries).map((group) => (
    <section key={group.day} aria-label={group.day} className="flex flex-col gap-3">
      <h3 className="type-label text-muted-foreground">{group.day}</h3>
      <ol className="flex flex-col">
        {group.entries.map((entry) => (
          <Entry key={entry.id} entry={entry} now={now} latest={entry.id === first} />
        ))}
      </ol>
    </section>
  ));
}

/**
 * A story's timeline, newest first (step 2.2: every story shows how it developed). A
 * correction is its own update and names what it corrects, which shows as corrected; nothing
 * is quietly edited away (the agreement's rules for updates). Long timelines fold their
 * earlier updates away; the fold opens with no script.
 */
export function Timeline({ entries, now }: { entries: TimelineEntry[]; now: number }) {
  const shown = entries.slice(0, SHOWN);
  const earlier = entries.slice(SHOWN);
  return (
    <div className="flex flex-col gap-5">
      <Days entries={shown} now={now} {...(entries[0] ? { first: entries[0].id } : {})} />
      {earlier.length > 0 && (
        <details className="group">
          <summary className="type-label inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-control bg-secondary px-4 text-secondary-foreground [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-down" size="small" className="group-open:rotate-180" />
            <span className="group-open:hidden">Show {earlier.length} earlier updates</span>
            <span className="hidden group-open:inline">Hide the earlier updates</span>
          </summary>
          <div className="mt-5 hidden flex-col gap-5 group-open:flex">
            <Days entries={earlier} now={now} />
          </div>
        </details>
      )}
    </div>
  );
}
