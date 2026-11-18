import { isUuid } from '@hrizzup/social/uuid';

/**
 * What a minute step reads out of a database function's answer (R5's design note, M2 rules 6 and 7):
 * the answer is checked before anything is done with it, since its IDs go into edge tags, Redis keys
 * and the next statement. A named key that is missing or of the wrong type throws a TypeError naming
 * the function, never quoting the answer (it may hold data); the run ends unhealthy and the log has the
 * error's name. A key the step doesn't name is ignored and never passed on: database changes land first
 * and only add, so a later migration may add a key to a function's answer before the code reads it, and
 * that must not fail every minute run on staging.
 */

/** How many IDs of a list a step's summary names: counts say the rest. */
export const SAMPLE = 20;

/** The first IDs of a list, for a summary. */
export const sampleOf = (ids: readonly string[]): string[] => ids.slice(0, SAMPLE);

/** What a step's answer must hold, said for the error's text: `{stories: uuid[], posts: uuid[]}`. */
function shapeText(lists: readonly string[], marks: readonly string[]): string {
  return `{${[...lists.map((list) => `${list}: uuid[]`), ...marks.map((mark) => `${mark}: boolean`)].join(', ')}}`;
}

/**
 * These keys of the answer of `fn`, checked: each list a list of UUIDs (lower case, each a string) and
 * each mark true or false; else a TypeError naming `fn`. Any other key of the answer is ignored, and
 * the result holds only the keys named here.
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
  const record = answer as Record<string, unknown>;
  const checked: Record<string, string[] | boolean> = {};
  for (const list of lists) {
    const found = record[list];
    if (!Array.isArray(found) || !found.every((id) => isUuid(id))) throw wrong();
    checked[list] = found;
  }
  for (const mark of marks) {
    const found = record[mark];
    if (typeof found !== 'boolean') throw wrong();
    checked[mark] = found;
  }
  return checked as Record<L, string[]> & Record<M, boolean>;
}
