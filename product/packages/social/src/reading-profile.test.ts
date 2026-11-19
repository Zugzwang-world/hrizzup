import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  checkItem,
  cleanItem,
  EMPTY_PROFILE,
  emptyProfile,
  holdsSomething,
  isCanonical,
  MAX_EDITS,
  parseProfile,
  type ReadingProfile,
  writeProfile,
} from './reading-profile.ts';

/**
 * The profiles in the reader agent's examples (the contract's `social/examples/readers.json`, which its own tests
 * hold to the contract's shapes; `readers.test.ts` of the website parses the examples themselves through this
 * code): the stored form, copied here so this package's tests read nothing outside it.
 */
const EXAMPLE_PROFILES = [
  '# Reading profile\n\n## More of\n- AI\n- the Philippines\n\n## Less of\n- crypto\n\n## Formats\n- timelines\n- memes',
  '# Reading profile\n\n## More of\n- AI\n- the Philippines\n- Bengaluru\n\n## Less of\n- crypto\n\n## Formats\n- timelines\n- memes',
];

/** Characters built in code, never typed: hidden ones don't survive being pasted into a source file. */
const char = (...points: number[]) => String.fromCodePoint(...points);
const ZWSP = char(0x200b);
const ZWJ = char(0x200d);
const NBSP = char(0xa0);
const IDEOGRAPHIC_SPACE = char(0x3000);
const TAG_A = char(0xe0041);
const PRIVATE_USE = char(0xf0000);
const VS16 = char(0xfe0f);
const BOM = char(0xfeff);
const RLO = char(0x202e);

const profileOf = (more: string[] = [], less: string[] = [], formats: string[] = []) => ({
  more,
  less,
  formats,
});
const issuesOf = (text: string) => {
  const result = parseProfile(text);
  if (result.ok) throw new Error('expected the profile to be refused');
  return result.issues.map((issue) => issue.message);
};
const okProfile = (text: string): ReadingProfile => {
  const result = parseProfile(text);
  if (!result.ok) throw new Error(`refused: ${result.issues.map((i) => i.message).join('; ')}`);
  return result.profile;
};

describe('the stored form', () => {
  it('has the empty profile at 53 characters, holding nothing', () => {
    expect(EMPTY_PROFILE).toHaveLength(53);
    expect(writeProfile(emptyProfile())).toBe(EMPTY_PROFILE);
    expect(isCanonical(EMPTY_PROFILE)).toBe(true);
    expect(holdsSomething(emptyProfile())).toBe(false);
    expect(parseProfile('')).toEqual({ ok: true, profile: emptyProfile() });
  });

  it('round-trips the examples: parse, then write, gives the very same text', () => {
    for (const text of EXAMPLE_PROFILES) {
      expect(isCanonical(text)).toBe(true);
      expect(writeProfile(okProfile(text))).toBe(text);
    }
    const first = okProfile(EXAMPLE_PROFILES[0] as string);
    expect(first).toEqual(profileOf(['AI', 'the Philippines'], ['crypto'], ['timelines', 'memes']));
    expect(holdsSomething(first)).toBe(true);
  });

  it('is written with the title, the three headings in order, "- item", blank lines between and no final new line', () => {
    const text = writeProfile(profileOf(['AI'], [], ['memes']));
    expect(text).toBe('# Reading profile\n\n## More of\n- AI\n\n## Less of\n\n## Formats\n- memes');
    expect(text.endsWith('\n')).toBe(false);
  });

  it('passes isCanonical for every profile written from a generated set', () => {
    // A small deterministic generator: items of every script and shape the rules allow, in every list.
    let seed = 20261119;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = [
      'AI',
      'the Philippines',
      'cricket',
      char(0x0939, 0x093f, 0x0928, 0x094d, 0x0926, 0x0940),
      char(0x65e5, 0x672c, 0x8a9e),
      char(0x1f680),
      char(0x1f469, 0x200d, 0x1f4bb),
      `cafe${char(0x301)}`,
      'x',
      '2026',
      'a-b',
      "it's",
    ];
    for (let n = 0; n < 200; n++) {
      const list = () => {
        const items: string[] = [];
        const count = next(8);
        for (let i = 0; i < count; i++) {
          const item = Array.from({ length: 1 + next(4) }, () => pieces[next(pieces.length)]).join(
            ' ',
          );
          const clean = cleanItem(item);
          if (checkItem(clean) === null && !items.includes(clean)) items.push(clean);
        }
        return items;
      };
      const profile = profileOf(list(), list(), list());
      const text = writeProfile(profile);
      expect(isCanonical(text), text).toBe(true);
      expect(okProfile(text)).toEqual(profile);
    }
  });
});

