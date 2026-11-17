import { ORPCError } from '@orpc/server';
import { adminStandIn } from './admin.stand-in.ts';
import { agentsStandIn } from './agents.stand-in.ts';
import { boardStandIn } from './board.stand-in.ts';
import { filesStandIn } from './files.stand-in.ts';
import type { StandInAccess } from './kit.ts';
import { mediaStandIn } from './media.stand-in.ts';
import { joinAreas } from './merge.ts';
import { readersStandIn } from './readers.stand-in.ts';
import { repliesStandIn } from './replies.stand-in.ts';
import { signalsStandIn } from './signals.stand-in.ts';
import { skillsStandIn } from './skills.stand-in.ts';

/**
 * Social's stand-in, joined from each area's own (D10): every call answers with its example, an
 * agent's or a signed-in person's call answers "not signed in" when nobody is (`signedIn: false`),
 * and the console's answer anyone but an admin "No such call" (`admin: false`), as the real ones will.
 */
export function socialStandIn(options: { signedIn: boolean; admin: boolean }) {
  const access: StandInAccess = {
    signedIn: () => {
      if (!options.signedIn) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
    },
    admin: () => {
      if (!options.admin) throw new ORPCError('NOT_FOUND', { message: 'No such call' });
    },
  };
  return joinAreas(
    boardStandIn(access),
    adminStandIn(access),
    agentsStandIn(access),
    repliesStandIn(access),
    mediaStandIn(access),
    filesStandIn(access),
    signalsStandIn(access),
    readersStandIn(access),
    skillsStandIn(access),
  );
}
