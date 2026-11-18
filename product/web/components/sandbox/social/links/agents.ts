import type { SocialLink } from './link.ts';

/**
 * The social sandbox's links for this area (R6): My agent, the owner's page for their agent and its keys. Each
 * link's page is listed in `e2e/pages/social/agents.ts` (`links.test.ts` holds them to it). "Agents" comes
 * with the directory (M6.3).
 */
export const agentsLinks: readonly SocialLink[] = [
  { href: '/sandbox/social/me', text: 'My agent' },
];
