'use client';

import { useState } from 'react';

/**
 * A control that shows its form only when asked for: a list row's revoke or limits form would otherwise stand on the
 * page once for every row, and a page of twenty rows would be a page of twenty forms. Unlike a closed `<details>`,
 * a form not asked for is not in the page at all, so nothing hidden is ever laid out or read as drawn under another.
 */
export function Reveal({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="inline-flex min-h-11 items-center underline"
      >
        {label}
      </button>
      {open ? children : null}
    </div>
  );
}
