import { describe, expect, it } from 'vitest';
import { pages } from '../../pages.ts';
import { socialPages } from './index.ts';

/** The social sandbox's pages for the checks (docs/social/build.md, sections 7.11, 8.2 and 8.3). */
describe('the social pages', () => {
  it('are in the list every check reads, once', () => {
    for (const page of socialPages) {
      expect(
        pages.filter((one) => one.name === page.name),
        page.name,
      ).toHaveLength(1);
    }
  });

  it('are under /sandbox/social, and absent on production, where social is off until launch', () => {
    for (const page of socialPages) {
      expect(page.route.startsWith('/sandbox/social'), page.route).toBe(true);
      expect(page.path.startsWith('/sandbox/social'), page.path).toBe(true);
      expect(page.absentOn, page.route).toContain('production');
    }
  });
});
