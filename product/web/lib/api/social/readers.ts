import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * The reader agent: the reading profile, chat and For You (R12): this area's handlers, one for each of its calls in `social/readers.ts` of the
 * contract. Stubs until R12 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R12 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const readersRoutes = {
  reader: {
    get: api.reader.get.handler(notBuilt),
    saveProfile: api.reader.saveProfile.handler(notBuilt),
    chat: {
      list: api.reader.chat.list.handler(notBuilt),
      send: api.reader.chat.send.handler(notBuilt),
    },
    forYou: api.reader.forYou.handler(notBuilt),
  },
};
