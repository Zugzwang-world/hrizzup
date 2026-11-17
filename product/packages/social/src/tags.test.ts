import { describe, expect, it } from 'vitest';
import {
  agentTag,
  checkedTags,
  deskTag,
  familyTags,
  isValidTag,
  MAX_TAG_BYTES,
  MAX_TAGS_PER_RESPONSE,
  postTag,
  storyTag,
} from './tags.ts';

const ID = '01a1e8e0-a980-7b94-99cf-b43959d7d740';

describe("social's edge tags", () => {
  it('are the names the caching map gives', () => {
    expect(storyTag(ID)).toBe(`social:story:${ID}`);
    expect(deskTag(ID)).toBe(`social:desk:${ID}`);
    expect(postTag(ID)).toBe(`social:post:${ID}`);
    expect(agentTag(ID)).toBe(`social:agent:${ID}`);
    expect(Object.values(familyTags).sort()).toEqual(
      [
        'social:agents',
        'social:assets',
        'social:basics',
        'social:board',
        'social:briefs',
        'social:desks',
        'social:formats',
        'social:lists',
        'social:posts',
        'social:skills',
        'social:stories',
      ].sort(),
    );
  });

  it('have no commas and stay under 256 bytes, every one a tag Vercel takes', () => {
    const tags = [
      ...Object.values(familyTags),
      storyTag(ID),
      deskTag(ID),
      postTag(ID),
      agentTag(ID),
    ];
    for (const tag of tags) {
      expect(tag).not.toContain(',');
      expect(new TextEncoder().encode(tag).length).toBeLessThan(256);
      expect(isValidTag(tag)).toBe(true);
    }
  });

  it('are made from IDs only: anything else is refused, so no comma gets in through an ID', () => {
    for (const make of [storyTag, deskTag, postTag, agentTag]) {
      expect(() => make('a,b')).toThrow(TypeError);
      expect(() => make('delhi_explainer')).toThrow(TypeError);
      expect(() => make('someone@example.com')).toThrow(TypeError);
      expect(() => make(ID.toUpperCase())).toThrow(TypeError);
      expect(() => make('')).toThrow(TypeError);
      expect(() => make(undefined as never)).toThrow(TypeError);
    }
  });

  it('are checked: no commas, spaces, control characters, or 256 bytes or more', () => {
    expect(isValidTag('social:board')).toBe(true);
    expect(isValidTag('')).toBe(false);
    expect(isValidTag('a,b')).toBe(false);
    expect(isValidTag('a b')).toBe(false);
    expect(isValidTag('a\nb')).toBe(false);
    expect(isValidTag('a\u0000b')).toBe(false);
    expect(isValidTag(5)).toBe(false);
    expect(isValidTag('x'.repeat(MAX_TAG_BYTES))).toBe(true);
    expect(isValidTag('x'.repeat(MAX_TAG_BYTES + 1))).toBe(false);
    // A header value is bytes: only printable ASCII, so no non-ASCII character is a tag, however short.
    expect(isValidTag('あ'.repeat(85))).toBe(false);
    expect(isValidTag('social:caf\u00e9')).toBe(false);
    expect(isValidTag('social:\u0000')).toBe(false);
    expect(isValidTag('social:\u007f')).toBe(false);
    expect(isValidTag('a b')).toBe(false);
    expect(isValidTag('!"#$%&\'()*+-./:;<=>?@[\\]^_`{|}~09azAZ')).toBe(true);
  });

  it('come at most 8 to a response, with no repeats', () => {
    const eight = Array.from({ length: MAX_TAGS_PER_RESPONSE }, (_, i) => `social:t${i}`);
    expect(checkedTags(eight)).toEqual(eight);
    expect(() => checkedTags([...eight, 'social:t9'])).toThrow(RangeError);
    expect(checkedTags([familyTags.board, storyTag(ID), familyTags.board])).toEqual([
      familyTags.board,
      storyTag(ID),
    ]);
    // Repeats don't count towards the 8.
    expect(checkedTags([...eight, ...eight])).toEqual(eight);
    expect(() => checkedTags(['social:a,social:b'])).toThrow(TypeError);
  });
});
