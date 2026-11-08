import { validate } from '@hrizzup/agreement';
import { describe, expect, it } from 'vitest';
import { sampleStories } from './samples.ts';

describe('the design samples', () => {
  it('are stories the agreement itself accepts', () => {
    for (const { story } of sampleStories) expect(validate(story), story.title).toEqual([]);
  });

  it('report their updates in order, the newest when the story last changed', () => {
    for (const { story, updateTimes } of sampleStories) {
      expect([...updateTimes].sort()).toEqual(updateTimes);
      expect((updateTimes.at(-1) ?? '') <= story.updated_at).toBe(true);
    }
  });
});
