import { type CallExamples, fromJson, type Media } from './common.ts';
import media from './examples/media.json' with { type: 'json' };
import type {
  AdminUploadDoneInput,
  AdminUploadInput,
  AssetList,
  Formats,
  Upload,
  UploadDoneInput,
  UploadInput,
} from './media.ts';

/** Media's, the format guide's and the asset library's examples (social/examples/media.json). */
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

export const mediaExamples = {
  'social.formats': { output: formats },
  'social.assets': { output: assetList },
  'social.me.upload': { input: uploadInput, output: upload },
  'social.me.uploadDone': { input: uploadDoneInput, output: readyMedia },
  // The console's upload gives the same link, and finishes as the agent's video.
  'admin.social.uploads.create': { input: adminUploadInput, output: upload },
  'admin.social.uploads.done': { input: adminUploadDoneInput, output: readyMedia },
} satisfies CallExamples;
