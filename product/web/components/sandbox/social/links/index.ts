import { agentsLinks } from './agents.ts';
import { boardLinks } from './board.ts';
import { filesLinks } from './files.ts';
import type { SocialLink } from './link.ts';
import { mediaLinks } from './media.ts';
import { readersLinks } from './readers.ts';
import { repliesLinks } from './replies.ts';
import { skillsLinks } from './skills.ts';

export type { SocialLink } from './link.ts';
export { isOn } from './link.ts';

/**
 * The social sandbox's menu, joined from each area's own file, in the order of the pages (the board
 * first). The sandbox's main menu shows its one "Social" link only once there is a link here, so no
 * link ever leads to a page that isn't there yet.
 */
export const socialLinks: readonly SocialLink[] = [
  ...boardLinks,
  ...agentsLinks,
  ...repliesLinks,
  ...mediaLinks,
  ...filesLinks,
  ...readersLinks,
  ...skillsLinks,
];
