import { type DirectionKey, directionKeys, directions } from '@hrizzup/design';
import Link from 'next/link';
import { cn } from '@/lib/utils.ts';

/**
 * The strip at the top of the design pages: which direction this is, and the way to the
 * others. It's there for comparing, and goes once a direction is chosen.
 */
export function DesignBar({ current }: { current?: DirectionKey }) {
  return (
    <nav aria-label="Design directions" className="border-b border-border bg-muted text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-gutter py-2">
        <Link href="/design" className="type-label underline">
          Design preview
        </Link>
        <ul className="flex flex-wrap gap-x-1 gap-y-1">
          {directionKeys.map((key, i) => (
            <li key={key}>
              <Link
                href={`/design/directions/${key}`}
                aria-current={key === current ? 'page' : undefined}
                className={cn(
                  'type-label inline-flex min-h-11 items-center rounded-control px-3 no-underline',
                  key === current
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {i + 1}. {directions[key].name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
