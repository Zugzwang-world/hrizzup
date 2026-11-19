import { describe, expect, it } from 'vitest';
import { type RankSettings, topOrderOf, topRankOf } from './top-rank.ts';

/**
 * The Top order a journey expects (e2e/support/top-rank.ts): the rank is the database's own `social._rank`, the order
 * the desk's (rank, then ID, both largest first). The pinned ranks are what `social._rank` answered on this Mac's
 * database for the same inputs (`select social._rank(<signal>, <time>, <half-life>)`), so the formula can't drift
 * from the SQL's without this test failing.
 */

const settings = (changes: Partial<RankSettings> = {}): RankSettings => ({
  topWReplies: 1,
  topWViews: 0.01,
  topWUpvotes: 0.5,
  deskHalfLifeHours: 6,
  ...changes,
});
const none = { replies: 0, views: 0, upvotes: 0 };

describe('a post’s top_rank', () => {
  it('is `social._rank` of its signal, its time and the desk’s half-life', () => {
    expect(
      topRankOf(settings(), { ...none, createdAt: '2026-11-19T08:10:00.123Z', views: 2 }),
    ).toBe(57604266550);
    expect(
      topRankOf(settings(), {
        ...none,
        createdAt: '2026-11-19T08:10:05.000Z',
        views: 2,
        upvotes: 1,
      }),
    ).toBe(57604665614);
    expect(topRankOf(settings(), { ...none, createdAt: '2026-11-19T08:10:05.000Z' })).toBe(
      57604246904,
    );
    expect(
      topRankOf(settings({ topWViews: 0.0000007, deskHalfLifeHours: 12 }), {
        ...none,
        createdAt: '2026-11-19T08:10:05.000Z',
        views: 1,
      }),
    ).toBe(28802123453);
    expect(
      topRankOf(settings(), {
        createdAt: '2026-01-01T00:00:00Z',
        replies: 1,
        views: 100,
        upvotes: 4,
      }),
    ).toBe(56712139163);
  });

  it('reads settings given as text, as numbers', () => {
    const text = settings({ topWViews: '0.01', topWUpvotes: '0.5', deskHalfLifeHours: '6' });
    const post = { ...none, createdAt: '2026-11-19T08:10:05.000Z', views: 2, upvotes: 1 };
    expect(topRankOf(text, post)).toBe(topRankOf(settings(), post));
  });
});

describe('a desk’s Top order', () => {
  const older = {
    id: '01a1e7fc-0000-7a1b-9c2d-000000000001',
    createdAt: '2026-11-19T08:10:00.000Z',
  };
  const newer = {
    id: '01a1e7fc-0000-7a1b-9c2d-000000000002',
    createdAt: '2026-11-19T08:10:04.000Z',
  };

  it('puts the post with more views first when views are worth a real weight', () => {
    expect(
      topOrderOf(settings(), [
        { ...newer, ...none, views: 1 },
        { ...older, ...none, views: 2 },
      ]),
    ).toEqual([older.id, newer.id]);
  });

  it('puts the newer post first when views are worth nothing', () => {
    expect(
      topOrderOf(settings({ topWViews: 0 }), [
        { ...older, ...none, views: 2 },
        { ...newer, ...none, views: 1 },
      ]),
    ).toEqual([newer.id, older.id]);
  });

  it('puts the newer post first when a view is worth less than the seconds between the two', () => {
    // Four seconds on a 6-hour half-life are worth about 128 units of rank; one more view at this weight, one.
    expect(
      topOrderOf(settings({ topWViews: 0.0000007 }), [
        { ...older, ...none, views: 2 },
        { ...newer, ...none, views: 1 },
      ]),
    ).toEqual([newer.id, older.id]);
  });

  it('counts a reply, an upvote and a view each with its own weight', () => {
    const a = { ...older, ...none, replies: 1 };
    const b = { ...newer, ...none, upvotes: 3 };
    expect(topOrderOf(settings(), [b, a])).toEqual([b.id, a.id]);
    expect(topOrderOf(settings({ topWUpvotes: 0.1 }), [b, a])).toEqual([a.id, b.id]);
  });

  it('breaks a tie of rank by the larger ID, as the desk’s index does', () => {
    const same = '2026-11-19T08:10:00.000Z';
    const low = { id: '01a1e7fc-0000-7a1b-9c2d-00000000000a', createdAt: same, ...none };
    const high = { id: '01a1e7fc-0000-7a1b-9c2d-00000000000b', createdAt: same, ...none };
    expect(topRankOf(settings(), low)).toBe(topRankOf(settings(), high));
    expect(topOrderOf(settings(), [low, high])).toEqual([high.id, low.id]);
    expect(topOrderOf(settings(), [high, low])).toEqual([high.id, low.id]);
  });
});
