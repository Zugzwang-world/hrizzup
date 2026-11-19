import common from '@hrizzup/agreement/definitions/common.schema.json' with { type: 'json' };

/**
 * The reader's reading profile (docs/social/r12-design.md, sections 1.3, 2.3, 3.2 and 3.4; build.md 7.7):
 * three lists of short items, written as markdown with three fixed headings. The reader types it, or their
 * reader agent edits it; a profile has **one stored form**, which both writers make and the database checks
 * (`social._reader_profile_ok`):
 *
 * - the title `# Reading profile`, then `## More of`, `## Less of` and `## Formats` in that order;
 * - each item as `- item`, one to 60 characters, 20 a heading at most;
 * - one blank line between the parts, no final new line, 2,000 characters in all.
 *
 * `parseProfile` is lenient about what a reader types (any heading case, `*`, `+` and numbered bullets,
 * blank lines, a missing heading) and rewrites it into the stored form; it refuses only what it can't read,
 * naming the line. `applyEdits` makes the agent's small edits, each checked on its own.
 *
 * - **No Node-only code,** so a page may import this file (`@hrizzup/social/reading-profile`).
 * - **`isCanonical` is the database's `_reader_profile_ok` in JavaScript**, the same four checks in the same
 *   order (the length and the agreement's code checks; the shape; each item; twenty a heading). `writeProfile`
 *   makes only text that passes it, and the parity test holds the two equal over a generated set.
 */

/** The three lists of a reading profile, each a list of items in the order the reader (or the agent) added them. */
export type ReadingProfile = { more: string[]; less: string[]; formats: string[] };

/** The lists' names: the profile's keys, and what the model says in its edits. */
export const PROFILE_LISTS = ['more', 'less', 'formats'] as const;
export type ProfileList = (typeof PROFILE_LISTS)[number];

/** What a refused profile says: the field, and the line and the fix, in a sentence. */
export type ProfileIssue = { path: 'body'; message: string };

/** The most characters an item holds, the most items under a heading, and the most characters in all. */
export const MAX_ITEM_CHARACTERS = 60;
export const MAX_ITEMS_A_LIST = 20;
export const MAX_PROFILE_CHARACTERS = 2000;
/** The most issues a refused profile lists. */
export const MAX_ISSUES = 10;
/** The most operations of one edit that are read. */
export const MAX_EDITS = 10;

const HEADINGS: Record<ProfileList, string> = {
  more: '## More of',
  less: '## Less of',
  formats: '## Formats',
};
const HEADING_TEXT: Record<string, ProfileList> = {
  'more of': 'more',
  'less of': 'less',
  formats: 'formats',
};

/** The profile with nothing in it (53 characters): what a reader who never saved reads. */
export const EMPTY_PROFILE = '# Reading profile\n\n## More of\n\n## Less of\n\n## Formats';

/** The three lists, empty. */
export const emptyProfile = (): ReadingProfile => ({ more: [], less: [], formats: [] });

/** How many characters the database counts (`char_length`): code points, so an emoji is one. */
const characters = (text: string): number => {
  let count = 0;
  for (const _ of text) count++;
  return count;
};

/**
 * The agreement's code checks (`agreement/src/validate.ts`: hidden characters, stacked variation selectors,
 * stray joiners, a final new line), which the database makes as `agreement.passes_code_checks`. The database
 * checks them over the whole text, so a joiner next to the "- " in front of an item or the new line after it
 * counts; `checkItem` therefore asks about an item in place, inside a profile.
 */
const CODE_CHECKS = [
  /(?!\u{200D}|\u{FE0E}|\u{FE0F})[\p{Cf}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}]/u,
  /[\u{FE00}-\u{FE0F}]{2}/u,
  /^\u{200D}|\u{200D}$|\u{200D}\u{200D}|[\n -~]\u{200D}|\u{200D}[\n -~]/u,
  /\n$/,
];

/** Whether a text passes the agreement's code checks, as the database's `agreement.passes_code_checks` does. */
export const passesCodeChecks = (text: string): boolean =>
  !CODE_CHECKS.some((rule) => rule.test(text));

/** The agreement's `one_line`, as the JSON Schema writes it (no flags: its `\uXXXX` ranges are plain). */
const ONE_LINE = new RegExp(common.$defs.one_line.pattern);

/** The stored form's shape (the database's, word for word). */
const SHAPE =
  /^# Reading profile\n\n## More of(\n- [^\n]+)*\n\n## Less of(\n- [^\n]+)*\n\n## Formats(\n- [^\n]+)*$/;
/**
 * An item: one character that is neither white space nor a control, then any characters that aren't controls,
 * ending in one that is neither (the database's `[^[:space:][:cntrl:]]([^[:cntrl:]]*[^[:space:][:cntrl:]])?`;
 * its `[:space:]` also holds U+001C to U+001F and U+0085, which are controls too, so `\s` with `\p{Cc}` is the
 * same set but for U+FEFF, which `one_line` refuses anyway).
 */
