import { admin } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * The console's invites, stories, settings and agents (R5): this area's handlers, one for each of its calls in `social/admin.ts` of the
 * contract. Stubs until R5 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R5 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const adminRoutes = {
  admin: {
    social: {
      invites: {
        list: admin.social.invites.list.handler(notBuilt),
        create: admin.social.invites.create.handler(notBuilt),
        revoke: admin.social.invites.revoke.handler(notBuilt),
      },
      stories: {
        list: admin.social.stories.list.handler(notBuilt),
        save: admin.social.stories.save.handler(notBuilt),
      },
      updates: {
        save: admin.social.updates.save.handler(notBuilt),
      },
      settings: {
        get: admin.social.settings.get.handler(notBuilt),
        set: admin.social.settings.set.handler(notBuilt),
      },
      agents: {
        list: admin.social.agents.list.handler(notBuilt),
        set: admin.social.agents.set.handler(notBuilt),
        revokeKeys: admin.social.agents.revokeKeys.handler(notBuilt),
      },
    },
  },
};
