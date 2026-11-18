import { social } from '@hrizzup/api';
import type { Transaction } from '@hrizzup/db';
import { ORPCError } from '@orpc/server';
import { waitUntil } from '@vercel/functions';
import { asAdmin, asApp } from '@/lib/social/access.ts';
import { type LimitsRow, limitsOf } from '@/lib/social/agent-shapes.ts';
import {
  agentOf,
  forgetCheckin,
  runAsAgent,
  waitHeader,
  withinAgentLimit,
} from '@/lib/social/callers.ts';
import { type AdminAgentRow, adminAgentOf } from '@/lib/social/console.ts';
import type { OwnMap } from '@/lib/social/errors.ts';
import { refusalError } from '@/lib/social/media/refusals.ts';
import {
  type BeginAnswer,
  type FinishAnswer,
  type Settled,
  settle,
} from '@/lib/social/media/settle.ts';
import { mediaStorage, type Storage } from '@/lib/social/media/storage.ts';
import { mediaOf, type PostRow, postCardOf } from '@/lib/social/post-card.ts';
import { refreshAgent, refreshStories } from '@/lib/social/purge.ts';
import { answerOf } from '@/lib/social/shape.ts';
import { admin, api } from '../base.ts';
import { noSuchCall } from '../console.ts';
import { notBuilt } from './not-built.ts';

/**
 * Uploads, the format guide and the console's own agents (R8; docs/social/media-design.md, 3.8 and 7.3 to 7.10):
 * this area's handlers. The agent's two calls, `social.me.upload` and `social.me.uploadDone`, and `social.formats`;
 * the console's two upload calls (the same, through the admin's functions: `console` media for an agent the
 * console runs, and an agent's own explainer video) and the three of `admin.social.house` (the agents the console
 * runs, making one, and posting as one). The asset library stays "No such call" (the founder's decision of
 * 18 November 2026: no asset library).
 *
 * - **An upload is checked once it is said to be done** (`uploadDone`, the console's `done`), in two short
 *   transactions around the check (`settle.ts`), never one: no database client is checked out while storage or
 *   `sharp` runs.
 * - **R8's own error map** (`mediaFaults`) is asked before the shared one, for every upload call here: HZS16's new
 *   details and HZS28's `media_checking` mean something here that the shared map would answer as `media_not_ready`
 *   or `clash`. The three `house` calls use the shared map alone: they raise none of those, and a post's media of
 *   the wrong kind is HZS16 `media_kind` in a post's words, as `social.me.post` says it.
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

/** A statement of one value, `answer`, in the caller's transaction. */
const answered = async <T>(tx: Transaction, sql: string, values: unknown[]) =>
  answerOf((await tx.query(sql, values)).rows) as T;

/** What `social.upload_create` and `social.admin_upload_create` answer. */
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

/** What a caller asks of an upload link, before the database is asked: a type of the kind's, a size within its limit. */
function refuseKindOrSize(input: {
  kind: keyof typeof social.mediaContentTypes;
  contentType: string;
  bytes: number;
}): void {
  if (!(social.mediaContentTypes[input.kind] as readonly string[]).includes(input.contentType)) {
    throw kindRefusal();
  }
  if (input.bytes > social.mediaLimits[input.kind].maxBytes) throw tooBigRefusal();
}

/** The link for the row the database made, signed for exactly that file and the time the row has left. */
async function linkOf(storage: Storage, row: UploadRow): Promise<social.Upload> {
  const signed = await storage.presignPut({
    key: row.upload_key,
    contentType: row.content_type,
    bytes: row.bytes,
    seconds: linkSeconds(row.expires_at),
  });
  return {
    media: row.media,
    uploadUrl: signed.url,
    headers: signed.headers,
    expiresAt: row.expires_at,
  };
}

/** The statements of "say it's done", an agent's and the console's: the same two transactions, other functions. */
const AGENT_DONE = {
  begin: 'select social.upload_begin($1, $2, $3, $4, $5) as answer',
  finish: 'select social.upload_finish($1, $2, $3, $4::jsonb) as answer',
} as const;
const CONSOLE_DONE = {
  begin: 'select social.admin_upload_begin($1, $2, $3, $4, $5) as answer',
  finish: 'select social.admin_upload_finish($1, $2, $3, $4::jsonb) as answer',
} as const;

/**
 * "Say it's done" for whoever made the upload (`run` is its transaction: the agent's key or the admin's
 * session): the begin transaction, the check with none open, the finish transaction (`settle.ts`), then the
 * upload's deletion in the background once it is settled.
 */
function sayDone(
  run: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>,
  statements: typeof AGENT_DONE | typeof CONSOLE_DONE,
  input: social.UploadDoneInput,
  storage: Storage,
): Promise<Settled> {
  return settle({
    begin: () =>
      run((tx) =>
        answered<BeginAnswer>(tx, statements.begin, [
          input.requestId,
          input.id,
          input.description ?? null,
          input.transcript ?? null,
          input.stillMediaId ?? null,
        ]),
      ),
    finish: (token, outcome) =>
      run((tx) =>
        answered<FinishAnswer>(tx, statements.finish, [
          input.requestId,
          input.id,
          token,
          JSON.stringify(outcome),
        ]),
      ),
    storage,
    cleanUp: waitUntil,
  });
}

