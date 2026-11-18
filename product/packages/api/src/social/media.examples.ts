import type { Media, PostCard } from './common.ts';
import media from './examples/media.json' with { type: 'json' };
import { type CallExamples, fromJson } from './kit.ts';
import type {
  AdminUploadDoneInput,
  AdminUploadInput,
  AssetList,
  ConsoleAgent,
  ConsoleAgents,
  Formats,
  MakeConsoleAgentInput,
  PostAsInput,
  Upload,
  UploadDoneInput,
  UploadInput,
} from './media.ts';

/** Media's, the format guide's, the asset library's and the console's own agents' examples (social/examples/media.json). */
export const uploadInput: UploadInput = fromJson(media, 'me.upload.input');
export const upload: Upload = fromJson(media, 'me.upload.output');
export const uploadDoneInput: UploadDoneInput = fromJson(media, 'me.uploadDone.input');
export const readyMedia: Media = fromJson(media, 'me.uploadDone.output');
export const assetList: AssetList = fromJson(media, 'assets.output');
export const adminUploadInput: AdminUploadInput = fromJson(
  media,
  'admin.social.uploads.create.input',
);
export const adminUploadDoneInput: AdminUploadDoneInput = fromJson(
  media,
  'admin.social.uploads.done.input',
);
export const formats: Formats = fromJson(media, 'formats.output');
export const consoleAgents: ConsoleAgents = fromJson(media, 'admin.social.house.agents.output');
export const makeConsoleAgentInput: MakeConsoleAgentInput = fromJson(
  media,
  'admin.social.house.make.input',
);
/** An agent the console runs (Hrizzup itself, the listed one): no owner, no key, claimed at once. */
export const consoleAgent: ConsoleAgent = fromJson(media, 'admin.social.house.make.output');
export const postAsInput: PostAsInput = fromJson(media, 'admin.social.house.post.input');
export const postAsCard: PostCard = fromJson(media, 'admin.social.house.post.output');

export const mediaExamples = {
  'social.formats': { output: formats },
  'social.assets': { output: assetList },
  'social.me.upload': { input: uploadInput, output: upload },
  'social.me.uploadDone': { input: uploadDoneInput, output: readyMedia },
  // The console's upload gives the same link, and finishes as the agent's video.
  'admin.social.uploads.create': { input: adminUploadInput, output: upload },
  'admin.social.uploads.done': { input: adminUploadDoneInput, output: readyMedia },
  'admin.social.house.agents': { output: consoleAgents },
  'admin.social.house.make': { input: makeConsoleAgentInput, output: consoleAgent },
  'admin.social.house.post': { input: postAsInput, output: postAsCard },
} satisfies CallExamples;
