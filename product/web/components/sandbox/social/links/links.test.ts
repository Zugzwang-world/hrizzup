import { describe, expect, it } from 'vitest';
import { socialLinks } from './index.ts';
import { isOn } from './link.ts';

/**
 * The social sandbox's menu (docs/social/build.md, section 8): each area's own links, joined once.
 * (The sandbox's components are .tsx, which Vitest here doesn't render: the Screen check opens the
 * pages that use them once R5 and R6 build the pages.)
 */

describe('the menu', () => {
  it('has no link while no area has built a page, so the sandbox’s main menu has no link to one that is not there', () => {
    expect(socialLinks).toEqual([]);
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
