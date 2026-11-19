import { isCanonical, type ReadingProfile, writeProfile } from '@hrizzup/social/reading-profile';
import { describe, expect, it } from 'vitest';
import { buildPrompt, estimateTokens, type HistoryMessage, SYSTEM_PROMPT } from './prompt.ts';
import { characterCount } from './text.ts';

/** The design note's own text of the system prompt (docs/social/r12-design.md, 3.3, "SYSTEM_PROMPT, exactly"), copied word for word. */
const NOTE_TEXT = `You are the reader agent in Hrizzup, a news app. You help one reader choose what they see in their For You feed. You never post anything and you never write news.

The reader's reading profile has three lists:
- "more": topics, places, people or things they want more of
- "less": topics they want less of
- "formats": the kinds of post they like: breakdowns, timelines, explainers, memes, audio briefs, infographics, translations, source checks

From the reader's new message, make small edits to the lists:
- Add or remove one item at a time. Never rewrite or empty the lists unless the reader asks.
- Keep each item short: a few words, at most 60 characters, in the reader's own words (for example "AI", "the Philippines", "cricket").
- To move an item from one list to the other, remove it from one list and add it to the other.
- Formats go only in "formats", and only the kinds named above.
- If the message asks for no change, make no edits.

Then reply to the reader in one or two short sentences, in their language, saying what you changed. Do not use markdown.

Answer with JSON only, in exactly this shape:
{"reply": "...", "edits": [{"op": "add", "list": "more", "item": "..."}]}
"op" is "add" or "remove"; "list" is "more", "less" or "formats". Use an empty "edits" list when nothing changes.

Example. Profile: {"more": [], "less": [], "formats": []}. Message: "AI news from the Philippines, mostly timelines and memes, no crypto". Answer:
{"reply": "Done: more AI and the Philippines, timelines and memes, and no crypto.", "edits": [{"op": "add", "list": "more", "item": "AI"}, {"op": "add", "list": "more", "item": "the Philippines"}, {"op": "add", "list": "formats", "item": "timelines"}, {"op": "add", "list": "formats", "item": "memes"}, {"op": "add", "list": "less", "item": "crypto"}]}`;

const profileOf = (more: string[] = [], less: string[] = [], formats: string[] = []) => ({
  more,
  less,
  formats,
});
/** 14 items of 40 characters in each list: 1,859 characters written, nearly the most a profile holds. */
const fullProfile = (character = 'x'): ReadingProfile => {
  const list = (letter: string) =>
    Array.from({ length: 14 }, (_, i) => `${String(i).padStart(2, '0')}${letter.repeat(38)}`);
  return profileOf(list(character), list('y'), list('z'));
};
const turns = (count: number, length: number): HistoryMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    author: i % 2 === 0 ? 'reader' : 'agent',
    body: `${i}: ${'word '.repeat(Math.ceil(length / 5))}`.slice(0, length).trimEnd(),
  }));
const userTurn = (built: ReturnType<typeof buildPrompt>) => built.messages[1]?.content ?? '';
const MOST = 2000;
const TARGET = 1800;

describe('the system prompt', () => {
  it("is exactly the design note's text", () => {
    expect(SYSTEM_PROMPT).toBe(NOTE_TEXT);
    expect(SYSTEM_PROMPT.startsWith('You are the reader agent in Hrizzup, a news app.')).toBe(true);
    expect(SYSTEM_PROMPT.endsWith('"item": "crypto"}]}')).toBe(true);
  });
});

describe('estimateTokens', () => {
  it('is the UTF-8 bytes over three, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
    // Devanagari is three bytes a character, so one token a character.
    expect(estimateTokens(String.fromCodePoint(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940))).toBe(6);
  });
});

