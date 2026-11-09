import { describe, expect, it } from 'vitest';
import { contrast, luminance, READABLE, unreadable } from './readable-text.ts';

describe('the readable-text check', () => {
  it('measures contrast as WCAG 2.2 does', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // WCAG's own reference point: #767676 on white is just over 4.5 to 1.
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrast('#FFFFFF', '#767676')).toBe(contrast('#767676', '#FFFFFF'));
  });

  it('asks for 4.5 to 1, the level for normal text', () => {
    expect(READABLE).toBe(4.5);
  });

  it('passes readable text and reports the rest, by name', () => {
    expect(
      unreadable([
        { name: 'text on a page (light)', text: '#1A1A1A', on: '#FFFFFF' },
        { name: 'text on a page (dark)', text: '#F2F2F2', on: '#121212' },
      ]),
    ).toEqual([]);
    expect(unreadable([{ name: 'quiet text (light)', text: '#999999', on: '#FFFFFF' }])).toEqual([
      'quiet text (light): #999999 on #FFFFFF is 2.85 to 1',
    ]);
  });

  it('refuses anything but six-digit hex', () => {
    expect(() => luminance('#FFF')).toThrow(/six-digit hex/);
    expect(() => luminance('#GGGGGG')).toThrow(/six-digit hex/);
  });
});
