import { describe, expect, it } from 'vitest';
import { classify, READER_WORDS } from './failures.ts';

describe('the failures table (docs/social/r12-design.md, 3.6), row by row', () => {
  it('3036, the daily free allocation: exhausted, 429 allowance_used', () => {
    expect(classify({ status: 429, code: 3036 })).toMatchObject({
      kind: 'exhausted',
      reason: 'allowance_used',
      status: 429,
      code: 3036,
    });
    // By its code, whatever the status.
    expect(classify({ status: 200, code: 3036 })).toMatchObject({ kind: 'exhausted' });
  });

  it('3040 capacity, or a 429 with no known code: released, 503 busy', () => {
    expect(classify({ status: 429, code: 3040 })).toMatchObject({
      kind: 'released',
      reason: 'busy',
    });
    expect(classify({ status: 429 })).toMatchObject({ kind: 'released', reason: 'busy' });
    expect(classify({ status: 429, code: 9999 })).toMatchObject({
      kind: 'released',
      reason: 'busy',
    });
  });

  it('5016 model terms, 401, 403, any other 4xx but 408, a model or provider refused: released, 503 unavailable', () => {
    expect(classify({ status: 403, code: 5016 })).toMatchObject({
      kind: 'released',
      reason: 'unavailable',
      note: 'Llama 3.2 terms not agreed',
    });
    for (const status of [400, 401, 403, 404, 413, 422, 499]) {
      expect(classify({ status }), `${status}`).toMatchObject({
        kind: 'released',
        reason: 'unavailable',
      });
    }
    expect(classify({ refused: true })).toMatchObject({ kind: 'released', reason: 'unavailable' });
  });

  it('408 (3007, 3008) and our own 20-second abort: kept, 503 too_slow', () => {
    expect(classify({ status: 408 })).toMatchObject({ kind: 'kept', reason: 'too_slow' });
    expect(classify({ status: 408, code: 3007 })).toMatchObject({
      kind: 'kept',
      reason: 'too_slow',
    });
    expect(classify({ status: 408, code: 3008 })).toMatchObject({
      kind: 'kept',
      reason: 'too_slow',
    });
    expect(classify({ aborted: true })).toMatchObject({ kind: 'kept', reason: 'too_slow' });
  });

  it('a 5xx, a network error, an envelope that can not be read: kept, 503 unavailable', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(classify({ status }), `${status}`).toMatchObject({
        kind: 'kept',
        reason: 'unavailable',
      });
    }
    expect(classify({ network: true })).toMatchObject({ kind: 'kept', reason: 'unavailable' });
    expect(classify({ status: 200, unreadable: true })).toMatchObject({
      kind: 'kept',
      reason: 'unavailable',
    });
    // Nothing seen at all is the same: the model may have run.
    expect(classify({})).toMatchObject({ kind: 'kept', reason: 'unavailable' });
  });

  it('says what the reader is told and how long to wait for each reason', () => {
    expect(READER_WORDS.busy).toEqual({
      message: 'Your reader agent is busy right now: try again in a minute',
      retryAfterSeconds: 30,
    });
    expect(READER_WORDS.unavailable).toEqual({
      message: "Your reader agent isn't available right now: try again later",
      retryAfterSeconds: 60,
    });
    expect(READER_WORDS.too_slow).toEqual({
      message: 'Your reader agent took too long to answer: send your message again',
      retryAfterSeconds: 5,
    });
    expect(READER_WORDS.allowance_used.message).toBe(
      "The reader agent has used today's allowance: chat pauses until 05:30 IST, and your feed keeps working",
    );
    // The 429's wait is the database's own.
    expect(READER_WORDS.allowance_used.retryAfterSeconds).toBeNull();
  });
});
