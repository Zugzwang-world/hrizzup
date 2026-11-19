import {
  applyEdits,
  type ProfileEdit,
  type ProfileList,
  type ReadingProfile,
} from '@hrizzup/social/reading-profile';

/**
 * The stand-in reader agent (docs/social/r12-design.md, decision 13 and section 3.7): what answers whenever
 * Workers AI isn't set up (no token or no account ID), on this Mac, in previews and on staging until the
 * founder adds the token. It is **deterministic, takes no time and spends no neurons** (usage is explicit
 * zeros, its provider is `stub`), and it says so: every reply begins "(Stand-in, Workers AI isn't set up here".
 *
 * It makes small rule-based edits so the whole profile path (`apply, check, version (agent)`) is exercised
 * before the token exists. Its edits go through the same `applyEdits` as the model's.
 *
 * How it reads a message: it splits it into clauses on `, ; . ! ?`, new lines and the words `and`, `but`,
 * `from`, `in` and `about`, and reads each clause (kept as the reader wrote it; lower case only for matching):
 * 1. **Less:** it starts with `no more`, `no`, `not`, `less`, `fewer`, `without`, `stop` or `skip`: the rest is
 *    added to Less of;
 * 2. **Remove:** it starts with `remove`, `drop` or `forget`: the rest is removed from every list that holds it;
 * 3. **Formats:** it names a format (timeline, meme, explainer, breakdown, infographic, audio brief,
 *    translation, source check, with or without a final `s`): each is added to Formats, in the plural;
 * 4. **More:** otherwise, with a leading `more`, `mostly`, `some`, `i want`, `i like` or `show me` taken off,
 *    what is left is added to More of.
 */

/** What every stub reply begins with. */
export const STUB_LABEL = "(Stand-in, Workers AI isn't set up here.)";

const FORMATS = [
  'timeline',
  'meme',
  'explainer',
  'breakdown',
  'infographic',
  'audio brief',
  'translation',
  'source check',
] as const;

const LESS_WORDS = ['no more', 'no', 'not', 'less', 'fewer', 'without', 'stop', 'skip'];
const REMOVE_WORDS = ['remove', 'drop', 'forget'];
const MORE_WORDS = ['more', 'mostly', 'some', 'i want', 'i like', 'show me'];

/** Clause breaks: punctuation and new lines, and the words that join two things a reader may want. */
const CLAUSE_BREAK = /[,;.!?\n]+|\b(?:and|but|from|in|about)\b/giu;

/** The rest of a clause after a leading phrase (whole words only), or null when it doesn't start with one of them. */
function after(clause: string, phrases: readonly string[]): string | null {
  const lower = clause.toLowerCase();
  for (const phrase of phrases) {
    if (lower === phrase) return '';
    if (lower.startsWith(`${phrase} `)) return clause.slice(phrase.length).trim();
  }
  return null;
}

/** The operations a message asks for, in the order it asks them. */
export function stubEdits(message: string): ProfileEdit[] {
  const edits: ProfileEdit[] = [];
  const add = (list: ProfileList, item: string) => edits.push({ op: 'add', list, item });
  for (const raw of message.split(CLAUSE_BREAK)) {
    const clause = raw.trim();
    if (clause === '') continue;
    const less = after(clause, LESS_WORDS);
    if (less !== null) {
      if (less !== '') add('less', less);
      continue;
    }
    const remove = after(clause, REMOVE_WORDS);
    if (remove !== null) {
      if (remove !== '') {
        for (const list of ['more', 'less', 'formats'] as const) {
          edits.push({ op: 'remove', list, item: remove });
        }
      }
      continue;
    }
    const lower = clause.toLowerCase();
    const named = FORMATS.filter((format) => new RegExp(`\\b${format}s?\\b`, 'u').test(lower));
    if (named.length > 0) {
      for (const format of named) add('formats', `${format}s`);
      continue;
    }
    const more = after(clause, MORE_WORDS) ?? clause;
    if (more !== '') add('more', more);
  }
  return edits;
}

const keyOf = (item: string) => item.normalize('NFKC').toLowerCase();

/** What changed between two profiles, in the words of the reply: items added to each list, and items taken out for good. */
function changesBetween(before: ReadingProfile, after: ReadingProfile): string[] {
  const held = (profile: ReadingProfile, list: ProfileList) =>
    new Set(profile[list].map((item) => keyOf(item)));
  const parts: string[] = [];
  const names: [ProfileList, string][] = [
    ['more', 'More of'],
    ['less', 'Less of'],
    ['formats', 'Formats'],
  ];
  const addedKeys = new Set<string>();
  for (const [list, name] of names) {
    const was = held(before, list);
    const added = after[list].filter((item) => !was.has(keyOf(item)));
    for (const item of added) addedKeys.add(keyOf(item));
    if (added.length > 0) parts.push(`${name}: ${added.join(', ')}`);
  }
  const removed: string[] = [];
  for (const [list] of names) {
    const now = held(after, list);
    for (const item of before[list]) {
      if (!now.has(keyOf(item)) && !addedKeys.has(keyOf(item))) removed.push(item);
    }
  }
  if (removed.length > 0) parts.push(`Removed: ${removed.join(', ')}`);
  return parts;
}

/** What the stand-in answers for one message on one profile: its reply and the operations it makes. */
export function stubAnswer(
  message: string,
  profile: ReadingProfile,
): { reply: string; edits: ProfileEdit[] } {
  const edits = stubEdits(message);
  const changes = changesBetween(profile, applyEdits(profile, edits).profile);
  const reply =
    changes.length > 0
      ? `${STUB_LABEL} ${changes.join('; ')}`
      : `${STUB_LABEL} I didn't find anything to change: try "more cricket, no crypto".`;
  return { reply, edits };
}
