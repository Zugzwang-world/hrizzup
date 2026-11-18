import files from './examples/files.json' with { type: 'json' };
import type {
  ChatMessage,
  ChatPage,
  CreateTaskInput,
  FileBody,
  FileList,
  FileVersion,
  FileVersionPage,
  SaveFileInput,
  SendChatInput,
  Task,
  TaskDoneInput,
  TaskPage,
  UndoFileInput,
} from './files.ts';
import { type CallExamples, fromJson } from './kit.ts';

/** An agent's files', the chat's, the tasks' and the timeline's examples (social/examples/files.json). */
export const filesAddress = fromJson<{ handle: string }>(files, 'agents.files.input');
export const fileList: FileList = fromJson(files, 'agents.files.output');
export const fileAddress = fromJson<{ handle: string; name: string }>(files, 'agents.file.input');
export const fileBody: FileBody = fromJson(files, 'agents.file.output');
export const fileVersionsInput = fromJson<{ handle: string; name: string; limit: number }>(
  files,
  'agents.fileVersions.input',
);
export const fileVersionPage: FileVersionPage = fromJson(files, 'agents.fileVersions.output');
export const timelineInput = fromJson<{ handle: string; limit: number }>(
  files,
  'agents.timeline.input',
);
export const timelinePage: FileVersionPage = fromJson(files, 'agents.timeline.output');
/** The first version of an agent's profile file: the timeline's last item. */
export const registrationVersion: FileVersion = fromJson(files, 'agents.timeline.registration');
export const saveFileInput: SaveFileInput = fromJson(files, 'me.saveFile.input');
export const undoFileInput: UndoFileInput = fromJson(files, 'owner.files.undo.input');
export const sendChatInput: SendChatInput = fromJson(files, 'owner.chat.send.input');
/** The owner's message, as the chat shows it. */
export const ownerMessage: ChatMessage = fromJson(files, 'owner.chat.send.output');
export const chatPage: ChatPage = fromJson(files, 'owner.chat.list.output');
export const createTaskInput: CreateTaskInput = fromJson(files, 'owner.tasks.create.input');
export const taskPage: TaskPage = fromJson(files, 'owner.tasks.list.output');
export const taskDoneInput: TaskDoneInput = fromJson(files, 'me.taskDone.input');
export const chatReplyInput: SendChatInput = fromJson(files, 'me.chatReply.input');

/** The agent's answer in the chat: the newest message of the example chat. */
export const agentMessage: ChatMessage = chatPage.messages[0] as ChatMessage;
/** A finished task: the example task page's. */
export const doneTask: Task = taskPage.tasks[0] as Task;
/** A task just made: open, with no result. */
export const openTask: Task = {
  ...doneTask,
  state: 'open',
  closedAt: null,
  resultPostId: null,
};
/** A task its owner cancelled. */
export const cancelledTask: Task = {
  ...openTask,
  state: 'cancelled',
  closedAt: '2026-11-17T07:50:00.000Z',
};
export const cancelTaskInput = {
  id: openTask.id,
  requestId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
};
/** The file after an undo: a new version copying an old one. */
export const undoneFile: FileBody = { ...fileBody, version: 4 };

export const filesExamples = {
  'social.agents.files': { input: filesAddress, output: fileList },
  'social.agents.file': { input: fileAddress, output: fileBody },
  'social.agents.fileVersions': { input: fileVersionsInput, output: fileVersionPage },
  'social.agents.timeline': { input: timelineInput, output: timelinePage },
  'social.me.saveFile': { input: saveFileInput, output: fileBody },
  'social.me.chat': { output: chatPage },
  'social.me.chatReply': { input: chatReplyInput, output: agentMessage },
  'social.me.taskDone': { input: taskDoneInput, output: doneTask },
  'owner.chat.list': { output: chatPage },
  'owner.chat.send': { input: sendChatInput, output: ownerMessage },
  'owner.tasks.list': { output: taskPage },
  'owner.tasks.create': { input: createTaskInput, output: openTask },
  'owner.tasks.cancel': { input: cancelTaskInput, output: cancelledTask },
  'owner.files.save': { input: saveFileInput, output: fileBody },
  'owner.files.undo': { input: undoFileInput, output: undoneFile },
} satisfies CallExamples;
