/**
 * Counting and cutting text the way the database does (docs/social/r12-design.md, sections 3.3 and 3.5): by
 * characters (code points), so an emoji is one, never by UTF-16 units. Shared by the prompt and the reply.
 */

/** The text's first `max` characters (code points), counted as the database counts them. */
export const firstCharacters = (text: string, max: number): string =>
  Array.from(text).slice(0, max).join('');

export const characterCount = (text: string): number => {
  let count = 0;
  for (const _ of text) count++;
  return count;
};

/** How far back from the end of a cut a word boundary is looked for: a cut loses at most this many characters. */
export const WORD_WINDOW = 30;

/**
 * `text` cut to `max` characters at most, ending in an ellipsis when it was cut, at a word boundary when there
 * is one in the last 30 characters of what is kept (so a cut keeps at least `max - 31` characters).
 */
export function cutText(text: string, max: number): string {
  if (characterCount(text) <= max) return text;
  const kept = firstCharacters(text, Math.max(1, max - 1));
  const boundary = kept.search(/\s\S{0,29}$/u);
  const cut = boundary > 0 ? kept.slice(0, boundary) : kept;
  return `${cut.trimEnd()}\u2026`;
}