describe('isCanonical, as the database checks it', () => {
  const heads = '## Less of\n\n## Formats';
  const item = (text: string) => `# Reading profile\n\n## More of\n- ${text}\n\n${heads}`;

  it('accepts a 60-character item, 20 items, and an item in another script or an emoji', () => {
    expect(isCanonical(item('x'.repeat(60)))).toBe(true);
    expect(isCanonical(item(char(0x1f680).repeat(60)))).toBe(true);
    expect(
      isCanonical(writeProfile(profileOf(Array.from({ length: 20 }, (_, i) => `item ${i}`)))),
    ).toBe(true);
    expect(isCanonical(item(char(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940)))).toBe(true);
    expect(isCanonical(item(`a${VS16}`))).toBe(true);
  });

  it('refuses what the database refuses: the length, the shape and each item', () => {
    const refused: [string, unknown][] = [
      ['a missing heading', '# Reading profile\n\n## More of\n- AI\n\n## Formats'],
      ['headings out of order', '# Reading profile\n\n## Less of\n\n## More of\n\n## Formats'],
      ['no title', '## More of\n\n## Less of\n\n## Formats'],
      ['a 61-character item', item('x'.repeat(61))],
      ['61 emoji', item(char(0x1f680).repeat(61))],
      [
        '21 items',
        `# Reading profile\n\n## More of\n${Array.from({ length: 21 }, (_, i) => `- item ${i}`).join('\n')}\n\n${heads}`,
      ],
      ['a final new line', `${EMPTY_PROFILE}\n`],
      ['a tab', item('two\twords')],
      ['an empty text', ''],
      ['2,001 characters', `${EMPTY_PROFILE}${' '.repeat(0)}${'x'.repeat(2001 - 53)}`],
      ['an empty item', '# Reading profile\n\n## More of\n- \n\n## Less of\n\n## Formats'],
      ['an item ending in a space', item('AI ')],
      ['an item starting with a space', item(' AI')],
      ['an item ending in a no-break space', item(`AI${NBSP}`)],
      ['an item ending in an ideographic space', item(`AI${IDEOGRAPHIC_SPACE}`)],
      ['a zero-width space', item(`A${ZWSP}I`)],
      ['a direction override', item(`A${RLO}I`)],
      ['a tag character', item(`A${TAG_A}I`)],
      ['a private-use character', item(`A${PRIVATE_USE}I`)],
      ['a joiner next to plain text', item(`A${ZWJ}I`)],
      ['a joiner at the end', item(`AI${ZWJ}`)],
      ['stacked variation selectors', item(`A${VS16}${VS16}`)],
      ['a byte order mark', item(`A${BOM}I`)],
      ['a control character', item(`A${char(1)}I`)],
      ['a carriage return', item(`AI${char(13)}`)],
      ['not a string', null],
    ];
    for (const [name, text] of refused) {
      expect(isCanonical(text), name).toBe(false);
    }
  });

  it('is the check that every item passes once, in place', () => {
    expect(checkItem('AI')).toBeNull();
    expect(checkItem('')).toBe('empty');
    expect(checkItem('x'.repeat(61))).toBe('too_long');
    expect(checkItem(`A${ZWSP}I`)).toBe('characters');
    // A joiner is judged where it sits: after "- " it follows a plain space, which the code checks refuse.
    expect(checkItem(`${ZWJ}${char(0x1f469)}`)).toBe('characters');
    expect(checkItem(char(0x1f469, 0x200d, 0x1f4bb))).toBeNull();
  });
});

