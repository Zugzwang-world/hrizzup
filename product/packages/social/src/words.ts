/**
 * How Hrizzup's plain code reads an item and a text as words (docs/social/r12-design.md, decisions 14 and 15 and
 * the note under "A format word always goes to Formats"): For You matches a reading profile's items against a
 * story's words (`for-you.ts`), and the agent's edits recognise a format word by the same rules
 * (`reading-profile.ts`), so the two never disagree about what "timelines" is.
 *
 * **No Node-only code,** so a page may import it, and the reading profile (which a page imports) may too.
 * `for-you.ts` re-exports `words`, `itemWords` and `matches`, which is where they were first written.
 */

/** The fewest words that carry nothing and so never count for or against a story. */
const STOP_WORDS: ReadonlySet<string> = new Set(['the', 'a', 'an', 'of', 'and', 'news']);

/** The words of a text: lower case, NFKC, cut at anything but letters (with marks) and digits, stop words dropped. */
export function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word !== '' && !STOP_WORDS.has(word));
}

/** An item's words: what `words` makes of it. An item with none left matches nothing. */
export const itemWords = (item: string): string[] => words(item);

/** Whether a set holds a word, or the word without a final `es`, or without a final `s`. */
export function holds(set: ReadonlySet<string>, word: string): boolean {
  if (set.has(word)) return true;
  if (word.endsWith('es') && set.has(word.slice(0, -2))) return true;
  return word.endsWith('s') && set.has(word.slice(0, -1));
}

/** Whether every word of an item (already cut into words) is in the set; never an item with no words. */
export const allIn = (own: readonly string[], set: ReadonlySet<string>): boolean =>
  own.length > 0 && own.every((word) => holds(set, word));

/** Whether an item matches a set of words: every one of its words is in the set, as `holds` reads it; never an item with no words. */
export const matches = (item: string, set: ReadonlySet<string>): boolean =>
  allIn(itemWords(item), set);
