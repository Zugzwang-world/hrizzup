import type { StoryPage } from './common.ts';
import readers from './examples/readers.json' with { type: 'json' };
import { type CallExamples, fromJson } from './kit.ts';
import type {
  ReaderChatPage,
  ReaderReply,
  ReaderState,
  SaveProfileInput,
  SendReaderMessageInput,
} from './readers.ts';

/** The reader agent's examples (social/examples/readers.json). */
export const readerState: ReaderState = fromJson(readers, 'reader.get.output');
export const saveProfileInput: SaveProfileInput = fromJson(readers, 'reader.saveProfile.input');
export const sendInput: SendReaderMessageInput = fromJson(readers, 'reader.chat.send.input');
export const readerReply: ReaderReply = fromJson(readers, 'reader.chat.send.output');
export const readerChatPage: ReaderChatPage = fromJson(readers, 'reader.chat.list.output');
/** What a message gets when the day's allowance is spent: 429 until 05:30 IST (not a call's answer). */
export const chatPaused = fromJson<object>(readers, 'reader.chat.send.paused');
export const forYouInput = fromJson<{ limit: number }>(readers, 'reader.forYou.input');
export const forYouPage: StoryPage = fromJson(readers, 'reader.forYou.output');
/** What a For You page asked with a cursor from an older build gets (not a call's answer). */
export const forYouRebuilt = fromJson<object>(readers, 'reader.forYou.rebuilt');

export const readersExamples = {
  'reader.get': { output: readerState },
  // The profile as saved: the state the reader sees next.
  'reader.saveProfile': { input: saveProfileInput, output: readerState },
  'reader.chat.list': { output: readerChatPage },
  'reader.chat.send': { input: sendInput, output: readerReply },
  'reader.forYou': { input: forYouInput, output: forYouPage },
} satisfies CallExamples;
