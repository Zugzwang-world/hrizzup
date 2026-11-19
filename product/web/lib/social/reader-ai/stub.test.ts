import {
  applyEdits,
  emptyProfile,
  isCanonical,
  type ReadingProfile,
  writeProfile,
} from '@hrizzup/social/reading-profile';
import { describe, expect, it } from 'vitest';
import { cleanReply } from './answer.ts';
import { stubProvider } from './index.ts';
import { STUB_LABEL, stubAnswer, stubEdits } from './stub.ts';

const EXAMPLE = 'AI news from the Philippines, mostly timelines and memes, no crypto';
const request = (message: string, profile: ReadingProfile = emptyProfile()) => ({
  prompt: { messages: [], estimatedTokens: 0 },
  maxOutputTokens: 300,
  message,
  profile,
});

describe('the stand-in', () => {
  it("reads the example message as the example's edits", () => {
    expect(stubEdits(EXAMPLE)).toEqual([
      { op: 'add', list: 'more', item: 'AI news' },
      { op: 'add', list: 'more', item: 'the Philippines' },
      { op: 'add', list: 'formats', item: 'timelines' },
      { op: 'add', list: 'formats', item: 'memes' },
      { op: 'add', list: 'less', item: 'crypto' },
    ]);
    const done = applyEdits(emptyProfile(), stubEdits(EXAMPLE));
    expect(done.profile).toEqual({
      more: ['AI news', 'the Philippines'],
      less: ['crypto'],
      formats: ['timelines', 'memes'],
    });
    expect(isCanonical(writeProfile(done.profile))).toBe(true);
  });

  it('replies with the label first, then what changed, in More of, Less of, Formats order', () => {
    const { reply } = stubAnswer(EXAMPLE, emptyProfile());
    expect(reply).toBe(
      `${STUB_LABEL} More of: AI news, the Philippines; Less of: crypto; Formats: timelines, memes`,
    );
    expect(reply.startsWith("(Stand-in, Workers AI isn't set up here")).toBe(true);
  });

  it('names only what changed, and says so when nothing did', () => {
    const profile = { more: ['AI news'], less: [], formats: [] };
    expect(stubAnswer('AI news, cricket', profile).reply).toBe(`${STUB_LABEL} More of: cricket`);
    expect(stubAnswer('hello', { more: ['hello'], less: [], formats: [] }).reply).toBe(
      `${STUB_LABEL} I didn't find anything to change: try "more cricket, no crypto".`,
    );
    expect(stubAnswer('', emptyProfile()).reply).toBe(
      `${STUB_LABEL} I didn't find anything to change: try "more cricket, no crypto".`,
    );
  });

  it('reads each kind of clause: less words, remove words, formats and more words', () => {
    expect(stubEdits('no more crypto')).toEqual([{ op: 'add', list: 'less', item: 'crypto' }]);
    expect(
      stubEdits('Less sports betting, fewer ads, without gossip, stop spam, skip quizzes'),
    ).toEqual(
      ['sports betting', 'ads', 'gossip', 'spam', 'quizzes'].map((item) => ({
        op: 'add',
        list: 'less',
        item,
      })),
    );
    expect(stubEdits('not golf')).toEqual([{ op: 'add', list: 'less', item: 'golf' }]);
    expect(stubEdits('remove crypto')).toEqual(
      ['more', 'less', 'formats'].map((list) => ({ op: 'remove', list, item: 'crypto' })),
    );
    expect(stubEdits('Forget Cricket')).toHaveLength(3);
    expect(stubEdits('drop golf')[0]).toEqual({ op: 'remove', list: 'more', item: 'golf' });
    expect(stubEdits('source checks and audio briefs')).toEqual([
      { op: 'add', list: 'formats', item: 'source checks' },
      { op: 'add', list: 'formats', item: 'audio briefs' },
    ]);
    expect(stubEdits('I want cricket')).toEqual([{ op: 'add', list: 'more', item: 'cricket' }]);
    expect(stubEdits('show me Mumbai news')).toEqual([
      { op: 'add', list: 'more', item: 'Mumbai news' },
    ]);
    expect(stubEdits('more')).toEqual([]);
    expect(stubEdits('no')).toEqual([]);
    // Whole words only: "nothing" and "notable" are not "no" and "not".
    expect(stubEdits('nothing notable')).toEqual([
      { op: 'add', list: 'more', item: 'nothing notable' },
    ]);
  });

  it('keeps the reader own words and case, and a plural form for a format', () => {
    expect(stubEdits('INFOGRAPHIC')).toEqual([
      { op: 'add', list: 'formats', item: 'infographics' },
    ]);
    expect(stubEdits('Explainer, translation')).toEqual([
      { op: 'add', list: 'formats', item: 'explainers' },
      { op: 'add', list: 'formats', item: 'translations' },
    ]);
    expect(stubEdits('Bengaluru Startups')).toEqual([
      { op: 'add', list: 'more', item: 'Bengaluru Startups' },
    ]);
  });

  it('is deterministic, takes no neurons, and says nothing about how it was answered', async () => {
    const first = await stubProvider.run(request(EXAMPLE));
    const second = await stubProvider.run(request(EXAMPLE));
    expect(second).toEqual(first);
    expect(first).toEqual({
      ok: true,
      answer: {
        provider: 'stub',
        usage: { promptTokens: 0, completionTokens: 0 },
        form: null,
        reply: expect.stringMatching(/^\(Stand-in/),
        edits: stubEdits(EXAMPLE),
      },
    });
  });

  it('gives a reply the reader can be shown after the usual cleaning', () => {
    const { reply } = stubAnswer(EXAMPLE, emptyProfile());
    expect(cleanReply(reply, { applied: 5, dropped: 0 })).toBe(reply);
  });
});
