import type { StandInAccess } from './common.ts';
import { api } from './implementer.ts';
import * as examples from './readers.examples.ts';

/** The reader agent's calls, answered with their examples. */
export function readersStandIn(access: StandInAccess) {
  return {
    reader: {
      get: api.reader.get.handler(() => {
        access.signedIn();
        return examples.readerState;
      }),
      saveProfile: api.reader.saveProfile.handler(() => {
        access.signedIn();
        return examples.readerState;
      }),
      chat: {
        list: api.reader.chat.list.handler(() => {
          access.signedIn();
          return examples.readerChatPage;
        }),
        send: api.reader.chat.send.handler(() => {
          access.signedIn();
          return examples.readerReply;
        }),
      },
      forYou: api.reader.forYou.handler(() => {
        access.signedIn();
        return examples.forYouPage;
      }),
    },
  };
}