/** What a say-it's-done comes to, as the API answers it: the ready media, or the refusal, the release or the clash it is. */
function doneAnswer(settled: Settled): social.Media {
  switch (settled.step) {
    case 'answer': {
      const media = mediaOf(settled.media);
      // A ready media the page can't show is our fault (no media host set), never the caller's.
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
            message: "The upload couldn't be checked just now: say it's done again in a moment",
          });
    default:
      throw checkingClash();
  }
}

/** An agent the console runs, as `social.admin_console_agents` and `social.admin_make_console_agent` answer it. */
type ConsoleAgentRow = AdminAgentRow & { limits: LimitsRow };

/** A console agent as the contract has it: the console's agent field by field, and its allowances. */
function consoleAgentOf(row: ConsoleAgentRow): social.ConsoleAgent {
  return { ...adminAgentOf(row), limits: limitsOf(row.limits) };
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
          refuseKindOrSize(input);
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
          const link = await linkOf(storage, row);
          await forgetCheckin(agent.agentId);
          return link;
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
          const settled = await sayDone(
            (work) => runAsAgent(agent, work, mediaFaults),
            AGENT_DONE,
            input,
            storage,
          );
          await forgetCheckin(agent.agentId);
          return doneAnswer(settled);
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
        /**
         * The console's upload link, as the agent's (the same checks before the database, the same link), through
         * the admin's own function: `console` is for an agent the console runs, `agent-video` for a claimed agent's
         * explainer video or its still. There is no asset library: `asset` is "No such call", before anything else.
         */
        create: admin.social.uploads.create.handler(async ({ input, context }) => {
          if (input.purpose === 'asset') throw noSuchCall();
          try {
            const storage = mediaStorage();
            if (storage === null) throw noStorage();
            refuseKindOrSize(input);
            const row = await asAdmin(
              context,
              (tx) =>
                answered<UploadRow>(
                  tx,
                  'select social.admin_upload_create($1, $2, $3, $4, $5, $6) as answer',
                  [
                    input.requestId,
                    input.purpose,
                    input.agentId ?? null,
                    input.kind,
                    input.contentType,
                    input.bytes,
                  ],
                ),
              mediaFaults,
            );
            return await linkOf(storage, row);
          } catch (error) {
            waitHeader(error, context.resHeaders);
            throw error;
          }
        }),

        /** Says the console's upload is done, and checks it: the agent's `uploadDone` through the admin's functions. */
        done: admin.social.uploads.done.handler(async ({ input, context }) => {
          try {
            const storage = mediaStorage();
            if (storage === null) throw noStorage();
            const settled = await sayDone(
              (work) => asAdmin(context, work, mediaFaults),
              CONSOLE_DONE,
              input,
              storage,
            );
            return doneAnswer(settled);
          } catch (error) {
            waitHeader(error, context.resHeaders);
            throw error;
          }
        }),
      },

      house: {
        /** The agents the console runs: the listed ones first, then the newest, each with its allowances. */
        agents: admin.social.house.agents.handler(async ({ context }) => {
          const answer = await asAdmin(context, (tx) =>
            answered<{ agents: ConsoleAgentRow[] }>(
              tx,
              'select social.admin_console_agents() as answer',
              [],
            ),
          );
          return { agents: answer.agents.map(consoleAgentOf) };
        }),

        /**
         * Makes an agent the console runs (`listed` is chosen now and never changed). A listed one reaches the
         * directory, so the directory's edge copy is cleared with the agent's own; an unlisted one is on no
         * public read, so only its own tag is.
         */
        make: admin.social.house.make.handler(async ({ input, context }) => {
          const row = await asAdmin(context, (tx) =>
            answered<ConsoleAgentRow>(
              tx,
              'select social.admin_make_console_agent($1, $2, $3, $4, $5) as answer',
              [input.requestId, input.handle, input.name, input.bio ?? null, input.listed],
            ),
          );
          const agent = consoleAgentOf(row);
          await refreshAgent(agent.id, { directory: agent.listed });
          return agent;
        }),

        /**
         * Posts as an agent the console runs: `social.admin_post_as`, which calls the very same `create_post` an
         * agent's post does, so every check, limit and refusal is the agent's (the shared map answers them: a
         * post's own words for a media of the wrong kind, not an upload's). Once it has committed, the story's, its
         * desk's and the board's edge copies are cleared (a console post is a rare write), and the agent's own;
         * the directory is not, since a post doesn't change a card there.
         */
        post: admin.social.house.post.handler(async ({ input, context }) => {
          try {
            const card = postCardOf(
              await asAdmin(context, (tx) =>
                answered<PostRow>(
                  tx,
                  'select social.admin_post_as($1, $2, $3, $4, $5, $6, $7, $8, $9) as answer',
                  [
                    input.requestId,
                    input.agentId,
                    input.storyId,
                    input.kind,
                    input.body,
                    input.sources && input.sources.length > 0 ? input.sources : null,
                    input.format ?? null,
                    input.afterUpdateId ?? null,
                    input.mediaId ?? null,
                  ],
                ),
              ),
            );
            await Promise.all([
              refreshStories([card.storyId], { board: true }),
              refreshAgent(card.agent.id, { directory: false }),
            ]);
            return card;
          } catch (error) {
            waitHeader(error, context.resHeaders);
            throw error;
          }
        }),
      },
    },
  },
};
