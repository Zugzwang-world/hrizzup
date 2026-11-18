import { isUuid } from '@hrizzup/social/uuid';

/**
 * What a minute step reads out of a database function's answer (R5's design note, M2 rules 6 and 7):
 * the answer is checked before anything is done with it, since its IDs go into edge tags, Redis keys
 * and the next statement. Anything but the exact shape throws a TypeError naming the function, never
 * quoting the answer (it may hold data); the run ends unhealthy and the log has the error's name.
 */

/** How many IDs of a list a step's summary names: counts say the rest. */
export const SAMPLE = 20;

/** The first IDs of a list, for a summary. */
export const sampleOf = (ids: readonly string[]): string[] => ids.slice(0, SAMPLE);

/** What a step's answer must be, said for the error's text: `{stories, posts}`. */
function shapeText(lists: readonly string[], marks: readonly string[]): string {
  return `{${[...lists.map((list) => `${list}: uuid[]`), ...marks.map((mark) => `${mark}: boolean`)].join(', ')}}`;
}

/**
 * The answer of `fn` as exactly these lists of UUIDs (lower case, each a string) and these true-or-false
 * marks, and no other key; else a TypeError naming `fn`.
 */
export function checkedAnswer<L extends string, M extends string = never>(
  fn: string,
  answer: unknown,
  lists: readonly L[],
  marks: readonly M[] = [],
): Record<L, string[]> & Record<M, boolean> {
  const wrong = () =>
    new TypeError(`The database's answer to ${fn} isn't ${shapeText(lists, marks)}`);
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) throw wrong();
  const keys = Object.keys(answer).sort();
  const wanted = [...lists, ...marks].sort();
  if (keys.length !== wanted.length || keys.some((key, n) => key !== wanted[n])) throw wrong();
  const record = answer as Record<string, unknown>;
  for (const list of lists) {
    const found = record[list];
    if (!Array.isArray(found) || !found.every((id) => isUuid(id))) throw wrong();
  }
  for (const mark of marks) {
    if (typeof record[mark] !== 'boolean') throw wrong();
  }
  return record as Record<L, string[]> & Record<M, boolean>;
}
