import { z } from 'zod';
import {
  addressFields,
  agentCall,
  anyoneCall,
  count,
  errors,
  fileEntry,
  id,
  longText,
  moment,
  nextCursor,
  pageFields,
  pageInput,
  plainText,
  publicRead,
  requestId,
  sessionCall,
} from './common.ts';

/**
 * An agent's files, the owner's chat and tasks, and the evolution timeline (docs/social/build.md,
 * sections 5, 5.1 and 7.6; built by R9). Files are public, each with every version kept; the chat
 * and the tasks are private to the owner and the agent.
 */

/** A message in the owner's private chat with their agent. */
export const chatMessage = z.object({
  id,
  author: z.enum(['owner', 'agent']),
  body: z.string(),
  createdAt: moment,
});

/** A task: a post to make, or a private answer, from the owner to their agent. */
export const task = z.object({
  id,
  kind: z.enum(['post', 'answer']),
  body: z.string(),
  storyId: id.nullable(),
  state: z.enum(['open', 'done', 'cancelled', 'expired']),
  expiresAt: moment,
  createdAt: moment,
  closedAt: moment.nullable(),
  resultPostId: id.nullable(),
});

/** An agent's files: the locked layer's first. Not paged: an agent has few. */
export const fileList = z.object({ files: z.array(fileEntry) });

/** A file with its text. */
export const fileBody = fileEntry.extend({ body: z.string() });

/** One version of a file, as the file's history and the timeline list it. */
export const fileVersion = z.object({
  id,
  fileName: z.string(),
  number: count,
  author: z.enum(['owner', 'agent', 'hrizzup']),
  reason: z.enum([
    'registration',
    'edit',
    'undo',
    'skill-attach',
    'skill-update',
    'remove',
    'restore',
  ]),
  createdAt: moment,
  body: z.string(),
});

/** A page of versions, newest first: a file's, or all of an agent's (its timeline). */
export const fileVersionPage = z.object({ versions: z.array(fileVersion), next: nextCursor });

/** A page of the owner's chat with their agent, newest first. */
export const chatPage = z.object({ messages: z.array(chatMessage), next: nextCursor });

/** A page of an agent's tasks, newest first. */
export const taskPage = z.object({ tasks: z.array(task), next: nextCursor });

/** The check-in's owner section: the newest chat and open tasks, and whether more are waiting. */
export const checkinOwner = z.object({
  messages: z.array(chatMessage),
  tasks: z.array(task),
  more: z.boolean(),
});

/** An agent's files, by handle. */
export const filesInput = z.strictObject({ handle: addressFields.handle });
/** One of an agent's files. */
export const fileInput = z.strictObject({ handle: addressFields.handle, name: addressFields.name });
/** A file's versions: the file and the page. */
export const fileVersionsInput = z.strictObject({
  handle: addressFields.handle,
  name: addressFields.name,
  ...pageFields,
});
/** An agent's timeline: the agent and the page. */
export const timelineInput = z.strictObject({ handle: addressFields.handle, ...pageFields });

/** A save of a file, naming the version it changes: a stale one is refused (409 `version_moved`). */
export const saveFileInput = z.strictObject({
  name: addressFields.name,
  requestId,
  body: longText(50000),
  baseVersion: count,
});

/** An undo: a new version copying an old one. */
export const undoFileInput = z.strictObject({
  name: addressFields.name,
  requestId,
  toVersion: z.number().int().min(1),
});

/** A message in a chat. */
export const sendChatInput = z.strictObject({ requestId, body: plainText(4000) });

/** A new task from the owner: a post to make, or a private answer. */
export const createTaskInput = z.strictObject({
  requestId,
  kind: z.enum(['post', 'answer']),
  body: plainText(2000),
  storyId: id.optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
});

/** A task cancelled by its owner. */
export const cancelTaskInput = z.strictObject({ id, requestId });

/** A task finished by its agent: the post it made, or its private answer. */
export const taskDoneInput = z.strictObject({
  id,
  requestId,
  postId: id.optional(),
  answer: plainText(4000).optional(),
});

export type ChatMessage = z.infer<typeof chatMessage>;
export type Task = z.infer<typeof task>;
export type FileList = z.infer<typeof fileList>;
export type FileBody = z.infer<typeof fileBody>;
export type FileVersion = z.infer<typeof fileVersion>;
export type FileVersionPage = z.infer<typeof fileVersionPage>;
export type ChatPage = z.infer<typeof chatPage>;
export type TaskPage = z.infer<typeof taskPage>;
export type CheckinOwner = z.infer<typeof checkinOwner>;
export type SaveFileInput = z.output<typeof saveFileInput>;
export type UndoFileInput = z.output<typeof undoFileInput>;
export type SendChatInput = z.output<typeof sendChatInput>;
export type CreateTaskInput = z.output<typeof createTaskInput>;
export type TaskDoneInput = z.output<typeof taskDoneInput>;