const ITEM = /^[^\s\p{Cc}]([^\p{Cc}]*[^\s\p{Cc}])?$/u;

/**
 * Whether a text is a reading profile in its one stored form: the database's `_reader_profile_ok`, in the
 * same four checks in the same order.
 */
export function isCanonical(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  // 1. The length and the code checks.
  if (characters(text) > MAX_PROFILE_CHARACTERS) return false;
  if (!passesCodeChecks(text)) return false;
  // 2. The shape.
  if (!SHAPE.test(text)) return false;
  // 3. Each item: 1 to 60 characters, no control character, no space at either end, and one `one_line` takes.
  for (const found of text.matchAll(/\n- ([^\n]*)/g)) {
    const item = found[1] ?? '';
    if (characters(item) > MAX_ITEM_CHARACTERS || !ITEM.test(item) || !ONE_LINE.test(item)) {
      return false;
    }
  }
  // 4. Twenty a heading.
  for (const part of text.split('\n\n')) {
    if ((part.match(/\n- /g) ?? []).length > MAX_ITEMS_A_LIST) return false;
  }
  return true;
}

/** The profile in its one stored form. */
export function writeProfile(profile: ReadingProfile): string {
  const section = (list: ProfileList) =>
    [HEADINGS[list], ...profile[list].map((item) => `- ${item}`)].join('\n');
  return ['# Reading profile', section('more'), section('less'), section('formats')].join('\n\n');
}

/** Whether the profile holds any item (the database's `holds_something`, for a profile read in code). */
export const holdsSomething = (profile: ReadingProfile): boolean =>
  PROFILE_LISTS.some((list) => profile[list].length > 0);

/** An item tidied the way both the reader's and the agent's are: Unicode NFC, white space runs made one space, no space at either end. */
export const cleanItem = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

/** An item compared with another: Unicode NFKC and lower case, so `AI`, `ai` and the full-width forms of them are the same. */
const keyOf = (item: string): string => item.normalize('NFKC').toLowerCase();

/** Why an item can't be kept: it has nothing in it, is over 60 characters, or holds characters the stored form refuses. */
export type ItemProblem = 'empty' | 'too_long' | 'characters';

/**
 * Whether a tidied item may go in a profile, asked in place (an item flanked by "- " and a new line, as the
 * database sees it), so a joiner at either end, a hidden character or a control one is caught exactly as there.
 */
export function checkItem(item: string): ItemProblem | null {
  if (item === '') return 'empty';
  if (characters(item) > MAX_ITEM_CHARACTERS) return 'too_long';
  return isCanonical(writeProfile({ ...emptyProfile(), more: [item] })) ? null : 'characters';
}

const BULLET = /^(?:[-*+]|\d{1,6}[.)])(?:\s+(.*))?$/u;
const HEADING = /^(#{1,6})(?:\s+(.*))?$/u;

export type ParseResult =
  | { ok: true; profile: ReadingProfile }
  | { ok: false; issues: ProfileIssue[] };

/**
 * What a reader typed, as a profile, or the issues that stop it (at most 10, each with its line). Lines are
 * split on `\n`; blank lines are skipped; a `# …` title before the first heading is dropped (the writer writes
 * it); a `## …` heading must be one of the three, once; a bullet is `- `, `* `, `+ `, `1. ` or `1) ` and the
 * item is tidied. A missing heading is an empty list, and a repeat of an item in its list is dropped silently.
 */
export function parseProfile(text: string): ParseResult {
  const profile = emptyProfile();
  const seen: Record<ProfileList, Set<string>> = {
    more: new Set(),
    less: new Set(),
    formats: new Set(),
  };
  const issues: ProfileIssue[] = [];
  const issue = (message: string) => issues.push({ path: 'body', message });
  let current: ProfileList | null = null;
  const headed = new Set<ProfileList>();
  // After a heading it couldn't take, the items under it are skipped, so one bad heading is one issue.
  let skipping = false;

  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const n = index + 1;
    const line = raw.trim();
    if (line === '') continue;

    const heading = HEADING.exec(line);
    if (heading) {
      const hashes = (heading[1] ?? '').length;
      if (hashes === 1) {
        // The title is dropped (the writer writes it); one after the first heading is no heading and no item.
        if (headed.size > 0 || skipping) {
          issue(`Line ${n}: each line is a heading or an item starting with "- "`);
        }
        continue;
      }
      const list =
        hashes === 2
          ? HEADING_TEXT[(heading[2] ?? '').trim().replace(/\s+/g, ' ').toLowerCase()]
          : undefined;
      skipping = true;
      current = null;
      if (list === undefined) {
        issue(`Line ${n}: the headings are ## More of, ## Less of and ## Formats`);
        continue;
      }
      if (headed.has(list)) {
        issue(`Line ${n}: ${HEADINGS[list]} appears twice: keep one`);
        continue;
      }
      headed.add(list);
      current = list;
      skipping = false;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const item = cleanItem(bullet[1] ?? '');
      if (item === '' || skipping) continue;
      if (current === null) {
        issue(`Line ${n}: put each item under a heading`);
        continue;
      }
      const problem = checkItem(item);
      if (problem === 'too_long') {
        issue(
          `Line ${n}: an item is at most ${MAX_ITEM_CHARACTERS} characters (this one is ${characters(item)})`,
        );
        continue;
      }
      if (problem !== null) {
        issue(`Line ${n}: an item is plain text, with no hidden or control characters`);
        continue;
      }
      const key = keyOf(item);
      if (seen[current].has(key)) continue;
      seen[current].add(key);
      profile[current].push(item);
      continue;
    }

    issue(`Line ${n}: each line is a heading or an item starting with "- "`);
  }

  for (const list of PROFILE_LISTS) {
    if (profile[list].length > MAX_ITEMS_A_LIST) {
      issue(`${HEADINGS[list]} has ${profile[list].length} items: at most ${MAX_ITEMS_A_LIST}`);
    }
  }
  if (issues.length === 0) {
    const written = writeProfile(profile);
    if (characters(written) > MAX_PROFILE_CHARACTERS) {
      issue(
        `Your profile would be ${characters(written)} characters: at most 2,000, so take some items out`,
      );
    } else if (!isCanonical(written)) {
      issue("Your profile holds characters it can't keep: take out any hidden characters");
    }
  }
  if (issues.length > 0) return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  return { ok: true, profile };
}

