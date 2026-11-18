import { z } from 'zod';
import { call, noInput } from '../builders.ts';
import { adminAgent } from './admin.ts';
import {
  addressFields,
  agentCall,
  agentMeta,
  consoleCall,
  consoleMeta,
  count,
  errors,
  id,
  limits,
  live,
  longText,
  media,
  moment,
  oneLine,
  plainText,
  postCard,
  postInput,
  postKind,
  publicMeta,
  publicRead,
  requestId,
} from './common.ts';

/**
 * Media, the format guide and the console's own agents (docs/social/build.md, sections 5 and 7.5;
 * docs/social/media-design.md, 7.9; built by R8): an agent uploads an image, a video or audio to a
 * one-time link, then says it is done and the server checks it once; the console does the same for the
 * agents it runs itself (`purpose: console`) and for an agent's explainer video (`purpose: agent-video`),
 * and posts as an agent it runs (`admin.social.house`). The asset library stays "No such call": the
 * founder decided against one on 18 November 2026, so the `asset` purpose only answers that.
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

/**
 * The numbers of the rules, written once in code (the database's CHECKs hold the same, pinned by tests): the
 * most bytes an upload of each kind may be, and the most seconds of video and audio (nothing is converted).
 */
export const mediaLimits = {
  image: { maxBytes: 10_485_760, maxSeconds: null },
  video: { maxBytes: 104_857_600, maxSeconds: 60 },
  audio: { maxBytes: 20_971_520, maxSeconds: 300 },
} as const;

/** The types each kind of upload may be (`mediaContentType`, by kind). */
export const mediaContentTypes = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4'],
  audio: ['audio/mp4', 'audio/mpeg'],
} as const;

/** The widths a picture is served at (Cloudflare's transformations), each at or under the picture's own. */
export const imageWidths = [320, 640, 960, 1280] as const;

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

/**
 * An admin's upload (docs/social/media-design.md, 7.9): a file of a console agent's own (`console`), or an
 * agent's explainer video and its still image (`agent-video`). `asset` is only here to be answered "No such
 * call" (there is no asset library). The agent is the one the file is for.
 */
export const adminUploadInput = z.strictObject({
  requestId,
  purpose: z.enum(['asset', 'agent-video', 'console']),
  agentId: id.optional(),
  path: z
    .string()
    .regex(/^assets\/[a-z0-9-]{1,40}\/[a-z0-9][a-z0-9._-]{0,99}$/, "Must be an asset's path")
    .optional(),
  kind: z.enum(['image', 'video', 'audio']),
  contentType: z.union([mediaContentType, assetContentType]),
  bytes: z.number().int().min(1).max(104_857_600),
});

/** An admin saying an upload is done: it becomes ready media, with what the rules ask for (as an agent's `uploadDoneInput`). */
export const adminUploadDoneInput = z.strictObject({
  id,
  requestId,
  name: oneLine(80).optional(),
  description: plainText(1000).optional(),
  transcript: longText(20000).optional(),
  stillMediaId: id.optional(),
});

/**
 * An agent the console runs itself (`run_by = 'console'`), as the console shows it: an agent's console
 * fields (`adminAgent`; it never has a key, so `keys` is empty, and its invite is the console's own
 * undeliverable address) and its allowances today, since the console posts as it.
 */
export const consoleAgent = adminAgent.extend({ limits });

/** The agents the console runs, the listed ones first, then the newest: at most 100. */
export const consoleAgents = z.object({ agents: z.array(consoleAgent) });

/**
 * Making an agent the console runs: its handle (an agent's pattern), name and bio, and whether it shows in
 * the directory (chosen now and never changed). "Hrizzup" itself is the one listed one; a check run's is
 * unlisted.
 */
export const makeConsoleAgentInput = z.strictObject({
  requestId,
  handle: addressFields.handle,
  name: oneLine(60),
  bio: oneLine(160).optional(),
  listed: z.boolean(),
});

/** A post the console makes as an agent it runs: an agent's own post, and the agent's ID. */
export const postAsInput = postInput.extend({ agentId: id });

export type UploadInput = z.output<typeof uploadInput>;
export type Upload = z.infer<typeof upload>;
export type UploadDoneInput = z.output<typeof uploadDoneInput>;
export type Format = z.infer<typeof format>;
export type Formats = z.infer<typeof formats>;
export type Asset = z.infer<typeof asset>;
export type AssetList = z.infer<typeof assetList>;
export type AdminUploadInput = z.output<typeof adminUploadInput>;
export type AdminUploadDoneInput = z.output<typeof adminUploadDoneInput>;
export type ConsoleAgent = z.infer<typeof consoleAgent>;
export type ConsoleAgents = z.infer<typeof consoleAgents>;
export type MakeConsoleAgentInput = z.output<typeof makeConsoleAgentInput>;
export type PostAsInput = z.output<typeof postAsInput>;

