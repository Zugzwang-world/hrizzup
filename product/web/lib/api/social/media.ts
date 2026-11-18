import { social } from '@hrizzup/api';
import type { Transaction } from '@hrizzup/db';
import { ORPCError } from '@orpc/server';
import { waitUntil } from '@vercel/functions';
import { asApp } from '@/lib/social/access.ts';
import {
  agentOf,
  forgetCheckin,
  runAsAgent,
  waitHeader,
  withinAgentLimit,
} from '@/lib/social/callers.ts';
import type { OwnMap } from '@/lib/social/errors.ts';
import { refusalError } from '@/lib/social/media/refusals.ts';
import { type BeginAnswer, type FinishAnswer, settle } from '@/lib/social/media/settle.ts';
import { mediaStorage } from '@/lib/social/media/storage.ts';
import { mediaOf } from '@/lib/social/post-card.ts';
import { answerOf } from '@/lib/social/shape.ts';
import { admin, api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * Uploads and the format guide (R8; docs/social/media-design.md, 3.8 and 7.3 to 7.10): this area's handlers. The
 * agent's two calls, `social.me.upload` and `social.me.uploadDone`, and `social.formats` are built here; the
 * asset library stays "No such call" (the founder's decision of 18 November 2026: no asset library), and the
 * console's upload calls are M2b's.
 *
 * - **An upload is checked once it is said to be done** (`uploadDone`), in two short transactions around the
 *   check (`settle.ts`), never one: no database client is checked out while storage or `sharp` runs.
 * - **R8's own error map** (`mediaFaults`) is asked before the shared one, for every call here: HZS16's new
 *   details and HZS28's `media_checking` mean something here that the shared map would answer as `media_not_ready`
 *   or `clash`.
 * - **Every 429 sets `Retry-After`** (`waitHeader`).
 */

// The errors ---------------------------------------------------------------------------------------------

const MEDIA_KIND =
  "That type isn't one of this kind's: images are JPEG, PNG or WebP, video MP4, audio M4A or MP3";
const MEDIA_TOO_BIG = 'Too big: images are at most 10 MB, video 100 MB and audio 20 MB';

const refused = (reason: string, message: string) =>
  new ORPCError('REFUSED', { status: 422, message, data: { reason } });

/** 422 `media_kind`: the type isn't one of the kind's. */
const kindRefusal = () => refused('media_kind', MEDIA_KIND);
/** 422 `media_too_big`. */
const tooBigRefusal = () => refused('media_too_big', MEDIA_TOO_BIG);
/** 409 `media_checking`: another call holds the upload's check. */
const checkingClash = () =>
  new ORPCError('CONFLICT', {
    status: 409,
    message: "This upload is being checked: say it's done again in a minute",
    data: { reason: 'media_checking' },
  });

/** The seconds in an error's `hint` (where the database puts a wait), or a day when it gives none. */
function waitOf(hint: string | undefined): number {
  const seconds = Number(hint);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : 86_400;
}

/**
 * What the database refuses that is R8's (docs/social/media-design.md, 3.8), and nothing else: HZS16's new
 * details (a type that isn't the kind's, a file too big, the day's uploads used, a still image missing or not
 * ready) and HZS28 while a check runs. HZS16's other details (`media_not_ready`, `media_in_use`, `media_not_yours`)
 * and every other code are the shared map's.
 */
export const mediaFaults: OwnMap = (fault) => {
  if (fault.code === 'HZS28' && fault.detail === 'media_checking') return checkingClash();
  if (fault.code !== 'HZS16') return undefined;
  switch (fault.detail) {
    case 'media_kind':
      return kindRefusal();
    case 'media_too_big':
      return tooBigRefusal();
    case 'uploads_per_day':
      return new ORPCError('TOO_MANY_REQUESTS', {
        status: 429,
        message: 'You have started your uploads for the day: try again later',
        data: { reason: 'uploads_per_day', retryAfterSeconds: waitOf(fault.hint) },
      });
    case 'still_needed':
      return refused(
        'still_needed',
        'A video or audio needs its still image: upload the image, then send its ID as stillMediaId',
      );
    case 'still_not_ready':
      return refused(
        'still_not_ready',
        "The still must be one of your own ready images: upload it and say it's done first",
      );
    default:
      return undefined;
  }
};

const noStorage = () =>
  new ORPCError('SERVICE_UNAVAILABLE', { status: 503, message: 'Uploads are not set up here' });

// The formats ---------------------------------------------------------------------------------------------

/** One row of `social.format_guide()`. */
type FormatRow = {
  code: string;
  name: string;
  kinds: social.Format['kinds'];
  guide: string | null;
};

const KINDS = ['image', 'video', 'audio'] as const;

/** A format as the contract gives it: its limits are the largest of its kinds' (`mediaLimits`, the one definition of the numbers in code). */
export function formatOf(row: FormatRow): social.Format {
  const limits = row.kinds.flatMap((kind) =>
    kind === 'text' ? [] : [social.mediaLimits[kind as (typeof KINDS)[number]]],
  );
  const seconds = limits.flatMap((limit) => (limit.maxSeconds === null ? [] : [limit.maxSeconds]));
  return {
    code: row.code,
    name: row.name,
    kinds: row.kinds,
    limits: {
      maxBytes: Math.max(0, ...limits.map((limit) => limit.maxBytes)),
      maxSeconds: seconds.length === 0 ? null : Math.max(...seconds),
      imageWidths: row.kinds.includes('image') ? [...social.imageWidths] : [],
    },
    guide: row.guide ?? '',
  };
}

// Uploads ---------------------------------------------------------------------------------------------------

/** A statement of one value, `answer`, in the agent's transaction. */
const answered = async <T>(tx: Transaction, sql: string, values: unknown[]) =>
  answerOf((await tx.query(sql, values)).rows) as T;

/** What `social.upload_create` answers. */
type UploadRow = {
  media: {
    id: string;
    kind: social.Upload['media']['kind'];
    state: social.Upload['media']['state'];
  };
  content_type: string;
  bytes: number;
  upload_key: string;
  expires_at: string;
};

const LEAST_SECONDS = 60;
const MOST_SECONDS = 600;

/** The seconds a link lives: until the row's own expiry, never under a minute or over ten. */
function linkSeconds(expiresAt: string, now = Date.now()): number {
  const left = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  return Math.min(MOST_SECONDS, Math.max(LEAST_SECONDS, Number.isFinite(left) ? left : 0));
}

export const mediaRoutes = {
  social: {
    /**
     * The format guide, from the database's own list: each format's kinds and words, with the limits the code
     * holds. Kept at the edge for an hour; a deploy purges it (formats change only by migration, and staging
     * applies migrations before the code).
     */
    formats: api.social.formats.handler(async () => {
      const answer = await asApp(
        async (tx) =>
          answered<{ formats: FormatRow[] }>(tx, 'select social.format_guide() as answer', []),
        mediaFaults,
      );
      return { formats: answer.formats.map(formatOf) };
    }),
    assets: api.social.assets.handler(notBuilt),
    me: {
      /**
       * An upload link: the type and size are checked before the database is asked, the row is made (one transaction,
       * as the agent), and a link to PUT exactly that file is signed for the time the row has left.
       */
      upload: api.social.me.upload.handler(async ({ input, context }) => {
        const agent = await agentOf(context.headers);
        try {
          await withinAgentLimit(agent, 'write', context.resHeaders);
          const storage = mediaStorage();
          if (storage === null) throw noStorage();
          if (
            !(social.mediaContentTypes[input.kind] as readonly string[]).includes(input.contentType)
          ) {
            throw kindRefusal();
          }
          if (input.bytes > social.mediaLimits[input.kind].maxBytes) throw tooBigRefusal();
          const row = await runAsAgent(
            agent,
            (tx) =>
              answered<UploadRow>(tx, 'select social.upload_create($1, $2, $3, $4) as answer', [
                input.requestId,
                input.kind,
                input.contentType,
                input.bytes,
              ]),
            mediaFaults,
          );
          const signed = await storage.presignPut({
            key: row.upload_key,
            contentType: row.content_type,
            bytes: row.bytes,
            seconds: linkSeconds(row.expires_at),
          });
          await forgetCheckin(agent.agentId);
          return {
            media: row.media,
            uploadUrl: signed.url,
            headers: signed.headers,
            expiresAt: row.expires_at,
          };
        } catch (error) {
          waitHeader(error, context.resHeaders);
          throw error;
        }
      }),

      /**
       * Says an upload is done, and checks it. Not `agentCall` (one transaction): two short transactions around
       * the check, so no database client is held while the file is read (`settle.ts`).
       */
      uploadDone: api.social.me.uploadDone.handler(async ({ input, context }) => {
        const agent = await agentOf(context.headers);
        try {
          await withinAgentLimit(agent, 'write', context.resHeaders);
          const storage = mediaStorage();
          if (storage === null) throw noStorage();
          const settled = await settle({
            begin: () =>
              runAsAgent(
                agent,
                (tx) =>
                  answered<BeginAnswer>(
                    tx,
                    'select social.upload_begin($1, $2, $3, $4, $5) as answer',
                    [
                      input.requestId,
                      input.id,
                      input.description ?? null,
                      input.transcript ?? null,
                      input.stillMediaId ?? null,
                    ],
                  ),
                mediaFaults,
              ),
            finish: (token, outcome) =>
              runAsAgent(
                agent,
                (tx) =>
                  answered<FinishAnswer>(
                    tx,
                    'select social.upload_finish($1, $2, $3, $4::jsonb) as answer',
                    [input.requestId, input.id, token, JSON.stringify(outcome)],
                  ),
                mediaFaults,
              ),
            storage,
            cleanUp: waitUntil,
          });
          await forgetCheckin(agent.agentId);
          switch (settled.step) {
            case 'answer': {
              const media = mediaOf(settled.media);
              // A ready media the page can't show is our fault (no media host set), never the agent's.
              if (media === null) throw new Error('A ready media could not be shown');
              return media;
            }
            case 'refused':
              throw refusalError(settled.reason);
            case 'released':
              throw settled.notArrived
                ? refused(
                    'media_not_ready',
                    "The file hasn't reached its upload link yet: PUT it there, then say it's done again",
                  )
                : new ORPCError('SERVICE_UNAVAILABLE', {
                    status: 503,
                    message:
                      "The upload couldn't be checked just now: say it's done again in a moment",
                  });
            default:
              throw checkingClash();
          }
        } catch (error) {
          waitHeader(error, context.resHeaders);
          throw error;
        }
      }),
    },
  },
  admin: {
    social: {
      uploads: {
        create: admin.social.uploads.create.handler(notBuilt),
        done: admin.social.uploads.done.handler(notBuilt),
      },
    },
  },
};
