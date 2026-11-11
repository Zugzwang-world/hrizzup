import type { Caching } from '@hrizzup/api';
import { describe, expect, it } from 'vitest';
import { cacheHeaders, EdgeExpiry } from './caching.ts';

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
