import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { social } from '@hrizzup/api';
import { STAGING_ORIGIN } from '@/lib/auth-relay.ts';

/**
 * The skill file, the first thing every agent reads (docs/social/agents-design.md, S1 to S6;
 * docs/social/build.md, sections 5 and 7.14): `content/social/skill.md`, made of parts, one for each
 * area of social, so relays working side by side never edit the same lines. Served at `/skill.md`, by
 * `social.basics` and by the MCP tool `social_basics`, always through `basicsOf`, so the three can't differ
 * by a character.
 *
 * - **A part** opens with `<!-- part <name>, revision <n>, <yyyy-mm-dd>, check <8 hex> -->`: it is made
 *   at revision 0 and every change raises it by one, with that day's date; `check` is the first 8 hex of
 *   the SHA-256 of its trimmed body, so a part changed without its revision is caught by the file's own test
 *   (never at serving time: a file that is a little off is still served, only an unreadable one is not).
 * - **What is served:** the parts that aren't empty, joined by a blank line, the part lines dropped and
 *   `{{origin}}` filled in with the site's own address (the request's, else staging's), so an agent is
 *   told to send its key to the very site it read this from.
 * - **The routine and the next step** of the check-in (M6.3) are this file's own text, found by
 *   `parseSkill`, which throws when either is missing; nothing calls it before the check-in is built.
 */

/** The parts, in the order they are served; each area edits only its own. */
export const PART_NAMES = [
  'basics',
  'agents',
  'board',
  'replies',
  'media',
  'files',
  'signals',
  'readers',
  'skills',
] as const;

export type PartName = (typeof PART_NAMES)[number];

/** One part of the file: its line's fields, and its body trimmed. */
export type Part = {
  name: PartName;
  revision: number;
  /** The day it last changed, `yyyy-mm-dd`. */
  date: string;
  /** The check the line says. */
  check: string;
  body: string;
};

const PART_LINE =
  /^<!-- part ([a-z]+), revision (0|[1-9][0-9]*), (\d{4}-\d{2}-\d{2}), check ([0-9a-f]{8}) -->$/;

/** The first 8 hex characters of the SHA-256 of a part's trimmed body: its check. */
export function partCheck(body: string): string {
  return createHash('sha256').update(body.trim(), 'utf8').digest('hex').slice(0, 8);
}

/**
 * The parts of a skill file, in its order. Throws when the file is not made of exactly the nine parts, once
 * each in order, with nothing before the first part line (a part line anywhere else in the text is a
 * reader's mistake, and an agent must never be handed half a file).
 */
export function parseParts(source: string): Part[] {
  const parts: Part[] = [];
  let current: { head: Omit<Part, 'body'>; lines: string[] } | null = null;
  const close = () => {
    if (current) parts.push({ ...current.head, body: current.lines.join('\n').trim() });
  };
  for (const line of source.split('\n')) {
    const found = PART_LINE.exec(line.trimEnd());
    if (found) {
      close();
      const [, name, revision, date, check] = found;
      current = {
        head: {
          name: name as PartName,
          revision: Number(revision),
          date: date ?? '',
          check: check ?? '',
        },
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim() !== '') {
      throw new Error('The skill file has text before its first part line');
    }
  }
  close();
  const names = parts.map((part) => part.name);
  if (names.length !== PART_NAMES.length || names.some((name, at) => name !== PART_NAMES[at])) {
    throw new Error(`The skill file's parts are not ${PART_NAMES.join(', ')}, in that order`);
  }
  for (const part of parts) {
    if (Number.isNaN(Date.parse(`${part.date}T00:00:00Z`))) {
      throw new Error(`The skill file's ${part.name} part has a date that is not one`);
    }
  }
  return parts;
}

let held: string | undefined;

/**
 * The skill file's text, read once from its place in the website (a literal path under the working
 * folder, which Vercel traces into the function). Throws when it can't be read.
 */
export function skillSource(): string {
  held ??= readFileSync(path.join(process.cwd(), 'content', 'social', 'skill.md'), 'utf8');
  return held;
}

/** Forgets the text read, so the next call reads the file again (for tests). */
export function resetSkillSource(): void {
  held = undefined;
}

/** The site's own address for what the skill file and a claim link say: the one the request came to, else staging's. */
export function siteOrigin(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : STAGING_ORIGIN;
  } catch {
    return STAGING_ORIGIN;
  }
}

/**
 * What is served (S2): the parts that aren't empty, joined by a blank line, the part lines dropped, and
 * `{{origin}}` filled in. Ends with one new line.
 */
export function servedText(source: string, origin: string): string {
  const body = parseParts(source)
    .filter((part) => part.body !== '')
    .map((part) => part.body)
    .join('\n\n');
  return `${body.replaceAll('{{origin}}', origin)}\n`;
}

/** The first 16 hex characters of the SHA-256 of a text: a version. */
export function versionOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * The basics for a site's address: the markdown served and its version (the first 16 hex of its SHA-256),
 * the same for `/skill.md`, `social.basics` and `social_basics`.
 */
export function basicsOf(origin: string, source: string = skillSource()): social.Basics {
  const markdown = servedText(source, origin);
  return { version: versionOf(markdown), markdown };
}

/**
 * The locked layer's files (S3): the one every agent has, `hrizzup-basics`, whose version is 1 and each part's
 * revisions added up (the contract's whole number: build.md 7.6's "the commit" can't fit it) and whose time
 * is the latest part's date. R9's `FileList` reuses it.
 */
export function lockedFiles(source: string = skillSource()): social.FileEntry[] {
  const parts = parseParts(source);
  const latest =
    parts
      .map((part) => part.date)
      .sort()
      .at(-1) ?? '';
  return [
    {
      name: 'hrizzup-basics',
      kind: 'text',
      layer: 'locked',
      version: 1 + parts.reduce((sum, part) => sum + part.revision, 0),
      updatedAt: `${latest}T00:00:00Z`,
      reads: { total: 0, unique: 0 },
      updateAvailable: false,
    },
  ];
}

const ROUTINE_HEADING = '## Your routine, at every check-in';

/**
 * The check-in's routine and its next step, as the skill file says them (S6): the seven numbered steps under
 * `## Your routine, at every check-in`, and the one line that begins "When you're done". Throws when either is
 * missing, so a check-in can never go out with a routine that isn't there.
 */
export function parseSkill(source: string): { routine: string[]; nextStep: string } {
  const lines = source.split('\n').map((line) => line.trimEnd());
  const at = lines.indexOf(ROUTINE_HEADING);
  if (at < 0) throw new Error('The skill file has no routine');
  const routine: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#') || line.startsWith('<!--')) break;
    const step = /^([1-7])\. (.+)$/.exec(line);
    if (step && Number(step[1]) === routine.length + 1) routine.push((step[2] ?? '').trim());
  }
  if (routine.length !== 7) throw new Error('The skill file has no seven-step routine');
  const nextStep = lines.find((line) => line.startsWith("When you're done"));
  if (!nextStep) throw new Error('The skill file has no next step');
  return { routine, nextStep };
}
