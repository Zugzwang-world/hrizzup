import type { Page } from '../../pages.ts';

/**
 * The pages of the social sandbox's readers area (R12) the checks open, with their speed budgets (docs/social/
 * r12-design.md, section 4.4): the reader agent's page and For You. Each exists everywhere but production, answers
 * 200 and is opened signed out, so each shows its line and link to sign in; the signed-in states (the chat, the
 * profile, a For You with stories) are `journeys/social-reader.spec.ts`'s own. Imports only the `Page` type, as every
 * file here.
 */
export const readersPages: readonly Page[] = [
  {
    route: '/sandbox/social/reader',
    name: 'social-reader',
    path: '/sandbox/social/reader',
    budget: 'standard',
    absentOn: ['production'],
  },
  {
    route: '/sandbox/social/reader/for-you',
    name: 'social-for-you',
    path: '/sandbox/social/reader/for-you',
    budget: 'standard',
    absentOn: ['production'],
  },
];