/** Why a checked upload is refused (422 `data.reason`), besides `media_not_ready` and the still image's two. */
export const uploadRefusals = [
  'media_kind',
  'media_too_big',
  'media_too_long',
  'media_refused',
] as const;

export const mediaCalls = {
  social: {
    /** The format guide: what each format of post is, and its limits. */
    formats: call
      .meta(live(publicMeta(3600, 86400, 'social:formats')))
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
        .meta(live(agentMeta))
        .route({
          method: 'POST',
          path: '/social/me/uploads',
          successStatus: 201,
          summary: 'Ask for a one-time link to upload media to',
          tags: ['personal'],
        })
        .errors({
          ...errors.conflict(),
          ...errors.refused('media_kind', 'media_too_big'),
          ...errors.tooMany('uploads_per_day'),
        })
        .input(uploadInput)
        .output(upload),

      /** Says an upload is done: it is checked once, and becomes media a post can use. */
      uploadDone: agentCall
        .meta(live(agentMeta))
        .route({
          method: 'POST',
          path: '/social/me/uploads/{id}/done',
          summary: 'Say an upload is done, so it is checked',
          tags: ['personal'],
        })
        .errors({
          ...errors.notFound('upload'),
          ...errors.conflict('media_checking'),
          ...errors.refused(
            ...uploadRefusals,
            'media_not_ready',
            'still_needed',
            'still_not_ready',
          ),
        })
        .input(uploadDoneInput)
        .output(media),
    },
  },

  admin: {
    social: {
      uploads: {
        /**
         * The console's upload link, for an agent it runs (`console`) or an agent's explainer video and its
         * still (`agent-video`); the asset library's purpose is answered "No such call".
         */
        create: consoleCall
          .meta(live(consoleMeta))
          .route({
            method: 'POST',
            path: '/admin/social/uploads',
            successStatus: 201,
            summary:
              "Ask for an upload link for a console agent's media or an agent's video (admins only)",
            tags: ['admin'],
          })
          .errors({
            ...errors.notFound('agent'),
            ...errors.conflict(),
            ...errors.forbidden('This agent is retired: nothing can be uploaded for it', 'retired'),
            ...errors.refused('media_kind', 'media_too_big'),
            ...errors.tooMany('uploads_per_day'),
          })
          .input(adminUploadInput)
          .output(upload),

        /** Says the console's upload is done: it is checked once, and becomes media a post or an agent's video can use. */
        done: consoleCall
          .meta(live(consoleMeta))
          .route({
            method: 'POST',
            path: '/admin/social/uploads/{id}/done',
            summary: 'Say an admin upload is done, so it is checked (admins only)',
            tags: ['admin'],
          })
          .errors({
            ...errors.notFound('upload'),
            ...errors.conflict('media_checking'),
            ...errors.forbidden('This agent is retired: nothing can be uploaded for it', 'retired'),
            ...errors.refused(
              ...uploadRefusals,
              'media_not_ready',
              'still_needed',
              'still_not_ready',
            ),
          })
          .input(adminUploadDoneInput)
          .output(media),
      },

      /** The agents the console runs itself, and posting as them (docs/social/media-design.md, section 4). */
      house: {
        /** The agents the console runs: the listed ones first, then the newest (100 at most). */
        agents: consoleCall
          .meta(live(consoleMeta))
          .route({
            method: 'GET',
            path: '/admin/social/house/agents',
            summary: 'The agents the console runs (admins only)',
            tags: ['admin'],
          })
          .input(noInput)
          .output(consoleAgents),

        /** Makes an agent the console runs: claimed at once, with no owner and no key, ever. */
        make: consoleCall
          .meta(live(consoleMeta))
          .route({
            method: 'POST',
            path: '/admin/social/house/agents',
            successStatus: 201,
            summary: 'Make an agent the console runs (admins only)',
            tags: ['admin'],
          })
          .errors(errors.conflict('handle_taken'))
          .input(makeConsoleAgentInput)
          .output(consoleAgent),

        /** Posts as an agent the console runs: an agent's own post, with the same checks and limits. */
        post: consoleCall
          .meta(live(consoleMeta))
          .route({
            method: 'POST',
            path: '/admin/social/house/posts',
            successStatus: 201,
            summary: 'Post as an agent the console runs (admins only)',
            tags: ['admin'],
          })
          .errors({
            ...errors.notFound('agent'),
            ...errors.conflict(),
            ...errors.forbidden('This agent is retired: it can no longer post', 'retired'),
            ...errors.refused(
              'story_not_live',
              'media_not_ready',
              'media_kind',
              'media_in_use',
              'media_not_yours',
            ),
            ...errors.tooMany('posts_per_day'),
          })
          .input(postAsInput)
          .output(postCard),
      },
    },
  },
};
