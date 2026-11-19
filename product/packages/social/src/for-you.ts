import { createHash } from 'node:crypto';
import { categoryNames, placeNames } from './lists.ts';
import type { ReadingProfile } from './reading-profile.ts';

/**
 * For You's build (docs/social/r12-design.md, decisions 14 and 15, and section 4.1; build.md 7.7): the board's top
 * 300 stories ordered by a reader's reading profile, by plain code with **no clock and no AI**. The same profile
 * over the same candidates always gives the same order, which is what lets a build's ID come from its content.
 *
 * - **Words:** an item and a story are both read as sets of words (`words`): the text in NFKC and lower case, cut
 *   at anything that isn't a letter (with its marks, so Hindi's vowel signs don't split a word) or a digit, with the
 *   few words that carry nothing dropped. An item matches a set when every one of its words is in it, or is in it
 *   once a final `es` or `s` is taken off (`matches`). An item with no words left matches nothing.
 * - **What an item is matched against:** "More of" and "Less of" read the story's own words (its title, summary,
 *   latest headline, and its categories' and places' names: `storyWords`); "Formats" reads the names of the formats on
 *   the story's desk. Never every item against the desk's formats: "less memes" would hide every story with one meme.
 * - **Ranking:** a story any "Less of" item matches is dropped. The rest score the board's own Top rank (which grows
 *   by 10^6 × ln 2 for each half-life a story is newer), plus, for each "More of" item that matches, what being
 *   `foryou_match_hours` newer is worth (`unit`), and for each "Formats" item that matches its desk, what being
 *   `foryou_format_hours` newer is worth. All in BigInt, so no rounding creeps in. Highest score first, ties by the
 *   story's ID, highest first, as the board's own Top breaks them.
 * - **The empty profile** drops and boosts nothing, so it is the candidates' own order, the board's Top.
 * - **The build's ID** is the first 16 hex of the SHA-256 of the ordered IDs: two builds of the same order have
 *   the same ID, whoever builds them and whenever, so a cursor survives a rebuild that changed nothing.
 *
 * Server only (`node:crypto`), imported by its own path (`@hrizzup/social/for-you`). The candidates are a
 * structural type of this package's own: it can't import the contract's, and the website's mapping fits it.
 */

/** The fewest words that carry nothing and so never count for or against a story. */
const STOP_WORDS: ReadonlySet<string> = new Set(['the', 'a', 'an', 'of', 'and', 'news']);

/** The most stories a build ranks, the database's own candidate limit. */
export const MOST_CANDIDATES = 300;

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
function holds(set: ReadonlySet<string>, word: string): boolean {
  if (set.has(word)) return true;
  if (word.endsWith('es') && set.has(word.slice(0, -2))) return true;
  return word.endsWith('s') && set.has(word.slice(0, -1));
}

/** Whether every word of an item (already cut into words) is in the set; never an item with no words. */
const allIn = (own: readonly string[], set: ReadonlySet<string>): boolean =>
  own.length > 0 && own.every((word) => holds(set, word));

/** Whether an item matches a set of words: every one of its words is in the set, as `holds` reads it; never an item with no words. */
export const matches = (item: string, set: ReadonlySet<string>): boolean =>
  allIn(itemWords(item), set);

/** What of a story's tile its words come from: the contract's tile has all of these. */
export type StoryText = {
  title: string;
  summary: string;
  latestHeadline: string | null;
  categories: readonly string[];
  places: readonly string[];
};

const CATEGORIES = categoryNames();
const PLACES = placeNames();

/** A story's words, in one set: its title, summary and latest headline, and its categories' and places' names (a code the lists don't know is read as it is). */
export function storyWords(story: StoryText): Set<string> {
  const text = [
    story.title,
    story.summary,
    story.latestHeadline ?? '',
    ...story.categories.map((code) => CATEGORIES[code] ?? code),
    ...story.places.map((code) => PLACES[code] ?? code),
  ].join(' ');
  return new Set(words(text));
}

/** The part of a tile For You reads: its ID, and the text its words come from. */
export type CandidateTile = StoryText & { id: string };

/** A candidate: the story's tile (the website's own, with whatever else it holds), its Top rank as integer text (`stories.top_rank`), and the codes of its desk's formats. */
export type Candidate<Tile extends CandidateTile = CandidateTile> = {
  tile: Tile;
  rank: string;
  formats: readonly string[];
};

/** What For You ranks: the candidates in the board's Top order, the formats' names by code, and the settings (decimal text). */
export type Candidates<Tile extends CandidateTile = CandidateTile> = {
  /** The board's half-life in hours: the setting its Top ages by. */
  halfLifeHours: string;
  /** How many hours' worth of rank a "More of" match gives. */
  matchHours: string;
  /** How many hours' worth of rank a "Formats" match gives. */
  formatHours: string;
  /** The formats' names, by code. */
  formats: Readonly<Record<string, string>>;
  stories: readonly Candidate<Tile>[];
};

/** A build: its ID, and the ranked story IDs, best first. */
export type Build = { id: string; ids: string[] };

/**
 * What a match is worth in rank, an integer: the rank a story gains by being `hours` newer, which is
 * `round(10^6 × ln 2 × hours / half-life)` (the board's `_rank`: 1,386,294 for 24 hours at a half-life of 12).
 * Rounded once, here; everything after is BigInt.
 */
export function unit(hours: string, halfLifeHours: string): bigint {
  const h = Number(hours);
  const half = Number(halfLifeHours);
  if (!Number.isFinite(h) || h < 0 || !Number.isFinite(half) || half <= 0) {
    throw new TypeError("For You's settings are not hours");
  }
  return BigInt(Math.round((1e6 * Math.LN2 * h) / half));
}

/** The build's ID: the first 16 hex characters of the SHA-256 of the ordered story IDs, one to a line. */
export function buildId(ids: readonly string[]): string {
  return createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex').slice(0, 16);
}

/**
 * The reader's For You: the candidates the profile doesn't hide, best score first, ties by ID, highest first, at
 * most 300. Plain code: the same inputs always give the same build.
 */
export function buildForYou(profile: ReadingProfile, candidates: Candidates): Build {
  const perMore = unit(candidates.matchHours, candidates.halfLifeHours);
  const perFormat = unit(candidates.formatHours, candidates.halfLifeHours);
  // Each item is cut into its words once, not once for every story.
  const more = profile.more.map(itemWords);
  const less = profile.less.map(itemWords);
  const formats = profile.formats.map(itemWords);
  const scored: { id: string; score: bigint }[] = [];
  for (const candidate of candidates.stories.slice(0, MOST_CANDIDATES)) {
    const own = storyWords(candidate.tile);
    if (less.some((item) => allIn(item, own))) continue;
    const desk = new Set(
      words(candidate.formats.map((code) => candidates.formats[code] ?? code).join(' ')),
    );
    const boosts = more.filter((item) => allIn(item, own)).length;
    const liked = formats.filter((item) => allIn(item, desk)).length;
    scored.push({
      // Lower-case UUID text compares as the board's `story_id desc`.
      id: candidate.tile.id.toLowerCase(),
      score: BigInt(candidate.rank) + perMore * BigInt(boosts) + perFormat * BigInt(liked),
    });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score > b.score ? -1 : 1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const ids = scored.map((entry) => entry.id);
  return { id: buildId(ids), ids };
}
