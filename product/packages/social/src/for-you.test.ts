import { describe, expect, it } from 'vitest';
import {
  buildForYou,
  buildId,
  type Candidate,
  type Candidates,
  itemWords,
  MOST_CANDIDATES,
  matches,
  storyWords,
  unit,
  words,
} from './for-you.ts';
import { emptyProfile, type ReadingProfile } from './reading-profile.ts';

/** For You's build (docs/social/r12-design.md, decisions 14 and 15, section 4.1): plain code, so every case is exact. */

const profile = (parts: Partial<ReadingProfile> = {}): ReadingProfile => ({
  ...emptyProfile(),
  ...parts,
});

const id = (n: number) => `019a7b10-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** A candidate: a story with the given words in its title, and the rest of its text plain. */
function candidate(
  n: number,
  title: string,
  rank: number | bigint,
  rest: Partial<Candidate['tile']> & { formats?: string[] } = {},
): Candidate {
  const { formats, ...text } = rest;
  return {
    tile: {
      id: id(n),
      title,
      summary: 'A summary that holds nothing of interest',
      latestHeadline: null,
      categories: [],
      places: [],
      ...text,
    },
    rank: String(rank),
    formats: formats ?? [],
  };
}

const FORMATS = { timeline: 'Timeline', meme: 'Meme', 'audio-brief': 'Audio brief' };

/** The board's own settings: a half-life of 12 hours, 24 for a "More of" match and 6 for a "Formats" match. */
const candidates = (stories: Candidate[]): Candidates => ({
  halfLifeHours: '12',
  matchHours: '24',
  formatHours: '6',
  formats: FORMATS,
  stories,
});

const orderOf = (stories: Candidate[], mine: ReadingProfile = profile()) =>
  buildForYou(mine, candidates(stories)).ids;

describe('words', () => {
  it('are lower case, cut at anything that is not a letter or a digit, with the stop words dropped', () => {
    expect(words('The AI News of India, and the Philippines!')).toEqual([
      'ai',
      'india',
      'philippines',
    ]);
    expect(words('a an the of and news')).toEqual([]);
    expect(words('')).toEqual([]);
    expect(words('  ---  ')).toEqual([]);
  });

  it('keep digits as words', () => {
    expect(words('Budget 2026: 5G, 3-day')).toEqual(['budget', '2026', '5g', '3', 'day']);
  });

  it('read a letter with its marks as one word, so Hindi’s vowel signs never split it', () => {
    expect(words('भारत की खबरें')).toEqual(['भारत', 'की', 'खबरें']);
  });

  it('fold compatibility forms first (NFKC): full-width letters and ligatures read as plain ones', () => {
    expect(words('ＡＩ ﬁnance')).toEqual(['ai', 'finance']);
  });

  it('are what an item’s words are', () => {
    expect(itemWords('the Philippines')).toEqual(['philippines']);
  });
});

describe('matching', () => {
  const set = new Set(['crypto', 'meme', 'philippines', 'box']);

  it('needs every word of an item in the set', () => {
    expect(matches('crypto', set)).toBe(true);
    expect(matches('the Philippines', set)).toBe(true);
    expect(matches('crypto philippines', set)).toBe(true);
    expect(matches('crypto cricket', set)).toBe(false);
  });

  it('reads an item word with a final "s" or "es" taken off too', () => {
    expect(matches('cryptos', set)).toBe(true);
    expect(matches('memes', set)).toBe(true);
    expect(matches('boxes', set)).toBe(true);
    // Only the item's word is stripped, once: a longer or odder word doesn't match by accident.
    expect(matches('cryptoss', set)).toBe(false);
    expect(matches('boxeses', set)).toBe(false);
  });

  it('never matches an item with no words left', () => {
    expect(matches('news', set)).toBe(false);
    expect(matches('the of', set)).toBe(false);
    expect(matches('', new Set())).toBe(false);
    expect(matches('!!!', set)).toBe(false);
  });

  it('reads a story as its title, summary, latest headline, and the names of its categories and places', () => {
    const own = storyWords({
      title: 'Chennai wins',
      summary: 'A cricket summary',
      latestHeadline: 'Late goal',
      categories: ['sports', 'unknown-code'],
      places: ['mumbai'],
    });
    for (const word of [
      'chennai',
      'cricket',
      'late',
      'goal',
      'sports',
      'mumbai',
      'unknown',
      'code',
    ]) {
      expect(own.has(word), word).toBe(true);
    }
    expect(own.has('the')).toBe(false);
  });
});

describe('unit', () => {
  it('is a match’s worth in rank: round(10^6 × ln 2 × hours ÷ half-life)', () => {
    expect(unit('24', '12')).toBe(1_386_294n);
    expect(unit('6', '12')).toBe(346_574n);
    expect(unit('0', '12')).toBe(0n);
    expect(unit('12', '12')).toBe(693_147n);
  });

  it('refuses a setting that is not hours', () => {
    expect(() => unit('x', '12')).toThrow(TypeError);
    expect(() => unit('24', '0')).toThrow(TypeError);
    expect(() => unit('-1', '12')).toThrow(TypeError);
  });
});

describe('the build', () => {
  const base = 5_000_000;

  it('is the candidates’ own order for the empty profile, the board’s Top', () => {
    const stories = [
      candidate(3, 'Third by rank', base + 20),
      candidate(1, 'Second by rank', base + 10),
      candidate(2, 'Last by rank', base),
    ];
    expect(orderOf(stories)).toEqual([id(3), id(1), id(2)]);
  });

  it('drops every story a "Less of" item matches, and keeps the rest', () => {
    const stories = [
      candidate(1, 'Crypto markets tumble', base + 30),
      candidate(2, 'Cricket final tonight', base + 20),
      candidate(3, 'A quiet day in politics', base + 10),
    ];
    expect(orderOf(stories, profile({ less: ['crypto'] }))).toEqual([id(2), id(3)]);
    // A "Less of" item matches the same ways: its plural, and a category or place name.
    expect(orderOf(stories, profile({ less: ['cryptos'] }))).toEqual([id(2), id(3)]);
    expect(
      orderOf(
        [
          candidate(1, 'Plain title', base + 30, { categories: ['sports'] }),
          candidate(2, 'Other', base),
        ],
        profile({ less: ['sports'] }),
      ),
    ).toEqual([id(2)]);
    // Less of wins over More of, even for the very same item.
    expect(orderOf(stories, profile({ more: ['crypto'], less: ['crypto'] }))).toEqual([
      id(2),
      id(3),
    ]);
  });

  it('boosts a "More of" match by exactly 1,386,294 a match (24 hours at a half-life of 12)', () => {
    const matching = candidate(1, 'Cricket final tonight', base);
    // One short of a match's worth above it: the match wins.
    expect(
      orderOf([candidate(2, 'Other', base + 1_386_293), matching], profile({ more: ['cricket'] })),
    ).toEqual([id(1), id(2)]);
    // One more than a match's worth above it: the story that doesn't match keeps first place.
    expect(
      orderOf([candidate(2, 'Other', base + 1_386_295), matching], profile({ more: ['cricket'] })),
    ).toEqual([id(2), id(1)]);
  });

  it('boosts each "More of" item that matches, so two matches are worth twice one', () => {
    const both = candidate(1, 'Cricket and football', base);
    const one = candidate(3, 'Cricket only', base);
    // Two matches are 2,772,588 above rank: a story just under that still sits below it.
    expect(
      orderOf(
        [candidate(2, 'Other', base + 2_772_587), both, one],
        profile({ more: ['cricket', 'football'] }),
      ),
    ).toEqual([id(1), id(2), id(3)]);
    expect(
      orderOf(
        [candidate(2, 'Other', base + 2_772_589), both, one],
        profile({ more: ['cricket', 'football'] }),
      ),
    ).toEqual([id(2), id(1), id(3)]);
  });

  it('boosts a "Formats" match by exactly 346,574 (6 hours), from the formats on the story’s desk only', () => {
    const onDesk = candidate(1, 'No words of the kind', base, { formats: ['timeline'] });
    expect(
      orderOf([candidate(2, 'Other', base + 346_573), onDesk], profile({ formats: ['timelines'] })),
    ).toEqual([id(1), id(2)]);
    expect(
      orderOf([candidate(2, 'Other', base + 346_575), onDesk], profile({ formats: ['timelines'] })),
    ).toEqual([id(2), id(1)]);
    // A name with two words matches by its words; a format the desk doesn't hold counts for nothing.
    const audio = candidate(1, 'Plain', base, { formats: ['audio-brief'] });
    expect(
      orderOf([candidate(2, 'Other', base + 1), audio], profile({ formats: ['audio brief'] })),
    ).toEqual([id(1), id(2)]);
    expect(
      orderOf([candidate(2, 'Other', base + 1), audio], profile({ formats: ['meme'] })),
    ).toEqual([id(2), id(1)]);
  });

  it('reads "Formats" items against the desk only, and "More of" and "Less of" against the story only', () => {
    // A story whose own words say "timeline", with no timeline on its desk, is no Formats match.
    const wordsOnly = candidate(1, 'A timeline of the week', base);
    expect(
      orderOf([candidate(2, 'Other', base + 1), wordsOnly], profile({ formats: ['timeline'] })),
    ).toEqual([id(2), id(1)]);
    // "Less of: memes" never hides a story for a meme on its desk (decision 15)...
    const memeDesk = candidate(1, 'A plain story', base + 5, { formats: ['meme'] });
    expect(orderOf([memeDesk, candidate(2, 'Other', base)], profile({ less: ['memes'] }))).toEqual([
      id(1),
      id(2),
    ]);
    // ...and a "More of" item naming a format doesn't boost by the desk.
    expect(
      orderOf([candidate(2, 'Other', base + 10), memeDesk], profile({ more: ['meme'] })),
    ).toEqual([id(2), id(1)]);
  });

  it('breaks a tie by the story’s ID, highest first', () => {
    const stories = [
      candidate(1, 'One', base),
      candidate(3, 'Three', base),
      candidate(2, 'Two', base),
    ];
    expect(orderOf(stories)).toEqual([id(3), id(2), id(1)]);
    // A boost that ties exactly with a higher rank is broken the same way.
    const tied = [candidate(5, 'Cricket', base), candidate(9, 'Other', base + 1_386_294)];
    expect(orderOf(tied, profile({ more: ['cricket'] }))).toEqual([id(9), id(5)]);
    expect(
      orderOf(
        [candidate(9, 'Cricket', base), candidate(5, 'Other', base + 1_386_294)],
        profile({ more: ['cricket'] }),
      ),
    ).toEqual([id(9), id(5)]);
  });

  it('ranks in whole numbers: a rank past what a double holds is still exact, and a negative one is read', () => {
    const big = 2n ** 62n;
    expect(orderOf([candidate(1, 'A', big), candidate(2, 'B', big + 1n)])).toEqual([id(2), id(1)]);
    expect(orderOf([candidate(1, 'A', -5), candidate(2, 'B', -6)])).toEqual([id(1), id(2)]);
  });

  it('keeps at most 300 of the candidates, in the order given', () => {
    const many = Array.from({ length: MOST_CANDIDATES + 5 }, (_, n) =>
      candidate(n + 1, `Story ${n}`, 10_000 - n),
    );
    const built = orderOf(many);
    expect(built).toHaveLength(MOST_CANDIDATES);
    expect(built[0]).toBe(id(1));
    expect(built.at(-1)).toBe(id(MOST_CANDIDATES));
  });

  it('gives a story with a missing format name its code, and a stories list that is empty an empty build', () => {
    const odd = candidate(1, 'Plain', base, { formats: ['unlisted-format'] });
    expect(orderOf([odd], profile({ formats: ['unlisted format'] }))).toEqual([id(1)]);
    expect(orderOf([])).toEqual([]);
  });

  it('reads an ID in capitals as its lower-case self, so one story is one ID', () => {
    const shouting = candidate(1, 'A', base);
    shouting.tile.id = shouting.tile.id.toUpperCase();
    expect(orderOf([shouting])).toEqual([id(1)]);
  });
});

describe('the build’s ID', () => {
  const stories = [candidate(1, 'One', 30), candidate(2, 'Two', 20), candidate(3, 'Three', 10)];

  it('is 16 hex characters, which fit the cursor’s build', () => {
    expect(buildId([id(1), id(2)])).toMatch(/^[0-9a-f]{16}$/);
    expect(buildId([])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is the same for the same order, whoever builds it', () => {
    const a = buildForYou(profile(), candidates(stories));
    const b = buildForYou(profile({ less: ['nothing at all'] }), candidates(stories));
    expect(a.id).toBe(b.id);
    expect(a.ids).toEqual(b.ids);
    expect(a.id).toBe(buildId(a.ids));
  });

  it('is new for any change of the order, of the stories or of their number', () => {
    const base = buildForYou(profile(), candidates(stories)).id;
    const reordered = buildForYou(profile({ more: ['three'] }), candidates(stories));
    expect(reordered.ids).toEqual([id(3), id(1), id(2)]);
    expect(reordered.id).not.toBe(base);
    expect(buildForYou(profile({ less: ['two'] }), candidates(stories)).id).not.toBe(base);
    expect(buildId([id(1), id(2), id(3)])).not.toBe(buildId([id(1), id(3), id(2)]));
    expect(buildId([id(1), id(2)])).not.toBe(buildId([id(1), id(2), id(3)]));
  });

  it('does not depend on a score that changed nothing about the order', () => {
    const a = buildForYou(profile({ more: ['unmatched words'] }), candidates(stories));
    expect(a.id).toBe(buildForYou(profile(), candidates(stories)).id);
  });
});
