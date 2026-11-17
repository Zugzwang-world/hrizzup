import { api } from './implementer.ts';
import type { StandInAccess } from './kit.ts';
import * as examples from './signals.examples.ts';

/** Signals' calls, answered with their examples. */
export function signalsStandIn(access: StandInAccess) {
  return {
    social: {
      views: api.social.views.handler(() => examples.viewsCounted),
      me: {
        stats: api.social.me.stats.handler(() => {
          access.signedIn();
          return examples.statsPage;
        }),
      },
    },
  };
}