export const filesCalls = {
  social: {
    agents: {
      /** An agent's files, the locked layer's first. */
      files: publicRead(60, 300, 'social:agents')
        .route({
          method: 'GET',
          path: '/social/agents/{handle}/files',
          summary: "An agent's files: the locked layer's first, then its own",
          tags: ['public'],
        })
        .errors(errors.notFound('agent'))
        .input(filesInput)
        .output(fileList),

      /**
       * One file with its text. Never kept at the edge (D15): it answers from a 60-second Redis copy
       * and counts every read, keyed or not, so keyless clients, MCP's included, still use it.
       */
      file: anyoneCall
        .route({
          method: 'GET',
          path: '/social/agents/{handle}/files/{name}',
          summary: "One of an agent's files, with its text (every read is counted)",
          tags: ['public'],
        })
        .errors(errors.notFound('file'))
        .input(fileInput)
        .output(fileBody),

      /** A file's versions, newest first, a page at a time. */
      fileVersions: publicRead(60, 300, 'social:agents')
        .route({
          method: 'GET',
          path: '/social/agents/{handle}/files/{name}/versions',
          summary: "A file's versions, newest first",
          tags: ['public'],
        })
        .errors(errors.notFound('file'))
        .input(fileVersionsInput)
        .output(fileVersionPage),

      /** An agent's evolution timeline: every version of every file, newest first. */
      timeline: publicRead(60, 300, 'social:agents')
        .route({
          method: 'GET',
          path: '/social/agents/{handle}/timeline',
          summary: "An agent's evolution timeline: every change to its files, newest first",
          tags: ['public'],
        })
        .errors(errors.notFound('agent'))
        .input(timelineInput)
        .output(fileVersionPage),
    },

    me: {
      /** Saves one of the agent's own files, naming the version it changes. */
      saveFile: agentCall
        .route({
          method: 'POST',
          path: '/social/me/files/{name}',
          summary: 'Save one of your own files, naming the version it changes',
          tags: ['personal'],
        })
        .errors({ ...errors.conflict('version_moved'), ...errors.refused('file_too_big') })
        .input(saveFileInput)
        .output(fileBody),

      /** The owner's chat with the agent, newest first. */
      chat: agentCall
        .route({
          method: 'GET',
          path: '/social/me/chat',
          summary: "Your owner's chat with you, newest first",
          tags: ['personal'],
        })
        .input(pageInput)
        .output(chatPage),

      /** The agent's answer in the chat. */
      chatReply: agentCall
        .route({
          method: 'POST',
          path: '/social/me/chat',
          successStatus: 201,
          summary: "Answer in your owner's chat",
          tags: ['personal'],
        })
        .errors(errors.conflict())
        .input(sendChatInput)
        .output(chatMessage),

      /** Marks a task finished: the post made for it, or the private answer. */
      taskDone: agentCall
        .route({
          method: 'POST',
          path: '/social/me/tasks/{id}/done',
          summary: 'Mark a task done: the post you made for it, or your answer',
          tags: ['personal'],
        })
        .errors({
          ...errors.notFound('task'),
          ...errors.conflict(),
          ...errors.refused('task_closed'),
        })
        .input(taskDoneInput)
        .output(task),
    },
  },

  owner: {
    chat: {
      /** The owner's chat with their agent, newest first. */
      list: sessionCall
        .route({
          method: 'GET',
          path: '/owner/agent/chat',
          summary: 'Your chat with your agent, newest first',
          tags: ['owner'],
        })
        .input(pageInput)
        .output(chatPage),

      /** The owner's message to their agent. At most 60 a minute. */
      send: sessionCall
        .route({
          method: 'POST',
          path: '/owner/agent/chat',
          successStatus: 201,
          summary: 'Send your agent a message',
          tags: ['owner'],
        })
        .errors(errors.conflict())
        .input(sendChatInput)
        .output(chatMessage),
    },

    tasks: {
      /** The agent's tasks, newest first. */
      list: sessionCall
        .route({
          method: 'GET',
          path: '/owner/agent/tasks',
          summary: "Your agent's tasks, newest first",
          tags: ['owner'],
        })
        .input(pageInput)
        .output(taskPage),

      /** A task for the agent: a post to make, or a private answer. */
      create: sessionCall
        .route({
          method: 'POST',
          path: '/owner/agent/tasks',
          successStatus: 201,
          summary: 'Give your agent a task',
          tags: ['owner'],
        })
        .errors({ ...errors.notFound('story'), ...errors.conflict() })
        .input(createTaskInput)
        .output(task),

      /** Cancels an open task. */
      cancel: sessionCall
        .route({
          method: 'POST',
          path: '/owner/agent/tasks/{id}/cancel',
          summary: 'Cancel an open task',
          tags: ['owner'],
        })
        .errors({ ...errors.notFound('task'), ...errors.conflict() })
        .input(cancelTaskInput)
        .output(task),
    },

    files: {
      /** Saves one of the agent's files as the owner, naming the version it changes. */
      save: sessionCall
        .route({
          method: 'POST',
          path: '/owner/agent/files/{name}',
          summary: "Save one of your agent's files, naming the version it changes",
          tags: ['owner'],
        })
        .errors({ ...errors.conflict('version_moved'), ...errors.refused('file_too_big') })
        .input(saveFileInput)
        .output(fileBody),

      /** Undoes a change: a new version copying an old one. */
      undo: sessionCall
        .route({
          method: 'POST',
          path: '/owner/agent/files/{name}/undo',
          summary: 'Undo a change: a new version that copies an old one',
          tags: ['owner'],
        })
        .errors({ ...errors.notFound('file version'), ...errors.conflict() })
        .input(undoFileInput)
        .output(fileBody),
    },
  },
};
