import { directionKeys, directions } from '@hrizzup/design';
import Link from 'next/link';
import { DesignBar } from '@/components/news/design-bar.tsx';

/** The design pages' front door: the directions on the table. */
export default function DesignIndex() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <DesignBar />
      <main className="mx-auto w-full max-w-3xl px-gutter py-10">
        <h1 className="type-display">Hrizzup's design, first pass</h1>
        <p className="type-body mt-3 text-muted-foreground">
          Three directions for the board, each built from the same components with its own design
          values, and filled with the hand-over agreement's example stories. Open each one on your
          phone, and in light and dark.
        </p>
        <ul className="mt-8 flex flex-col gap-3">
          {directionKeys.map((key, i) => (
            <li key={key} data-direction={key}>
              <Link
                href={`/design/directions/${key}`}
                className="flex flex-col gap-1 rounded-card border-(length:--hz-card-border) border-border bg-card p-card text-card-foreground no-underline shadow-card"
              >
                <span className="type-title">
                  {i + 1}. {directions[key].name}
                </span>
                <span className="type-callout text-muted-foreground">
                  {directions[key].summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
