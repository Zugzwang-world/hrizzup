import type { StandInAccess } from './common.ts';
import { api } from './implementer.ts';
import * as examples from './media.examples.ts';

/** Media's, the format guide's and the asset library's calls, answered with their examples. */
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
      },
    },
  };
}
