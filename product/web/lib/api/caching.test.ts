import type { Caching } from '@hrizzup/api';
import { agentTag, deskTag, postTag, storyTag } from '@hrizzup/social/tags';
import { describe, expect, it } from 'vitest';
import { cacheHeaders, EdgeExpiry, EdgeTags, edgeTags, MAX_TAGS_IN_ALL } from './caching.ts';

/**
 * Quick checks: the headers a call's caching rule gives, and how a read that shows a market as open
 * shortens them so no kept copy outlives the market's closing time (the Product chat, 11 November
 * 2026). The same rule at the API's addresses is in app/api/v1/[[...rest]]/market-data.test.ts.
 */

const rule: Caching = { kind: 'public', edgeSeconds: 60, staleSeconds: 300, tags: ['markets'] };
const NOW = Date.parse('2026-11-11T10:00:00Z');
const later = (seconds: number) => NOW + seconds * 1000;
const edge = (headers: Record<string, string>) => headers['Vercel-CDN-Cache-Control'];

describe("a call's caching headers", () => {
  it("follow the contract's rule when nothing ends the answer", () => {
    expect(cacheHeaders(rule, null, NOW)).toEqual({
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Vercel-CDN-Cache-Control': 'max-age=60, stale-while-revalidate=300',
      'Vercel-Cache-Tag': 'markets',
    });
  });

  it('keep nobody from caching a personal answer, whatever moment is told', () => {
    const personal: Caching = { kind: 'personal' };
    expect(cacheHeaders(personal, later(30), NOW)).toEqual({
      'Cache-Control': 'private, no-store',
    });
  });

  it("follow the rule when the answer ends after the rule's whole life", () => {
    // Fresh 60 and stale 300 end 360 seconds on; the margin's one more second keeps it clear.
    expect(edge(cacheHeaders(rule, later(362), NOW))).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
    expect(edge(cacheHeaders(rule, later(3600), NOW))).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
  });

  it('cut the stale time first, so the copy still ends before the answer does', () => {
    expect(edge(cacheHeaders(rule, later(200), NOW))).toBe(
      'max-age=60, stale-while-revalidate=139',
    );
    expect(edge(cacheHeaders(rule, later(61), NOW))).toBe('max-age=60, stale-while-revalidate=0');
  });

  it('then cut the fresh time, and keep nothing once the margin is all that is left', () => {
    expect(edge(cacheHeaders(rule, later(31), NOW))).toBe('max-age=30, stale-while-revalidate=0');
    expect(edge(cacheHeaders(rule, later(2), NOW))).toBe('max-age=1, stale-while-revalidate=0');
    expect(edge(cacheHeaders(rule, later(1), NOW))).toBe('max-age=0, stale-while-revalidate=0');
    expect(edge(cacheHeaders(rule, later(0), NOW))).toBe('max-age=0, stale-while-revalidate=0');
    expect(edge(cacheHeaders(rule, later(-300), NOW))).toBe('max-age=0, stale-while-revalidate=0');
  });

  it('never keep a copy past the moment, for any rule and any time left', () => {
    const rules: Caching[] = [
      rule,
      { kind: 'public', edgeSeconds: 10, staleSeconds: 60, tags: ['market-activity'] },
      { kind: 'public', edgeSeconds: 5, staleSeconds: 10, tags: ['perps'] },
    ];
    for (const each of rules) {
      for (let left = -5; left <= 400; left += 0.5) {
        const header = edge(cacheHeaders(each, later(left), NOW)) as string;
        const [fresh, stale] = (header.match(/\d+/g) ?? []).map(Number) as [number, number];
        // Served fresh for `fresh` seconds, then stale for `stale` more: never beyond the moment.
        expect(fresh + stale, `${header} with ${left} s left`).toBeLessThanOrEqual(
          Math.max(0, left),
        );
      }
    }
  });
});

describe('the moment an answer ends', () => {
  it('is none until a read tells one, then the soonest it was told', () => {
    const expiry = new EdgeExpiry();
    expect(expiry.at).toBeNull();
    expiry.endsAt(later(600));
    expect(expiry.at).toBe(later(600));
    expiry.endsAt(later(45));
    expiry.endsAt(later(90));
    expect(expiry.at).toBe(later(45));
  });

  it('ignores a moment that is not a time', () => {
    const expiry = new EdgeExpiry();
    expiry.endsAt(Number.NaN);
    expect(expiry.at).toBeNull();
    expiry.endsAt(later(10));
    expiry.endsAt(Number.NaN);
    expect(expiry.at).toBe(later(10));
  });
});

