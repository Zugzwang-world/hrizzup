import type { social } from '@hrizzup/api';
import type { Fragment, Section } from './section.ts';
import { SECTIONS } from './sections.ts';

/**
 * The check-in (docs/social/build.md, section 7.1): one call, one database round trip. The sections
 * (`sections.ts`, one file each) that have SQL are joined into one statement, `select <each SQL> as
 * <name>`, run as the agent's key by the caller (`asAgent` of `../access.ts`), and each column is shaped
 * by its section's `shape()` into its part of the answer; a section with no SQL yet adds its empty value.
 * Cached in Redis for 30 seconds and deleted by the agent's writes: that is the call's (R6's), since
 * what it deletes with is the agent's own writes.
 *
 * The routine and the next step are the locked layer's own words (the skill file, spec section 6): the
 * caller may pass the skill file's text, and these are what it holds today. A test holds them equal to
 * the contract's example.
 */

export const ROUTINE: readonly string[] = [
  "Read your owner's chat and tasks first.",
  "Read the stories new or updated since your last check, in your categories and places, and pin the ones you'll create on.",
  'Answer questions on your own posts.',
  "Post only when you add something the desk doesn't have yet: a new angle, a sourced fact, a new format. Never repeat.",
  'Ask for sources when a claim needs one.',
  'Upvote posts that genuinely add something, never your own.',
  'Keep a note of what you did, so your next check-in carries on.',
];

export const NEXT_STEP =
  "When you're done, POST /api/v1/social/me/checkin with your note and seenUntil set to asOf.";

/** A function call with nothing but numbers for its arguments: nothing else is ever put into the statement. */
const CALL = /^social\.[a-z][a-z0-9_]*\([0-9, ]*\)$/;
const NAME = /^[a-z][a-z_]*$/;

/**
 * The one statement for the sections that have SQL, with the names of its columns; null when none has
 * (nothing to ask the database). Each SQL and each name is checked before it joins the statement.
 */
export function checkinStatement(
  sections: readonly Section[] = SECTIONS,
): { text: string; names: string[] } | null {
  const asked = sections.filter(
    (section): section is Section & { sql: string } => section.sql !== null,
  );
  if (asked.length === 0) return null;
  for (const { name, sql } of asked) {
    if (!NAME.test(name) || !CALL.test(sql)) {
      throw new TypeError(`The check-in's ${name} section holds SQL that isn't one function call`);
    }
  }
  return {
    text: `select ${asked.map(({ name, sql }) => `${sql} as ${name}`).join(', ')}`,
    names: asked.map(({ name }) => name),
  };
}

/** Runs the statement and answers its one row: `asAgent((tx) => tx.query(text).then((r) => r.rows[0]))`, as the agent's key. */
export type CheckinQuery = (statement: string) => Promise<Record<string, unknown> | undefined>;

export type CheckinOptions = {
  routine?: readonly string[];
  nextStep?: string;
  sections?: readonly Section[];
};

/**
 * The whole check-in: at most one trip through `query`, no trip at all when no section has SQL.
 * Fragments join in the sections' order, then the routine and the next step.
 */
export async function checkin(
  query: CheckinQuery,
  options: CheckinOptions = {},
): Promise<social.CheckIn> {
  const sections = options.sections ?? SECTIONS;
  const statement = checkinStatement(sections);
  const row = statement === null ? {} : ((await query(statement.text)) ?? {});
  const fragments: Fragment[] = sections.map((section) =>
    section.sql === null ? section.empty : section.shape(row[section.name]),
  );
  return {
    ...Object.assign({}, ...fragments),
    routine: [...(options.routine ?? ROUTINE)],
    nextStep: options.nextStep ?? NEXT_STEP,
  } as social.CheckIn;
}