describe('buildPrompt', () => {
  it('sends the system prompt, then one user turn holding the profile, the history and the message', () => {
    const built = buildPrompt({
      profile: profileOf(['AI'], ['crypto'], ['memes']),
      history: [
        { author: 'reader', body: 'more AI' },
        { author: 'agent', body: 'Done: more AI.' },
      ],
      message: 'less crypto please',
      maxInputTokens: MOST,
    });
    expect(built.messages).toHaveLength(2);
    expect(built.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(built.messages[1]?.role).toBe('user');
    expect(userTurn(built)).toBe(
      [
        'Profile: {"more":["AI"],"less":["crypto"],"formats":["memes"]}',
        'Earlier messages, oldest first:\nReader: more AI\nAgent: Done: more AI.',
        'New message:\nless crypto please',
      ].join('\n\n'),
    );
  });

  it('leaves the earlier messages out when there are none', () => {
    const built = buildPrompt({
      profile: profileOf(),
      history: [],
      message: 'More cricket, no crypto',
      maxInputTokens: MOST,
    });
    expect(userTurn(built)).toBe(
      'Profile: {"more":[],"less":[],"formats":[]}\n\nNew message:\nMore cricket, no crypto',
    );
    expect(userTurn(built)).not.toContain('Earlier messages');
  });

  it('prints the estimate for the live call input (the founder-side check against the true prompt_tokens)', () => {
    const built = buildPrompt({
      profile: profileOf(),
      history: [],
      message: 'More cricket, no crypto',
      maxInputTokens: MOST,
    });
    // The live call compares this with the provider's own `prompt_tokens` (docs/social/r12-design.md, 3.9).
    console.info(`reader-ai estimate for the live call's input: ${built.estimatedTokens}`);
    expect(built.estimatedTokens).toBeGreaterThan(estimateTokens(SYSTEM_PROMPT));
    expect(built.estimatedTokens).toBeLessThanOrEqual(TARGET);
  });

  it('keeps the estimate at or under 1,800 for every Latin case: a full profile, a 2,000-character message and ten long turns', () => {
    const cases: { profile: ReadingProfile; history: HistoryMessage[]; message: string }[] = [
      { profile: profileOf(), history: [], message: 'hi' },
      { profile: profileOf(), history: turns(10, 2000), message: 'x '.repeat(1000).trim() },
      { profile: fullProfile(), history: [], message: 'x '.repeat(1000).trim() },
      { profile: fullProfile(), history: turns(10, 2000), message: 'x '.repeat(1000).trim() },
      { profile: fullProfile(), history: turns(10, 5), message: 'a'.repeat(2000) },
      { profile: fullProfile(), history: turns(3, 400), message: 'short one' },
      { profile: profileOf(['AI']), history: turns(10, 300), message: 'y'.repeat(2000) },
    ];
    for (const [index, input] of cases.entries()) {
      expect(isCanonical(writeProfile(input.profile)), `case ${index} is a real profile`).toBe(
        true,
      );
      const built = buildPrompt({ ...input, maxInputTokens: MOST });
      expect(built.estimatedTokens, `case ${index}`).toBeLessThanOrEqual(TARGET);
    }
  });

  it('keeps the profile whole, always', () => {
    const profile = fullProfile();
    const built = buildPrompt({
      profile,
      history: turns(10, 2000),
      message: 'z'.repeat(2000),
      maxInputTokens: MOST,
    });
    expect(userTurn(built)).toContain(
      `Profile: ${JSON.stringify({ more: profile.more, less: profile.less, formats: profile.formats })}`,
    );
  });

  it('sends a message that fits in full, and cuts one that does not at a word, never below 400 characters', () => {
    const fits = 'tell me about cricket '.repeat(20).trim();
    expect(
      userTurn(
        buildPrompt({ profile: profileOf(), history: [], message: fits, maxInputTokens: MOST }),
      ),
    ).toContain(`New message:\n${fits}`);
    const long = 'cricket scores today '.repeat(100).trim();
    const cut = buildPrompt({
      profile: fullProfile(),
      history: [],
      message: long,
      maxInputTokens: MOST,
    });
    const sent = userTurn(cut).split('New message:\n')[1] ?? '';
    expect(characterCount(sent)).toBeGreaterThanOrEqual(400);
    expect(characterCount(sent)).toBeLessThan(characterCount(long));
    expect(sent.endsWith(String.fromCodePoint(0x2026))).toBe(true);
    // Cut at a word: what is before the ellipsis is whole words of the message.
    expect(long.startsWith(sent.slice(0, -1))).toBe(true);
    expect(long.slice(sent.length - 1, sent.length)).toBe(' ');
    expect(cut.estimatedTokens).toBeLessThanOrEqual(TARGET);
    // Even with the target nearly spent on the system prompt and profile, 400 characters are sent.
    const tight = buildPrompt({
      profile: fullProfile(),
      history: [],
      message: long,
      maxInputTokens: 1100,
    });
    expect(characterCount(userTurn(tight).split('New message:\n')[1] ?? '')).toBeGreaterThanOrEqual(
      400,
    );
  });

  it('fills the history newest first, each cut to 400 characters, and stops at the first that does not fit', () => {
    const history = turns(10, 2000).map((turn, i) => ({ ...turn, body: `${i}${turn.body}` }));
    const built = buildPrompt({
      profile: fullProfile(),
      history,
      message: 'and one more thing about cricket',
      maxInputTokens: MOST,
    });
    const turn = userTurn(built);
    const kept = turn
      .split('Earlier messages, oldest first:\n')[1]
      ?.split('\n\nNew message:')[0]
      ?.split('\n');
    expect(kept?.length).toBeGreaterThan(0);
    // The newest are the ones kept, oldest first within them; the last kept is the newest of all.
    expect(kept?.at(-1)?.startsWith('Agent: 9')).toBe(true);
    for (const line of kept ?? []) {
      expect(characterCount(line.replace(/^(Reader|Agent): /, ''))).toBeLessThanOrEqual(400);
    }
    expect((kept?.length ?? 0) < 10).toBe(true);
    expect(built.estimatedTokens).toBeLessThanOrEqual(TARGET);
    // With room for all ten, all ten are sent, each cut to 400.
    const roomy = buildPrompt({
      profile: profileOf(),
      history: turns(10, 100),
      message: 'hello',
      maxInputTokens: MOST,
    });
    expect(userTurn(roomy).match(/\n(Reader|Agent): /g)?.length).toBe(10);
    expect(userTurn(roomy)).toContain('Reader: 0:');
  });

  it('still sends the call when a profile in a costly script passes the target: the profile and 400 characters stay', () => {
    const hindi = String.fromCodePoint(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940).repeat(6);
    const heavy = profileOf(
      Array.from({ length: 14 }, (_, i) => `${i}${hindi}`),
      Array.from({ length: 14 }, (_, i) => `${i}${hindi}`),
      Array.from({ length: 14 }, (_, i) => `${i}${hindi}`),
    );
    expect(isCanonical(writeProfile(heavy))).toBe(true);
    const message = 'cricket '.repeat(200).trim();
    const built = buildPrompt({
      profile: heavy,
      history: turns(5, 300),
      message,
      maxInputTokens: MOST,
    });
    expect(built.estimatedTokens).toBeGreaterThan(TARGET);
    expect(userTurn(built)).toContain(JSON.stringify(heavy));
    expect(characterCount(userTurn(built).split('New message:\n')[1] ?? '')).toBeGreaterThanOrEqual(
      400,
    );
    expect(userTurn(built)).not.toContain('Earlier messages');
  });

  it('aims at 90% of the allowance it is given', () => {
    const history = turns(10, 400);
    const small = buildPrompt({
      profile: profileOf(),
      history,
      message: 'hello there',
      maxInputTokens: 1000,
    });
    const large = buildPrompt({
      profile: profileOf(),
      history,
      message: 'hello there',
      maxInputTokens: MOST,
    });
    expect(small.estimatedTokens).toBeLessThanOrEqual(900 + 400);
    expect(large.estimatedTokens).toBeLessThanOrEqual(TARGET);
    expect(large.estimatedTokens).toBeGreaterThan(small.estimatedTokens);
  });
});
