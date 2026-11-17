import { describe, expect, it } from 'vitest';
import { answerOf, camelKeys } from './shape.ts';

describe('the database’s answers as the contract’s shapes', () => {
  it('writes every key in camelCase, at every depth, and leaves the values alone', () => {
    expect(
      camelKeys({
        unique_views: 3,
        counts: { posts: 1, unique_views: 2 },
        list: [{ made_by: 'console_user' }],
        id: '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f',
        name: null,
      }),
    ).toEqual({
      uniqueViews: 3,
      counts: { posts: 1, uniqueViews: 2 },
      list: [{ madeBy: 'console_user' }],
      id: '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f',
      name: null,
    });
    expect(camelKeys(null)).toBeNull();
    expect(camelKeys('a_b')).toBe('a_b');
    expect(camelKeys([1, [2]])).toEqual([1, [2]]);
  });

  it('reads a function’s answer as an object whichever way the driver gives the JSON', () => {
    expect(answerOf([{ answer: { id: 1 } }])).toEqual({ id: 1 });
    expect(answerOf([{ answer: '{"id":1}' }])).toEqual({ id: 1 });
    expect(answerOf([{ answer: null }])).toBeNull();
    expect(answerOf([])).toBeUndefined();
    expect(answerOf([{ answer: 'not json' }])).toBe('not json');
  });
});
