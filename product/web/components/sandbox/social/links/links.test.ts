import { describe, expect, it } from 'vitest';
import { socialPages } from '../../../../e2e/pages/social/index.ts';
import { type Page, pages } from '../../../../e2e/pages.ts';
import { socialLinks } from './index.ts';
import { isOn, type SocialLink } from './link.ts';

/**
 * The social sandbox's menu (docs/social/build.md, section 8): each area's own links, joined once.
 * (The sandbox's components are .tsx, which Vitest here doesn't render: the Screen check opens the
 * pages that use them once R5 and R6 build the pages.)
 */

/** Whether a page of the checks is at the address a link goes to: a page's `[part]` is any one part of an address. */
function hasPage(link: SocialLink, among: readonly Page[]): boolean {
  return among.some((page) => {
    if (page.path === link.href || page.route === link.href) return true;
    const dynamic = new RegExp(`^${page.route.replace(/\[[^\]/]+\]/g, '[^/]+')}$`);
    return dynamic.test(link.href);
  });
}

describe('the menu', () => {
  it('holds only links under /sandbox/social, each to a page the checks open, whichever areas have added theirs', () => {
    // No area is named here, so R5 and R6 adding their links side by side edit none of this.
    for (const link of socialLinks) {
      expect(link.href.startsWith('/sandbox/social'), link.href).toBe(true);
      expect(link.text.length, link.href).toBeGreaterThan(0);
      expect(hasPage(link, socialPages), `${link.href} has an entry in e2e/pages/social/`).toBe(
        true,
      );
      expect(hasPage(link, pages), `${link.href} is in the list every check reads`).toBe(true);
    }
    expect(new Set(socialLinks.map((link) => link.href)).size).toBe(socialLinks.length);
  });

  it('finds the page a link goes to, by its address or by its route with parts', () => {
    const page = (route: string, path: string): Page => ({
      route,
      name: route,
      path,
      budget: 'standard',
    });
    const among = [
      page('/sandbox/social', '/sandbox/social'),
      page(
        '/sandbox/social/stories/[id]',
        '/sandbox/social/stories/019a6c00-0000-7000-8000-000000000009',
      ),
    ];
    expect(hasPage({ href: '/sandbox/social', text: 'Board' }, among)).toBe(true);
    expect(hasPage({ href: '/sandbox/social/stories/abc', text: 'A story' }, among)).toBe(true);
    expect(hasPage({ href: '/sandbox/social/agents', text: 'Agents' }, among)).toBe(false);
    expect(hasPage({ href: '/sandbox/social/stories', text: 'Stories' }, among)).toBe(false);
  });

  it('marks a link for its own address, or for everything under it when it says so', () => {
    const board = { href: '/sandbox/social', text: 'Board' };
    expect(isOn(board, '/sandbox/social')).toBe(true);
    expect(isOn(board, '/sandbox/social/agents')).toBe(false);
    const agents = { href: '/sandbox/social/agents', text: 'Agents', prefix: true };
    expect(isOn(agents, '/sandbox/social/agents')).toBe(true);
    expect(isOn(agents, '/sandbox/social/agents/delhi_explainer')).toBe(true);
    expect(isOn(agents, '/sandbox/social/agents-other')).toBe(false);
  });
});
