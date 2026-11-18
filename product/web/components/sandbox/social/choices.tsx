import Link from 'next/link';

/** One choice of a row: what it says, where it goes, and whether it is the one the page is showing. */
export type Choice = { text: string; href: string; current: boolean };

/**
 * A row of choices as plain links (the board's order, category and place; a story's timeline and desk),
 * each an address of its own, so the page needs no script to switch and a choice can be shared. The
 * one being shown is marked and underlined. Built from the site's stock values only (no colours, type
 * or layout of their own: the design waits for the founder's references, CLAUDE.md, "Design"). The
 * links aren't fetched ahead of a tap: a row holds many, and each is a page that reads the database.
 */
export function Choices({
  label,
  choices,
  testId,
}: {
  label: string;
  choices: readonly Choice[];
  testId: string;
}) {
  return (
    <div className="mt-3 min-w-0" data-testid={testId}>
      <p className="text-sm text-muted">{label}</p>
      <ul className="flex min-w-0 flex-wrap gap-x-5">
        {choices.map((choice) => (
          <li key={choice.href}>
            <Link
              href={choice.href}
              prefetch={false}
              aria-current={choice.current ? 'true' : undefined}
              className={`inline-flex min-h-11 items-center ${
                choice.current
                  ? 'font-semibold text-ink underline underline-offset-8'
                  : 'text-muted'
              }`}
            >
              {choice.text}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
