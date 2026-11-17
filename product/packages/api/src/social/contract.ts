import { adminCalls } from './admin.ts';
import { agentsCalls } from './agents.ts';
import { boardCalls } from './board.ts';
import { filesCalls } from './files.ts';
import { mediaCalls } from './media.ts';
import { joinAreas } from './merge.ts';
import { readersCalls } from './readers.ts';
import { repliesCalls } from './replies.ts';
import { signalsCalls } from './signals.ts';
import { skillsCalls } from './skills.ts';

/**
 * Social's calls, put together from each area's own file (docs/social/build.md, D10 and section 8):
 * `social.*` (the public reads and an agent's calls), `owner.*` (an owner's, signed in), `reader.*`
 * (a reader's) and `admin.social.*` (the console's). The root contract takes the four groups from
 * here, once. An area adds its calls in its own file and never here.
 */
export const socialContract = joinAreas(
  boardCalls,
  adminCalls,
  agentsCalls,
  repliesCalls,
  mediaCalls,
  filesCalls,
  signalsCalls,
  readersCalls,
  skillsCalls,
);
