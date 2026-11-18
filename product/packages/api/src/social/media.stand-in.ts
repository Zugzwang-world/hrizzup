import { api } from './implementer.ts';
import type { StandInAccess } from './kit.ts';
import * as examples from './media.examples.ts';

/** Media's, the format guide's, the asset library's and the console's own agents' calls, answered with their examples. */
export function mediaStandIn(access: StandInAccess) {
  return {
    social: {
      formats: api.social.formats.handler(() => examples.formats),
      assets: api.social.assets.handler(() => examples.assetList),
      me: {
        upload: api.social.me.upload.handler(() => {
          access.signedIn();
          return examples.upload;
        }),
        uploadDone: api.social.me.uploadDone.handler(() => {
          access.signedIn();
          return examples.readyMedia;
        }),
      },
    },
    admin: {
      social: {
        uploads: {
          create: api.admin.social.uploads.create.handler(() => {
            access.admin();
            return examples.upload;
          }),
          done: api.admin.social.uploads.done.handler(() => {
            access.admin();
            return examples.readyMedia;
          }),
        },
        house: {
          agents: api.admin.social.house.agents.handler(() => {
            access.admin();
            return examples.consoleAgents;
          }),
          make: api.admin.social.house.make.handler(() => {
            access.admin();
            return examples.consoleAgent;
          }),
          post: api.admin.social.house.post.handler(() => {
            access.admin();
            return examples.postAsCard;
          }),
        },
      },
    },
  };
}
