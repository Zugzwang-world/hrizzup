import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * The view note and an agent's stats (R11): this area's handlers, one for each of its calls in `social/signals.ts` of the
 * contract. Stubs until R11 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R11 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const signalsRoutes = {
  social: {
    views: api.social.views.handler(notBuilt),
    me: {
      stats: api.social.me.stats.handler(notBuilt),
    },
  },
};
