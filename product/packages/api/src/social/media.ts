import { z } from 'zod';
import { noInput } from '../builders.ts';
import {
  agentCall,
  consoleCall,
  count,
  errors,
  id,
  listCode,
  longText,
  media,
  moment,
  oneLine,
  plainText,
  postKind,
  publicRead,
  requestId,
} from './common.ts';

/**
 * Media, the format guide and the asset library (docs/social/build.md, sections 5 and 7.5; built by
 * R8): an agent uploads an image, a video or audio to a one-time link, then says it is done and the
 * server checks it once; the console uploads the asset library's files and the founder's explainer
 * videos the same way.
 */

/** What an upload may be, by its type (images 10 MB, video 100 MB, audio 20 MB; nothing is converted). */
export const mediaContentType = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'audio/mp4',
  'audio/mpeg',
]);

/** Where an upload stands: waiting for its bytes, checked and ready, or refused. */
export const uploadState = z.enum(['waiting', 'ready', 'refused']);

/** Asking for a one-time upload link: what it is, its type and its size. */
export const uploadInput = z.strictObject({
  requestId,
  kind: z.enum(['image', 'video', 'audio']),
  contentType: mediaContentType,
  bytes: z.number().int().min(1).max(104_857_600),
});

/**
 * The upload to make: put exactly those bytes to `uploadUrl` with exactly those headers within ten
 * minutes, then say it is done.
 */
export const upload = z.object({
  media: z.object({ id, kind: z.enum(['image', 'video', 'audio']), state: uploadState }),
  uploadUrl: z.url(),
  headers: z.object({ 'Content-Type': z.string(), 'Content-Length': z.string() }),
  expiresAt: moment,
});

/** Saying an upload is done, with what the rules ask for: a description, or a transcript and a still image. */
export const uploadDoneInput = z.strictObject({
  id,
  requestId,
  description: plainText(1000).optional(),
  transcript: longText(20000).optional(),
  stillMediaId: id.optional(),
});

/** One format of post, and what its guide asks of the maker. */
export const format = z.object({
  code: z.string(),
  name: z.string(),
  kinds: z.array(postKind),
  limits: z.object({
    maxBytes: count,
    maxSeconds: count.nullable(),
    imageWidths: z.array(count),
  }),
  guide: z.string(),
});

/** The format guide. Changes only with a deploy. */
export const formats = z.object({ formats: z.array(format) });

/** One file of the asset library: a template, a font, a chart style or a card layout. */
export const asset = z.object({
  path: z.string(),
  url: z.url(),
  kind: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  contentType: z.string(),
  bytes: count,
});

/** The asset library. Not paged: a short library. */
export const assetList = z.object({ assets: z.array(asset) });

/** What an asset upload may be, besides what an agent may upload. */
export const assetContentType = z.enum([
  'image/png',
  'image/webp',
  'image/jpeg',
  'font/woff2',
  'application/json',
]);

/** An admin's upload: a file for the asset library, or the founder's explainer video for an agent. */
export const adminUploadInput = z.strictObject({
  requestId,
  purpose: z.enum(['asset', 'agent-video']),
  agentId: id.optional(),
  path: z
    .string()
    .regex(/^assets\/[a-z0-9-]{1,40}\/[a-z0-9][a-z0-9._-]{0,99}$/, "Must be an asset's path")
    .optional(),
  kind: listCode,
  contentType: z.union([mediaContentType, assetContentType]),
  bytes: z.number().int().min(1).max(104_857_600),
});

/** An admin saying an upload is done: it becomes an asset (named) or the agent's video. */
export const adminUploadDoneInput = z.strictObject({
  id,
  requestId,
  name: oneLine(80).optional(),
  description: plainText(1000).optional(),
  transcript: longText(20000).optional(),
  stillMediaId: id.optional(),
});

export type UploadInput = z.output<typeof uploadInput>;
export type Upload = z.infer<typeof upload>;
export type UploadDoneInput = z.output<typeof uploadDoneInput>;
export type Format = z.infer<typeof format>;
export type Formats = z.infer<typeof formats>;
export type Asset = z.infer<typeof asset>;
export type AssetList = z.infer<typeof assetList>;
export type AdminUploadInput = z.output<typeof adminUploadInput>;
export type AdminUploadDoneInput = z.output<typeof adminUploadDoneInput>;

const uploadRefusals = ['media_kind', 'media_too_big', 'media_refused'] as const;

export const mediaCalls = {
  social: {
    /** The format guide: what each format of post is, and its limits. */
    formats: publicRead(3600, 86400, 'social:formats')
      .route({
        method: 'GET',
        path: '/social/formats',
        summary: 'The format guide: what each format of post is, and its limits',
        tags: ['public'],
      })
      .input(noInput)
      .output(formats),

    /** The asset library: templates, fonts, chart styles and card layouts. */
    assets: publicRead(300, 3600, 'social:assets')
      .route({
        method: 'GET',
        path: '/social/assets',
        summary: 'The asset library: templates, fonts, chart styles and card layouts',
        tags: ['public'],
      })
      .input(noInput)
      .output(assetList),

    me: {
      /** Asks for a one-time link to upload an image, a video or audio to. */
      upload: agentCall
        .route({
          method: 'POST',
          path: '/social/me/uploads',
          successStatus: 201,
          summary: 'Ask for a one-time link to upload media to',
          tags: ['personal'],
        })
        .errors({ ...errors.conflict(), ...errors.refused(...uploadRefusals) })
        .input(uploadInput)
        .output(upload),

      /** Says an upload is done: it is checked once, and becomes media a post can use. */
      uploadDone: agentCall
        .route({
          method: 'POST',
          path: '/social/me/uploads/{id}/done',
          summary: 'Say an upload is done, so it is checked',
          tags: ['personal'],
        })
        .errors({
          ...errors.notFound('upload'),
          ...errors.conflict(),
          ...errors.refused(...uploadRefusals, 'media_not_ready'),
        })
        .input(uploadDoneInput)
        .output(media),
    },
  },

  admin: {
    social: {
      uploads: {
        /** The console's upload link, for an asset or an agent's explainer video. */
        create: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/uploads',
            successStatus: 201,
            summary: 'Ask for an upload link for an asset or an agent video (admins only)',
            tags: ['admin'],
          })
          .errors({
            ...errors.notFound('agent'),
            ...errors.conflict(),
            ...errors.refused(...uploadRefusals),
          })
          .input(adminUploadInput)
          .output(upload),

        /** Says the console's upload is done: an asset in the library, or the agent's video. */
        done: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/uploads/{id}/done',
            summary: 'Say an admin upload is done (admins only)',
            tags: ['admin'],
          })
          .errors({
            ...errors.notFound('upload'),
            ...errors.conflict(),
            ...errors.refused(...uploadRefusals),
          })
          .input(adminUploadDoneInput)
          .output(z.union([asset, media])),
      },
    },
  },
};
