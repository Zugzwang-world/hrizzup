import { social } from '@hrizzup/api';
import { describe, expect, it } from 'vitest';
import { cleanReply, MAX_REPLY_CHARACTERS, readAnswer, UNREADABLE_REPLY } from './answer.ts';
import { characterCount } from './text.ts';

const char = (...points: number[]) => String.fromCodePoint(...points);
const ELLIPSIS = char(0x2026);
const usage = { prompt_tokens: 600, completion_tokens: 85 };
const ours = {
  reply: 'Done: more cricket.',
  edits: [{ op: 'add', list: 'more', item: 'cricket' }],
};
const plain = social.plainText(2000);
const none = { applied: 0, dropped: 0 };

describe('readAnswer', () => {
  it('reads an object as the model answers it: form json', () => {
    expect(readAnswer({ response: ours, usage })).toEqual({
      form: 'json',
      reply: 'Done: more cricket.',
      edits: ours.edits,
      usage: { promptTokens: 600, completionTokens: 85 },
    });
  });

  it('reads a JSON string, trimmed: form json', () => {
    expect(readAnswer({ response: `  ${JSON.stringify(ours)}\n`, usage })).toMatchObject({
      form: 'json',
      reply: 'Done: more cricket.',
      edits: ours.edits,
    });
  });

  it('reads a fenced string, with or without the word json: form json', () => {
    for (const fence of ['```json', '```', '```JSON']) {
      expect(
        readAnswer({ response: `${fence}\n${JSON.stringify(ours)}\n\`\`\``, usage }),
      ).toMatchObject({ form: 'json', reply: 'Done: more cricket.', edits: ours.edits });
    }
    // A fence that is never closed is read as well.
    expect(readAnswer({ response: `\`\`\`json\n${JSON.stringify(ours)}`, usage })).toMatchObject({
      form: 'json',
    });
  });

  it('finds JSON inside other text: form json_in_text', () => {
    const text = `Sure! Here you go: ${JSON.stringify(ours)} Hope that helps.`;
    expect(readAnswer({ response: text, usage })).toMatchObject({
      form: 'json_in_text',
      reply: 'Done: more cricket.',
      edits: ours.edits,
    });
  });

  it('keeps plain text as the reply, with no edits: form text', () => {
    expect(readAnswer({ response: 'I added cricket for you.', usage })).toEqual({
      form: 'text',
      reply: 'I added cricket for you.',
      edits: [],
      usage: { promptTokens: 600, completionTokens: 85 },
    });
  });

  it('never shows broken JSON: the reply is the fallback sentence', () => {
    for (const broken of [
      '{"reply": "Done: more cricket.", "edits": [{"op": "add", "list": "mo',
      '{reply: nope}',
      '{',
    ]) {
      const read = readAnswer({ response: broken, usage });
      expect(read.form, broken).toBe('text');
      expect(read.reply, broken).toBe(UNREADABLE_REPLY);
      expect(read.edits, broken).toEqual([]);
    }
  });

  it('treats a missing or odd response as an answered call, form text, with the fallback', () => {
    for (const response of [undefined, null, 42, true, ['a']]) {
      expect(readAnswer({ response, usage })).toMatchObject({
        form: 'text',
        reply: UNREADABLE_REPLY,
        edits: [],
      });
    }
    expect(readAnswer(undefined)).toEqual({
      form: 'text',
      reply: UNREADABLE_REPLY,
      edits: [],
      usage: null,
    });
    expect(readAnswer({})).toMatchObject({ form: 'text', usage: null });
  });

  it('checks the object leniently: a reply that is not a string is none, edits that are not a list are none', () => {
    expect(readAnswer({ response: { reply: 7, edits: 'no' } })).toMatchObject({
      form: 'json',
      reply: null,
      edits: [],
    });
    expect(readAnswer({ response: { reply: 'ok' } })).toMatchObject({
      form: 'json',
      reply: 'ok',
      edits: [],
    });
    // Each edit is checked on its own by applyEdits; read keeps the list as the model gave it.
    const edits = [{ op: 'add', list: 'more', item: 'a' }, 'nonsense', null];
    expect(readAnswer({ response: { reply: 'ok', edits } }).edits).toEqual(edits);
    // A JSON value that isn't an object (a list, a number) is not our JSON.
    expect(readAnswer({ response: '[1, 2]' })).toMatchObject({ form: 'text', reply: '[1, 2]' });
    expect(readAnswer({ response: '42' })).toMatchObject({ form: 'text', reply: '42' });
  });

  it('uses the usage only when both counts are whole numbers from 0 to 1,000,000, else both are null', () => {
    const answer = (value: unknown) => readAnswer({ response: ours, usage: value }).usage;
    expect(answer({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(answer({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).not.toBeNull();
    for (const bad of [
      undefined,
      null,
      'usage',
      {},
      { prompt_tokens: 600 },
      { completion_tokens: 85 },
      { prompt_tokens: 600.5, completion_tokens: 85 },
      { prompt_tokens: -1, completion_tokens: 85 },
      { prompt_tokens: 1_000_001, completion_tokens: 85 },
      { prompt_tokens: '600', completion_tokens: 85 },
      { prompt_tokens: 600, completion_tokens: null },
      { prompt_tokens: Number.NaN, completion_tokens: 1 },
    ]) {
      expect(answer(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('cleanReply', () => {
  it('passes plain text through, with no note when nothing was dropped', () => {
    expect(cleanReply('Done: more cricket.', { applied: 1, dropped: 0 })).toBe(
      'Done: more cricket.',
    );
  });

  it('makes hostile input pass plainText(2000) and the database code checks: tabs, controls, hidden characters, 5,000 characters', () => {
    const hostile = [
      `a\tb${char(0)}c${char(0x1b)}[31md${char(0x7f)}e${char(0x85)}f`,
      `one${char(0x200b)}two${char(0x202e)}three${char(0xfeff)}four${char(0xad)}five`,
      `${char(0xe0041)}tag${char(0xf0000)}private${char(0x3164)}filler${char(0x34f)}joiner`,
      `line\r\nbreak${char(0x2028)}separator${char(0x2029)}end`,
      `\n\n\n\nA\n\n\n\n\nB\n\n\n`,
      `   padded   `,
      `${char(0x200d)}start and end${char(0x200d)}`,
      `a${char(0x200d)}b`,
      `${char(0xfe0f)}${char(0xfe0f)}x${char(0xfe0f)}${char(0xfe0f)}`,
      `${char(0xfe00)}${char(0xe0100)}x`,
      'word '.repeat(1000),
      'x'.repeat(5000),
      char(0x1f680).repeat(3000),
      `${char(0x1f469, 0x200d, 0x1f4bb)} coder`,
    ];
    for (const text of hostile) {
      const clean = cleanReply(text, none);
      // Against the contract's own schemas, never the helper `cleanReply` itself asks: `plainText(2000)` for the
      // pattern, and `longText(2000)`, whose code checks are the contract's own copy of the agreement's.
      expect(plain.safeParse(clean).success, JSON.stringify(clean).slice(0, 80)).toBe(true);
      expect(
        social.longText(2000).safeParse(clean).success,
        JSON.stringify(clean).slice(0, 80),
      ).toBe(true);
      expect(characterCount(clean)).toBeLessThanOrEqual(MAX_REPLY_CHARACTERS);
      expect(clean.length).toBeGreaterThan(0);
    }
  });

  it('removes what it should and keeps what it should', () => {
    expect(cleanReply(`a\tb`, none)).toBe('a b');
    expect(cleanReply(`x${char(0)}y${char(0x1b)}z`, none)).toBe('xyz');
    expect(cleanReply(`x${char(0x200b)}y${char(0x202e)}z`, none)).toBe('xyz');
    expect(cleanReply('A\n\n\n\nB', none)).toBe('A\n\nB');
    expect(cleanReply('  padded \n', none)).toBe('padded');
    expect(cleanReply(`${char(0x2028)}A${char(0x2029)}B`, none)).toBe('A\nB');
    // The emoji's own joiner and the decomposed form of an accent are kept and composed.
    expect(cleanReply(`${char(0x1f469, 0x200d, 0x1f4bb)} coder`, none)).toBe(
      `${char(0x1f469, 0x200d, 0x1f4bb)} coder`,
    );
    expect(cleanReply(`cafe${char(0x301)}`, none)).toBe(`caf${char(0xe9)}`);
  });

  it('cuts a long reply at a word with an ellipsis, at 2,000 characters at most', () => {
    const long = cleanReply('word '.repeat(1000), none);
    expect(characterCount(long)).toBeLessThanOrEqual(2000);
    expect(long.endsWith(ELLIPSIS)).toBe(true);
    expect(long.endsWith(`word${ELLIPSIS}`)).toBe(true);
    expect(characterCount(cleanReply(char(0x1f680).repeat(3000), none))).toBeLessThanOrEqual(2000);
  });

  it('falls back when nothing is left, or what is left is not plain text the database takes', () => {
    const nothing = "I didn't change anything: tell me what you'd like more or less of.";
    const done = 'Done: I updated your reading profile.';
    for (const empty of [null, '', '   ', `${char(0x200b)}${char(0x200b)}`, '\n\n']) {
      expect(cleanReply(empty, none)).toBe(nothing);
      expect(cleanReply(empty, { applied: 2, dropped: 0 })).toBe(done);
    }
    // A joiner beside plain text passes the contract's pattern but not the database's code checks.
    expect(cleanReply(`a${char(0x200d)}b`, none)).toBe(nothing);
    expect(cleanReply(`a${char(0x200d)}b`, { applied: 1, dropped: 0 })).toBe(done);
  });

  it('adds the note when an operation was dropped, if the total stays within 2,000 characters', () => {
    const note = "(Some changes didn't fit: items are at most 60 characters, 20 a heading.)";
    expect(cleanReply('Done.', { applied: 1, dropped: 2 })).toBe(`Done. ${note}`);
    const nearly = 'x'.repeat(1990);
    expect(cleanReply(nearly, { applied: 1, dropped: 1 })).toBe(nearly);
    expect(plain.safeParse(cleanReply('Done.', { applied: 1, dropped: 2 })).success).toBe(true);
  });

  it('adds the stale note instead, when the profile moved three times and was left as it is', () => {
    const stale =
      'Your profile changed while I was answering, so I left it as it is: tell me again if something is missing.';
    expect(cleanReply('Done: more cricket.', { applied: 0, dropped: 3, stale: true })).toBe(
      `Done: more cricket. ${stale}`,
    );
    expect(cleanReply(null, { applied: 0, dropped: 0, stale: true })).toBe(
      `I didn't change anything: tell me what you'd like more or less of. ${stale}`,
    );
  });
});
