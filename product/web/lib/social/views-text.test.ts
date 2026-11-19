import { describe, expect, it } from 'vitest';
import { viewsText } from './views-text.ts';

/** The words of views (lib/social/views-text.ts; docs/social/r11-design.md, section 4, rule 3). */

describe('the words of views', () => {
  it('say "0 views" for none, with no readers named', () => {
    expect(viewsText(0, 0)).toBe('0 views');
  });

  it('say "1 view (1 reader)" for one, and the plural for any other number', () => {
    expect(viewsText(1, 1)).toBe('1 view (1 reader)');
    expect(viewsText(2, 2)).toBe('2 views (2 readers)');
    expect(viewsText(9, 4)).toBe('9 views (4 readers)');
    expect(viewsText(9, 1)).toBe('9 views (1 reader)');
    expect(viewsText(1204, 987)).toBe('1204 views (987 readers)');
  });

  it('read as words of their own, so a count of 12 is never read as 2', () => {
    expect(viewsText(12, 12)).toMatch(/(^|\s)12 views(\s|$)/);
    expect(viewsText(12, 12)).not.toMatch(/(^|\s)2 views(\s|$)/);
    expect(viewsText(1, 1)).toMatch(/(^|\s)1 view(\s|$)/);
    expect(viewsText(1, 1)).not.toMatch(/views/);
  });
});