/** One of the agent's edits: add an item to a list, or take it out. */
export type ProfileEdit = { op: 'add' | 'remove'; list: ProfileList; item: string };

/** What `applyEdits` did: the profile now, the operations that changed it, and those dropped (refused, not no-ops). */
export type EditsApplied = { profile: ReadingProfile; applied: number; dropped: number };

const isEdit = (value: unknown): value is ProfileEdit => {
  if (typeof value !== 'object' || value === null) return false;
  const edit = value as Record<string, unknown>;
  return (
    (edit.op === 'add' || edit.op === 'remove') &&
    typeof edit.list === 'string' &&
    (PROFILE_LISTS as readonly string[]).includes(edit.list) &&
    typeof edit.item === 'string'
  );
};

const copyOf = (profile: ReadingProfile): ReadingProfile => ({
  more: [...profile.more],
  less: [...profile.less],
  formats: [...profile.formats],
});

/** The list an item moves out of when it is added to this one: More of and Less of exclude each other. */
const OPPOSITE: Partial<Record<ProfileList, ProfileList>> = { more: 'less', less: 'more' };

/**
 * The agent's operations on a profile, in order, the first 10 only. Each is checked on its own:
 * - **add** tidies the item and applies the item rules; an item already in that list (compared without case)
 *   is a no-op; adding to More of takes the same item out of Less of, and the other way round; a full list
 *   (20) drops the operation;
 * - **remove** takes out the case-insensitive match; an item that isn't there is a no-op;
 * - anything that isn't an operation of this form is dropped.
 * When the result is over 2,000 characters (or isn't in the stored form), the old profile stays and every
 * operation counts as dropped.
 */
export function applyEdits(profile: ReadingProfile, edits: readonly unknown[]): EditsApplied {
  const next = copyOf(profile);
  let applied = 0;
  let dropped = 0;
  const read = edits.slice(0, MAX_EDITS);
  for (const edit of read) {
    if (!isEdit(edit)) {
      dropped++;
      continue;
    }
    const item = cleanItem(edit.item);
    const key = keyOf(item);
    const list = next[edit.list];
    if (edit.op === 'remove') {
      const at = list.findIndex((held) => keyOf(held) === key);
      if (at >= 0) {
        list.splice(at, 1);
        applied++;
      }
      continue;
    }
    if (checkItem(item) !== null) {
      dropped++;
      continue;
    }
    if (list.some((held) => keyOf(held) === key)) continue;
    if (list.length >= MAX_ITEMS_A_LIST) {
      dropped++;
      continue;
    }
    const other = OPPOSITE[edit.list];
    if (other !== undefined) {
      const opposite = next[other];
      const at = opposite.findIndex((held) => keyOf(held) === key);
      if (at >= 0) opposite.splice(at, 1);
    }
    list.push(item);
    applied++;
  }
  if (!isCanonical(writeProfile(next))) {
    return { profile: copyOf(profile), applied: 0, dropped: read.length };
  }
  return { profile: next, applied, dropped };
}
