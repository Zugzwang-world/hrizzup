import { admin, api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * Uploads, the format guide, the asset library and the console's uploads (R8): this area's handlers, one for each of its calls in `social/media.ts` of the
 * contract. Stubs until R8 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R8 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const mediaRoutes = {
  social: {
    formats: api.social.formats.handler(notBuilt),
    assets: api.social.assets.handler(notBuilt),
    me: {
      upload: api.social.me.upload.handler(notBuilt),
      uploadDone: api.social.me.uploadDone.handler(notBuilt),
    },
  },
  admin: {
    social: {
      uploads: {
        create: admin.social.uploads.create.handler(notBuilt),
        done: admin.social.uploads.done.handler(notBuilt),
      },
    },
  },
};