describe('parseProfile', () => {
  it('accepts any heading case, other bullets, blank lines and a missing title', () => {
    const typed = [
      '## more of',
      '* AI',
      '+ the Philippines',
      '',
      '',
      '## LESS OF',
      '1. crypto',
      '2) sports betting',
      '## Formats',
      '- timelines',
    ].join('\n');
    expect(okProfile(typed)).toEqual(
      profileOf(['AI', 'the Philippines'], ['crypto', 'sports betting'], ['timelines']),
    );
    expect(isCanonical(writeProfile(okProfile(typed)))).toBe(true);
  });

  it('accepts a missing heading, as an empty list, and drops a title before the first heading', () => {
    expect(okProfile('# My reading\n\n## Formats\n- memes')).toEqual(profileOf([], [], ['memes']));
    expect(okProfile('## More of\n- AI')).toEqual(profileOf(['AI']));
  });

  it('tidies each item: Unicode NFC, runs of white space made one space, no space at either end', () => {
    const decomposed = `cafe${char(0x301)}`;
    const composed = `caf${char(0xe9)}`;
    expect(cleanItem(`  ${decomposed}  \t the   ${NBSP}  Philippines `)).toBe(
      `${composed} the Philippines`,
    );
    expect(okProfile(`## More of\n-   ${decomposed}   news  \n`).more).toEqual([
      `${composed} news`,
    ]);
    // An empty bullet is skipped, not refused.
    expect(okProfile('## More of\n-\n- \n* AI')).toEqual(profileOf(['AI']));
  });

  it('drops a repeat in its list silently, comparing without case and after NFKC', () => {
    const wide = char(0xff21, 0xff29);
    expect(okProfile(`## More of\n- AI\n- ai\n- ${wide}\n- Cricket\n## Less of\n- AI`)).toEqual(
      profileOf(['AI', 'Cricket'], ['AI']),
    );
  });

  it('refuses what it can not read, naming the line', () => {
    expect(issuesOf('## More of\n- AI\nsome words')).toEqual([
      'Line 3: each line is a heading or an item starting with "- "',
    ]);
    expect(issuesOf('- AI')).toEqual(['Line 1: put each item under a heading']);
    expect(issuesOf('## Topics\n- AI')).toEqual([
      'Line 1: the headings are ## More of, ## Less of and ## Formats',
    ]);
    expect(issuesOf('### More of\n- AI')).toEqual([
      'Line 1: the headings are ## More of, ## Less of and ## Formats',
    ]);
    expect(issuesOf('## More of\n- AI\n## more of\n- cricket')).toEqual([
      'Line 3: ## More of appears twice: keep one',
    ]);
    expect(issuesOf('## More of\n\n\n- an item\n# Title after a heading')).toEqual([
      'Line 5: each line is a heading or an item starting with "- "',
    ]);
    expect(issuesOf(`## Formats\n- ${'x'.repeat(61)}`)).toEqual([
      'Line 2: an item is at most 60 characters (this one is 61)',
    ]);
    expect(issuesOf(`## Formats\n- A${ZWSP}I`)).toEqual([
      'Line 2: an item is plain text, with no hidden or control characters',
    ]);
    expect(issuesOf('## More of\n#AI')).toEqual([
      'Line 2: each line is a heading or an item starting with "- "',
    ]);
  });

  it('counts an item by characters, not by UTF-16 units', () => {
    expect(okProfile(`## More of\n- ${char(0x1f680).repeat(60)}`).more).toHaveLength(1);
    expect(issuesOf(`## More of\n- ${char(0x1f680).repeat(61)}`)).toEqual([
      'Line 2: an item is at most 60 characters (this one is 61)',
    ]);
  });

  it('refuses a list of more than 20 items, and a profile over 2,000 characters once tidied', () => {
    const many = Array.from({ length: 21 }, (_, i) => `- item ${i}`).join('\n');
    expect(issuesOf(`## Less of\n${many}`)).toEqual(['## Less of has 21 items: at most 20']);
    // 3 lists of 20 items of 31 characters: over 2,000 once written (20 x 33 x 3 = 1,980 plus the headings).
    const long = (list: string) =>
      `## ${list}\n${Array.from({ length: 20 }, (_, i) => `- ${String(i).padStart(2, '0')}${'x'.repeat(29)}`).join('\n')}`;
    const text = ['More of', 'Less of', 'Formats'].map(long).join('\n\n');
    expect(issuesOf(text)).toEqual([
      expect.stringMatching(
        /^Your profile would be \d+ characters: at most 2,000, so take some items out$/,
      ),
    ]);
    // The check is on the tidied text: extra spaces and blank lines that tidying removes don't count.
    const padded = `\n\n## More of\n${'   '.repeat(300)}-    AI     \n\n\n\n`;
    expect(okProfile(padded)).toEqual(profileOf(['AI']));
  });

  it('answers at most the first 10 issues, all on the body', () => {
    const bad = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(10);
      expect(result.issues.every((issue) => issue.path === 'body')).toBe(true);
      expect(result.issues[0]?.message).toBe(
        'Line 1: each line is a heading or an item starting with "- "',
      );
    }
  });
});

