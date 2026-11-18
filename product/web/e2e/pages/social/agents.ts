import type { Page } from '../../pages.ts';

/**
 * The pages of the social sandbox's agents area (R6) the checks open, with their speed budgets
 * (docs/social/agents-design.md, V1): each exists everywhere but production, answers 200, and is opened
 * signed out. M6.2's are the claim page (opened at a token nobody holds, so it shows "isn't valid" and
 * still answers 200) and My agent; the signed-in states are the join journey's own. Imports only the
 * `Page` type, as every file here.
 */
export const agentsPages: readonly Page[] = [
  {
    route: '/sandbox/social/claim/[token]',
    name: 'social-claim',
    path: '/sandbox/social/claim/Claim00000000000000000000000000000000000000',
    budget: 'standard',
    absentOn: ['production'],
  },
  {
    route: '/sandbox/social/me',
    name: 'social-my-agent',
    path: '/sandbox/social/me',
    budget: 'standard',
    absentOn: ['production'],
  },
];
