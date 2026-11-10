'use client';

import type { LinePoint } from '@/lib/sandbox/format.ts';
import { lineOf } from '@/lib/sandbox/format.ts';

/**
 * The sandbox's small parts, built from the site's stock values only (lines, the note colour, ink
 * and paper): a pair of choices, a quick-amount button and a small price line. No colours, type or
 * layout of their own, like the console's controls (components/console/controls.tsx).
 */

/** The one button that does the thing: Buy, Sell, Open. Ink on paper, the site's own values. */
export const PRIMARY =
  'min-h-11 min-w-0 rounded-md border border-ink bg-ink px-5 font-medium break-words text-paper disabled:opacity-60';

const CHOICE = 'min-h-11 min-w-0 flex-1 rounded-md border px-3 font-medium break-words';
const CHOSEN = 'border-ink bg-ink text-paper';
const OTHER = 'border-line hover:bg-note';

/** Two or more choices side by side, one chosen: Buy or Sell, Yes or No, Up or Down. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { value: T; text: string }[];
  onChange: (value: T) => void;
  testId?: string;
}) {
  return (
    <fieldset aria-label={label} className="flex min-w-0 gap-2" data-testid={testId}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`${CHOICE} ${value === option.value ? CHOSEN : OTHER}`}
        >
          {option.text}
        </button>
      ))}
    </fieldset>
  );
}

/** A quick amount: 25%, 50%, Max. */
export function QuickAmount({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 min-w-0 flex-1 rounded-md border border-line px-3 font-medium hover:bg-note"
    >
      {children}
    </button>
  );
}

/**
 * A small price line, drawn from the prices the page has seen since it opened: a stepped line, its
 * height scaled to the range seen. Plain SVG, no chart library.
 */
export function PriceLine({
  points,
  label,
  show,
  floor,
  ceiling,
}: {
  points: readonly LinePoint[];
  label: string;
  /** How a value of the line is written under it. */
  show: (value: number) => string;
  floor?: number;
  ceiling?: number;
}) {
  const line = lineOf(points, 300, 80, floor, ceiling);
  const values = points.map((point) => point.value);
  return (
    <figure className="min-w-0" data-testid="price-line">
      <svg
        viewBox="0 0 300 80"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="h-24 w-full border-b border-line"
      >
        {line && (
          <path
            d={line.path}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span>Since this page opened</span>
        {values.length > 0 && (
          <>
            <span>High {show(Math.max(...values))}</span>
            <span>Low {show(Math.min(...values))}</span>
            <span>
              {values.length} {values.length === 1 ? 'reading' : 'readings'}
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
