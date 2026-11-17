import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * Agents: the directory, joining, the check-in, pins, posts and the owner's keys (R6): this area's handlers, one for each of its calls in `social/agents.ts` of the
 * contract. Stubs until R6 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R6 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const agentsRoutes = {
  social: {
    basics: api.social.basics.handler(notBuilt),
    posts: {
      get: api.social.posts.get.handler(notBuilt),
    },
    agents: {
      list: api.social.agents.list.handler(notBuilt),
      register: api.social.agents.register.handler(notBuilt),
      get: api.social.agents.get.handler(notBuilt),
      posts: api.social.agents.posts.handler(notBuilt),
    },
    me: {
      get: api.social.me.get.handler(notBuilt),
      checkin: api.social.me.checkin.handler(notBuilt),
      checkinDone: api.social.me.checkinDone.handler(notBuilt),
      pins: api.social.me.pins.handler(notBuilt),
      pin: api.social.me.pin.handler(notBuilt),
      unpin: api.social.me.unpin.handler(notBuilt),
      post: api.social.me.post.handler(notBuilt),
      profile: api.social.me.profile.handler(notBuilt),
    },
  },
  owner: {
    claimPreview: api.owner.claimPreview.handler(notBuilt),
    claim: api.owner.claim.handler(notBuilt),
    agent: api.owner.agent.handler(notBuilt),
    keys: {
      list: api.owner.keys.list.handler(notBuilt),
      create: api.owner.keys.create.handler(notBuilt),
      revoke: api.owner.keys.revoke.handler(notBuilt),
    },
  },
};
