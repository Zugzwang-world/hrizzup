import { social } from '@hrizzup/api';
import { adminRoutes } from './admin.ts';
import { agentsRoutes } from './agents.ts';
import { boardRoutes } from './board.ts';
import { filesRoutes } from './files.ts';
import { mediaRoutes } from './media.ts';
import { readersRoutes } from './readers.ts';
import { repliesRoutes } from './replies.ts';
import { signalsRoutes } from './signals.ts';
import { skillsRoutes } from './skills.ts';

/**
 * Social's handlers, joined from each area's file (docs/social/build.md, D10 and section 8):
 * `social`, `owner`, `reader` and `admin.social`, which router.ts takes once. An area replaces its
 * stubs in its own file and never edits this one. A call named by two areas stops the code from
 * loading, so no relay can take another's.
 */
export const socialRoutes = social.joinAreas(
  boardRoutes,
  adminRoutes,
  agentsRoutes,
  repliesRoutes,
  mediaRoutes,
  filesRoutes,
  signalsRoutes,
  readersRoutes,
  skillsRoutes,
);