describe('applyEdits', () => {
  const start = profileOf(['AI'], ['crypto'], ['memes']);
  const add = (list: 'more' | 'less' | 'formats', item: string) => ({ op: 'add', list, item });
  const remove = (list: 'more' | 'less' | 'formats', item: string) => ({
    op: 'remove',
    list,
    item,
  });

  it('adds an item, tidied, at the end of its list', () => {
    const done = applyEdits(start, [
      add('more', '  the   Philippines '),
      add('formats', 'timelines'),
    ]);
    expect(done).toEqual({
      profile: profileOf(['AI', 'the Philippines'], ['crypto'], ['memes', 'timelines']),
      applied: 2,
      dropped: 0,
    });
    // The profile it was given is not changed.
    expect(start).toEqual(profileOf(['AI'], ['crypto'], ['memes']));
  });

  it('removes the case-insensitive match; an item that is not there is a no-op, neither applied nor dropped', () => {
    expect(applyEdits(start, [remove('more', 'ai'), remove('less', 'sports')])).toEqual({
      profile: profileOf([], ['crypto'], ['memes']),
      applied: 1,
      dropped: 0,
    });
  });

  it('moves an item between More of and Less of in either direction', () => {
    expect(applyEdits(start, [add('more', 'Crypto')])).toEqual({
      profile: profileOf(['AI', 'Crypto'], [], ['memes']),
      applied: 1,
      dropped: 0,
    });
    expect(applyEdits(start, [add('less', 'ai')])).toEqual({
      profile: profileOf([], ['crypto', 'ai'], ['memes']),
      applied: 1,
      dropped: 0,
    });
    // Formats have no opposite.
    expect(applyEdits(start, [add('formats', 'AI')]).profile).toEqual(
      profileOf(['AI'], ['crypto'], ['memes', 'AI']),
    );
  });

  it('treats an item already in its list as a no-op', () => {
    expect(applyEdits(start, [add('more', 'ai'), add('less', 'CRYPTO')])).toEqual({
      profile: start,
      applied: 0,
      dropped: 0,
    });
  });

  it('drops an add that is empty, too long, hidden or over a full list, and keeps the rest', () => {
    const full = profileOf(Array.from({ length: 20 }, (_, i) => `item ${i}`));
    expect(
      applyEdits(full, [add('more', 'one more'), add('less', 'ok'), add('more', 'x'.repeat(61))]),
    ).toEqual({
      profile: { ...full, less: ['ok'] },
      applied: 1,
      dropped: 2,
    });
    expect(
      applyEdits(start, [add('more', ''), add('more', `A${ZWSP}I`), add('more', 'cricket')]),
    ).toEqual({
      profile: profileOf(['AI', 'cricket'], ['crypto'], ['memes']),
      applied: 1,
      dropped: 2,
    });
    // A move into a full list is dropped whole: the item stays where it was.
    const result = applyEdits({ ...full, less: ['crypto'] }, [add('more', 'crypto')]);
    expect(result.profile.less).toEqual(['crypto']);
    expect(result.dropped).toBe(1);
  });

  it('drops an operation that is not of the form, and reads at most the first 10', () => {
    const mixed = [
      { op: 'rewrite', list: 'more', item: 'x' },
      { op: 'add', list: 'nope', item: 'x' },
      { op: 'add', list: 'more', item: 7 },
      null,
      'add more x',
      add('more', 'kept'),
    ];
    expect(applyEdits(emptyProfile(), mixed)).toEqual({
      profile: profileOf(['kept']),
      applied: 1,
      dropped: 5,
    });
    const fifty = Array.from({ length: 50 }, (_, i) => add('more', `item ${i}`));
    const done = applyEdits(emptyProfile(), fifty);
    expect(MAX_EDITS).toBe(10);
    expect(done.profile.more).toEqual(Array.from({ length: 10 }, (_, i) => `item ${i}`));
    expect(done.applied).toBe(10);
  });

  it('keeps the old profile, every operation dropped, when the result is over 2,000 characters', () => {
    const near = profileOf(
      Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}${'x'.repeat(30)}`),
      Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}${'y'.repeat(30)}`),
      Array.from({ length: 14 }, (_, i) => `${String(i).padStart(2, '0')}${'z'.repeat(30)}`),
    );
    expect(isCanonical(writeProfile(near))).toBe(true);
    expect(writeProfile(near).length).toBeGreaterThan(1900);
    const done = applyEdits(near, [
      add('formats', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      add('formats', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    ]);
    expect(done.profile).toEqual(near);
    expect(done).toMatchObject({ applied: 0, dropped: 2 });
  });

  it('always answers a profile the database accepts', () => {
    const hostile = [
      add('more', `${ZWJ}${char(0x1f469)}`),
      add('more', `${char(0x1f469)}${ZWJ}`),
      add('less', `A${VS16}${VS16}`),
      add('formats', `x${NBSP}y`),
      add('more', `${IDEOGRAPHIC_SPACE}cricket${IDEOGRAPHIC_SPACE}`),
      add('more', char(0x1f469, 0x200d, 0x1f4bb)),
    ];
    const done = applyEdits(start, hostile);
    expect(isCanonical(writeProfile(done.profile))).toBe(true);
    expect(done.profile.more).toContain('cricket');
    expect(done.profile.more).toContain(char(0x1f469, 0x200d, 0x1f4bb));
    expect(done.profile.formats).toContain('x y');
    expect(done.dropped).toBe(3);
  });
});
