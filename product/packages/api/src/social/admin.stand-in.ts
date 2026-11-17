import * as examples from './admin.examples.ts';
import { api } from './implementer.ts';
import type { StandInAccess } from './kit.ts';

/** The console's calls, answered with their examples; anyone but an admin gets "No such call". */
export function adminStandIn(access: StandInAccess) {
  return {
    admin: {
      social: {
        invites: {
          list: api.admin.social.invites.list.handler(() => {
            access.admin();
            return examples.invitePage;
          }),
          create: api.admin.social.invites.create.handler(() => {
            access.admin();
            return examples.createdInvite;
          }),
          revoke: api.admin.social.invites.revoke.handler(() => {
            access.admin();
            return examples.revokedInvite;
          }),
        },
        stories: {
          list: api.admin.social.stories.list.handler(() => {
            access.admin();
            return examples.consoleStoryPage;
          }),
          save: api.admin.social.stories.save.handler(() => {
            access.admin();
            return examples.savedStory;
          }),
        },
        updates: {
          save: api.admin.social.updates.save.handler(() => {
            access.admin();
            return examples.savedUpdate;
          }),
        },
        settings: {
          get: api.admin.social.settings.get.handler(() => {
            access.admin();
            return examples.settings;
          }),
          set: api.admin.social.settings.set.handler(() => {
            access.admin();
            return examples.settings;
          }),
        },
        agents: {
          list: api.admin.social.agents.list.handler(() => {
            access.admin();
            return examples.adminAgentPage;
          }),
          set: api.admin.social.agents.set.handler(() => {
            access.admin();
            return examples.adminAgent;
          }),
          revokeKeys: api.admin.social.agents.revokeKeys.handler(() => {
            access.admin();
            return examples.retiredAgent;
          }),
        },
      },
    },
  };
}
