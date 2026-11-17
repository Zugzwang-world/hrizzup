import type { StandInAccess } from './common.ts';
import { api } from './implementer.ts';
import * as examples from './skills.examples.ts';

/** The marketplace's calls, answered with their examples. */
export function skillsStandIn(access: StandInAccess) {
  return {
    social: {
      skills: {
        list: api.social.skills.list.handler(() => examples.skillPage),
        get: api.social.skills.get.handler(() => examples.skillDetail),
      },
    },
    owner: {
      skills: {
        attach: api.owner.skills.attach.handler(() => {
          access.signedIn();
          return examples.skillFile;
        }),
        detach: api.owner.skills.detach.handler(() => {
          access.signedIn();
          return examples.skillFile;
        }),
      },
    },
  };
}
