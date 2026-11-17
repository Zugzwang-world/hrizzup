import type { Page } from '../../pages.ts';
import { agentsPages } from './agents.ts';
import { boardPages } from './board.ts';
import { filesPages } from './files.ts';
import { mediaPages } from './media.ts';
import { readersPages } from './readers.ts';
import { repliesPages } from './replies.ts';
import { signalsPages } from './signals.ts';
import { skillsPages } from './skills.ts';

/**
 * The social sandbox's pages for the checks (docs/social/build.md, sections 8.2 and 8.3), joined from
 * each area's own file, so a relay that builds a page adds its entry in its own file and none edits
 * this one. `e2e/pages.ts` takes the list once. An area's file imports only the `Page` type from
 * `../../pages.ts`, never a value, so the two never load each other.
 */
export const socialPages: readonly Page[] = [
  ...boardPages,
  ...agentsPages,
  ...repliesPages,
  ...mediaPages,
  ...filesPages,
  ...signalsPages,
  ...readersPages,
  ...skillsPages,
];