describe('the tags of what an answer shows', () => {
  const STORY = '01a199e9-d180-75ec-8a81-134dd403419a';
  const POST = '01a1e8e0-a980-7b94-99cf-b43959d7d740';
  const AGENT = '01a1e3a0-ab00-7ef9-810c-37c5772f543f';
  const social: Caching = {
    kind: 'public',
    edgeSeconds: 60,
    staleSeconds: 300,
    tags: ['social:stories'],
  };
  const tagHeader = (headers: Record<string, string>) => headers['Vercel-Cache-Tag'];

  it('join the contract’s own, in the order told, and change nothing else in the headers', () => {
    const told = [storyTag(STORY), deskTag(STORY), postTag(POST), agentTag(AGENT)];
    const headers = cacheHeaders(social, null, NOW, told);
    expect(tagHeader(headers)).toBe(
      `social:stories,social:story:${STORY},social:desk:${STORY},social:post:${POST},social:agent:${AGENT}`,
    );
    expect(headers['Vercel-CDN-Cache-Control']).toBe('max-age=60, stale-while-revalidate=300');
    // Told nothing: the contract's tags, as every call in v1 has them.
    expect(tagHeader(cacheHeaders(social, null, NOW))).toBe('social:stories');
    expect(tagHeader(cacheHeaders(rule, null, NOW, []))).toBe('markets');
  });

  it('never repeat: a tag the contract has, or one told twice, is there once', () => {
    const headers = cacheHeaders(social, null, NOW, [
      'social:stories',
      storyTag(STORY),
      storyTag(STORY),
    ]);
    expect(tagHeader(headers)).toBe(`social:stories,social:story:${STORY}`);
    const tags = new EdgeTags();
    tags.add(storyTag(STORY), deskTag(STORY));
    tags.add(storyTag(STORY));
    expect(tags.list).toEqual([`social:story:${STORY}`, `social:desk:${STORY}`]);
  });

  it('are only ever shown by a public read: a personal answer carries none', () => {
    expect(cacheHeaders({ kind: 'personal' }, null, NOW, [storyTag(STORY)])).toEqual({
      'Cache-Control': 'private, no-store',
    });
  });

  it('refuse a comma, which would split a tag in two, a space, other than ASCII, or a tag too long', () => {
    const tags = new EdgeTags();
    for (const bad of [
      'a,b',
      'social:story:x,social:board',
      'two words',
      'tâg',
      '',
      'x'.repeat(256),
    ]) {
      expect(() => tags.add(bad), JSON.stringify(bad)).toThrow(TypeError);
      expect(() => edgeTags(['social:stories'], [bad]), JSON.stringify(bad)).toThrow(TypeError);
      expect(() => cacheHeaders(social, null, NOW, [bad]), JSON.stringify(bad)).toThrow(TypeError);
    }
    // The contract's own are held to it too: a comma in one would split it as well.
    expect(() => cacheHeaders({ ...social, tags: ['a,b'] }, null, NOW)).toThrow(TypeError);
    expect(tags.list).toEqual([]);
  });

  it('are at most 8 of social’s own, the contract’s included, and the others don’t count', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `01a1e8e0-a980-7b94-99cf-b43959d7d7${i}${i}`);
    const posts = ids.map(postTag);
    // The family tag and seven more: eight.
    expect(edgeTags(['social:board'], posts.slice(0, 7))).toHaveLength(8);
    expect(() => edgeTags(['social:board'], posts.slice(0, 8))).toThrow(RangeError);
    expect(() => cacheHeaders(social, null, NOW, posts.slice(0, 8))).toThrow(RangeError);
    // A tag that isn't social's is none of the eight.
    expect(edgeTags(['markets', 'social:board'], posts.slice(0, 7))).toHaveLength(9);
    expect(edgeTags(['social:board'], [])).toEqual(['social:board']);
  });

  it('are at most 128 in all, Vercel’s own limit', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => `family-${i}`);
    expect(MAX_TAGS_IN_ALL).toBe(128);
    expect(edgeTags(many(100), many(128).slice(100))).toHaveLength(128);
    expect(() => edgeTags(many(100), many(129).slice(100))).toThrow(RangeError);
    expect(() => edgeTags(many(129))).toThrow(RangeError);
  });

  it('end with the answer all the same: a tag changes how long a copy lives never', () => {
    const headers = cacheHeaders(social, later(31), NOW, [storyTag(STORY)]);
    expect(edge(headers)).toBe('max-age=30, stale-while-revalidate=0');
    expect(tagHeader(headers)).toBe(`social:stories,social:story:${STORY}`);
  });
});
