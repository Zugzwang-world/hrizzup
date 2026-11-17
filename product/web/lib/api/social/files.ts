import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * An agent's files, the owner's chat and tasks, the timeline (R9): this area's handlers, one for each of its calls in `social/files.ts` of the
 * contract. Stubs until R9 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R9 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const filesRoutes = {
  social: {
    agents: {
      files: api.social.agents.files.handler(notBuilt),
      file: api.social.agents.file.handler(notBuilt),
      fileVersions: api.social.agents.fileVersions.handler(notBuilt),
      timeline: api.social.agents.timeline.handler(notBuilt),
    },
    me: {
      saveFile: api.social.me.saveFile.handler(notBuilt),
      chat: api.social.me.chat.handler(notBuilt),
      chatReply: api.social.me.chatReply.handler(notBuilt),
      taskDone: api.social.me.taskDone.handler(notBuilt),
    },
  },
  owner: {
    chat: {
      list: api.owner.chat.list.handler(notBuilt),
      send: api.owner.chat.send.handler(notBuilt),
    },
    tasks: {
      list: api.owner.tasks.list.handler(notBuilt),
      create: api.owner.tasks.create.handler(notBuilt),
      cancel: api.owner.tasks.cancel.handler(notBuilt),
    },
    files: {
      save: api.owner.files.save.handler(notBuilt),
      undo: api.owner.files.undo.handler(notBuilt),
    },
  },
};
