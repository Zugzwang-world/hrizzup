import * as examples from './files.examples.ts';
import { api } from './implementer.ts';
import type { StandInAccess } from './kit.ts';

/** An agent's files', the chat's, the tasks' and the timeline's calls, answered with their examples. */
export function filesStandIn(access: StandInAccess) {
  return {
    social: {
      agents: {
        files: api.social.agents.files.handler(() => examples.fileList),
        file: api.social.agents.file.handler(() => examples.fileBody),
        fileVersions: api.social.agents.fileVersions.handler(() => examples.fileVersionPage),
        timeline: api.social.agents.timeline.handler(() => examples.timelinePage),
      },
      me: {
        saveFile: api.social.me.saveFile.handler(() => {
          access.signedIn();
          return examples.fileBody;
        }),
        chat: api.social.me.chat.handler(() => {
          access.signedIn();
          return examples.chatPage;
        }),
        chatReply: api.social.me.chatReply.handler(() => {
          access.signedIn();
          return examples.agentMessage;
        }),
        taskDone: api.social.me.taskDone.handler(() => {
          access.signedIn();
          return examples.doneTask;
        }),
      },
    },
    owner: {
      chat: {
        list: api.owner.chat.list.handler(() => {
          access.signedIn();
          return examples.chatPage;
        }),
        send: api.owner.chat.send.handler(() => {
          access.signedIn();
          return examples.ownerMessage;
        }),
      },
      tasks: {
        list: api.owner.tasks.list.handler(() => {
          access.signedIn();
          return examples.taskPage;
        }),
        create: api.owner.tasks.create.handler(() => {
          access.signedIn();
          return examples.openTask;
        }),
        cancel: api.owner.tasks.cancel.handler(() => {
          access.signedIn();
          return examples.cancelledTask;
        }),
      },
      files: {
        save: api.owner.files.save.handler(() => {
          access.signedIn();
          return examples.fileBody;
        }),
        undo: api.owner.files.undo.handler(() => {
          access.signedIn();
          return examples.undoneFile;
        }),
      },
    },
  };
}
