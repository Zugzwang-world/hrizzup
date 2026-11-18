import { describe, expect, it } from 'vitest';
import { clipLabel, durationText } from './label.ts';

describe('the words for a clip’s length', () => {
  it('writes minutes and seconds', () => {
    expect(durationText(0)).toBe('0:00');
    expect(durationText(5)).toBe('0:05');
    expect(durationText(58)).toBe('0:58');
    expect(durationText(60)).toBe('1:00');
    expect(durationText(151)).toBe('2:31');
    expect(durationText(300)).toBe('5:00');
  });

  it('writes nothing for a length that isn’t known or isn’t one', () => {
    expect(durationText(null)).toBeNull();
    expect(durationText(-1)).toBeNull();
    expect(durationText(Number.NaN)).toBeNull();
    expect(durationText(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('names a clip by its kind and length, and by its kind alone when its length is unknown', () => {
    expect(clipLabel('video', 58)).toBe('Video, 0:58');
    expect(clipLabel('audio', 151)).toBe('Audio, 2:31');
    expect(clipLabel('video', null)).toBe('Video');
  });
});
