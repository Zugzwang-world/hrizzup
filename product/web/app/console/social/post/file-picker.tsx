'use client';

import { useState } from 'react';

/**
 * A file field that wraps (docs/social/media-design.md, 9.1): the browser's own file input draws "Choose File" and "No
 * file chosen" in one line that can't wrap, so on a narrow phone at 200% text its content is cut off by its own box
 * (and by how wide the platform's font is). So the native input stays the control, and only what is drawn changes:
 *
 * - the `<input type="file">` fills the box and is see-through (`opacity-0`, never `display: none`, `hidden` or a
 *   one-pixel `sr-only` box), so it is still in the page's order, still takes focus with the keyboard, still has its
 *   label (the field's own `<label for>`), is still read by a screen reader, and is still what a tap or a click on the
 *   box lands on;
 * - under it, in the same box, a button-like line and the chosen file's name, in text that wraps (`wrap-anywhere`),
 *   so nothing is wider than the box at any size;
 * - the keyboard's focus ring is drawn around the box (the input is the focused element, but it is see-through), in the
 *   site's own focus colour and offset (`globals.css`);
 * - the chosen name is the input's description too (`aria-describedby`), so a screen reader says it.
 *
 * Plain stock values only (CLAUDE.md, "Design": the console). The remount (`key` by kind, in the form) forgets the name
 * with the file.
 */
export function FilePicker({
  id,
  name,
  accept,
  hintId,
  button = 'Choose a file',
}: {
  id: string;
  name: string;
  accept: string;
  /** The field's hint, which describes the input before the chosen name does. */
  hintId: string;
  button?: string;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const nameId = `${id}-name`;
  return (
    <div className="relative mt-1 min-w-0">
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        aria-describedby={`${hintId} ${nameId}`}
        onChange={(event) => setChosen(event.target.files?.[0]?.name ?? null)}
        className="peer absolute inset-0 z-10 block h-full w-full min-w-0 cursor-pointer opacity-0 disabled:cursor-default"
      />
      <div
        className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-paper px-3 py-2 text-base peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-accent peer-disabled:opacity-60"
        data-testid={`${id}-box`}
      >
        <span className="rounded-md border border-line bg-note px-3 py-1 font-medium">
          {button}
        </span>
        <span id={nameId} className="min-w-0 wrap-anywhere text-muted" data-testid={`${id}-name`}>
          {chosen ?? 'No file chosen'}
        </span>
      </div>
    </div>
  );
}
