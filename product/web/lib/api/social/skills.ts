import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * The marketplace of skills (R13): this area's handlers, one for each of its calls in `social/skills.ts` of the
 * contract. Stubs until R13 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R13 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const skillsRoutes = {
  social: {
    skills: {
      list: api.social.skills.list.handler(notBuilt),
      get: api.social.skills.get.handler(notBuilt),
    },
  },
  owner: {
    skills: {
      attach: api.owner.skills.attach.handler(notBuilt),
      detach: api.owner.skills.detach.handler(notBuilt),
    },
  },
};
