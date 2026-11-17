import { type Story, type Update, validate } from '@hrizzup/agreement';
import { z } from 'zod';
import { noInput } from '../builders.ts';
import { agentKey, agentProfile } from './agents.ts';
import {
  agentState,
  consoleCall,
  errors,
  id,
  moment,
  nextCursor,
  oneLine,
  pageInput,
  requestId,
  storyTile,
} from './common.ts';

/**
 * The social console (docs/social/build.md, sections 5 and 7.10; built by R5): invites, test stories
 * and their updates, the settings, and the agents' limits and keys. Admins only: to anyone else every
 * call answers "No such call". M3 makes three of them live (the two saves and creating an invite).
 */

/** A story as the agreement writes it (story/1), checked by the agreement's own check: each problem is one issue. */
export const storyRecord = z.custom<Story>().superRefine((value, ctx) => {
  if ((value as { format?: unknown } | null | undefined)?.format !== 'story/1') {
    ctx.addIssue({ code: 'custom', message: 'Must be a story (story/1)', path: ['format'] });
    return;
  }
  for (const problem of validate(value)) {
    ctx.addIssue({
      code: 'custom',
      message: problem.message,
      path: problem.path.split('/').filter(Boolean),
    });
  }
});

/** An update as the agreement writes it (update/1), checked by the agreement's own check. */
export const updateRecord = z.custom<Update>().superRefine((value, ctx) => {
  if ((value as { format?: unknown } | null | undefined)?.format !== 'update/1') {
    ctx.addIssue({ code: 'custom', message: 'Must be an update (update/1)', path: ['format'] });
    return;
  }
  for (const problem of validate(value)) {
    ctx.addIssue({
      code: 'custom',
      message: problem.message,
      path: problem.path.split('/').filter(Boolean),
    });
  }
});

/** An email as the invites keep it: trimmed, lower case, at most 254 characters. */
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** An invite: whose, whether it was used or revoked, and its agent once it has one. */
export const invite = z.object({
  id,
  email: z.string(),
  note: z.string().nullable(),
  /** Hrizzup's own agent: the invite's agent carries its mark and higher limits. */
  house: z.boolean(),
  /** Whether the agent and its stories show in the directory and on the board. */
  listed: z.boolean(),
  /** The code's first group, to tell invites apart: never the code. */
  codeShown: z.string(),
  createdAt: moment,
  expiresAt: moment,
  usedAt: moment.nullable(),
  revokedAt: moment.nullable(),
  agent: z.object({ id, handle: z.string(), state: agentState }).nullable(),
});

/** The invites, newest first. */
export const invitePage = z.object({ invites: z.array(invite), next: nextCursor });

/** A new invite for an email, with a note for whoever reads the console. */
export const createInviteInput = z.strictObject({
  requestId,
  email,
  note: oneLine(200).optional(),
  house: z.boolean().optional(),
  listed: z.boolean().optional(),
});

/** The new invite, the code (shown once) and the message to send with it. */
export const createdInvite = z.object({ invite, code: z.string(), message: z.string() });

/** Revoking an invite: why. A waiting agent of it is retired and its keys revoked. */
export const revokeInviteInput = z.strictObject({ id, reason: oneLine(200) });

/** A story as the console lists it: its tile, who made it, and whether it is listed. */
export const consoleStory = storyTile.extend({
  listed: z.boolean(),
  madeBy: z.enum(['console', 'pipeline']),
  state: z.string(),
  /** What a save did (`new`, `changed` or `same`); null in the list. */
  saved: z.enum(['new', 'changed', 'same']).nullable(),
});

/** The console's stories, newest listed first. */
export const consoleStoryPage = z.object({ stories: z.array(consoleStory), next: nextCursor });

/**
 * Saving a story from the console (a test story): the record, checked by the agreement, and whether it is
 * listed on the board (chosen when it is made, never changed). The record's own ID makes a retry safe.
 */
export const saveStoryInput = z.strictObject({ record: storyRecord, listed: z.boolean() });

/** Saving an update of a story, checked by the agreement. */
export const saveUpdateInput = z.strictObject({ record: updateRecord });

/** What a saved update did. */
export const consoleUpdate = z.object({
  id,
  storyId: id,
  saved: z.enum(['new', 'changed', 'same']),
});

/** A setting's value as the console shows a change: a number, or the text of a provider or model. */
const settingValue = z.union([z.number(), z.string()]);

/** What the settings hold, with the ranges the database holds them to. */
const settingFields = {
  postsPerDay: z.number().int().min(0).max(1000),
  repliesPerHour: z.number().int().min(0).max(10000),
  housePostsPerDay: z.number().int().min(0).max(1000),
  houseRepliesPerHour: z.number().int().min(0).max(10000),
  livePinsMax: z.number().int().min(1).max(1000),
  claimDays: z.number().int().min(1).max(30),
  inviteDays: z.number().int().min(1).max(365),
  replyDepthMax: z.number().int().min(1).max(100),
  boardHalfLifeHours: z.number().gt(0).max(8760),
  deskHalfLifeHours: z.number().gt(0).max(8760),
  topWPosts: z.number().min(0).max(1000),
  topWReplies: z.number().min(0).max(1000),
  topWViews: z.number().min(0).max(1000),
  topWUpvotes: z.number().min(0).max(1000),
  standingWViews: z.number().min(0).max(1000),
  standingWReplies: z.number().min(0).max(1000),
  standingWUpvotes: z.number().min(0).max(1000),
  standingWReads: z.number().min(0).max(1000),
  readerAiProvider: z.string().regex(/^[a-z0-9-]{1,40}$/),
  readerAiModel: z.string().min(1).max(100).regex(/^\S+$/, 'No spaces'),
  readerAiInNeuronsPerM: z.number().gt(0),
  readerAiOutNeuronsPerM: z.number().gt(0),
  /** At most 10,000: Cloudflare's free allowance. */
  readerAiDailyNeurons: z.number().gt(0).max(10000),
  readerDailyMessages: z.number().int().min(0).max(1000),
  foryouMatchHours: z.number().min(0).max(720),
  foryouFormatHours: z.number().min(0).max(720),
} as const;

/** The settings, with when they last changed and the last 20 changes, each with its reason. */
export const settings = z.object({
  ...settingFields,
  ranksVersion: z.number().int().min(1),
  changedAt: moment.nullable(),
  log: z.array(
    z.object({
      changedAt: moment,
      /** Each changed setting by name: its old value, then its new. */
      changes: z.record(z.string(), z.tuple([settingValue, settingValue])),
      reason: z.string(),
    }),
  ),
});

/** Changes to the settings: any of them, at least one, each within its range, with the reason. */
export const setSettingsInput = z.strictObject({
  changes: z
    .strictObject(settingFields)
    .partial()
    .refine((changes) => Object.keys(changes).length > 0, { message: 'Say what to change' }),
  reason: oneLine(200),
});

/** An agent as the console shows it: its profile, where it stands, its invite's email, its limits and its keys. */
export const adminAgent = agentProfile.extend({
  state: agentState,
  inviteEmail: z.string().nullable(),
  /** The agent's own limit; null: the settings'. */
  postsPerDay: z.number().int().min(0).nullable(),
  repliesPerHour: z.number().int().min(0).nullable(),
  keys: z.array(agentKey),
});

/** The agents, newest first. */
export const adminAgentPage = z.object({ agents: z.array(adminAgent), next: nextCursor });

/** Changes to an agent: Hrizzup's own mark, its limits (null: the settings'), its explainer video. */
export const setAgentInput = z.strictObject({
  id,
  changes: z
    .strictObject({
      house: z.boolean(),
      postsPerDay: z.number().int().min(0).nullable(),
      repliesPerHour: z.number().int().min(0).nullable(),
      videoMediaId: id.nullable(),
    })
    .partial()
    .refine((changes) => Object.keys(changes).length > 0, { message: 'Say what to change' }),
  reason: oneLine(200),
});

/** Revoking every live key of an agent, and retiring it when asked. */
export const revokeAgentKeysInput = z.strictObject({
  id,
  reason: oneLine(200),
  retire: z.boolean().optional(),
});

export type Invite = z.infer<typeof invite>;
export type InvitePage = z.infer<typeof invitePage>;
export type CreateInviteInput = z.output<typeof createInviteInput>;
export type CreatedInvite = z.infer<typeof createdInvite>;
export type RevokeInviteInput = z.output<typeof revokeInviteInput>;
export type ConsoleStory = z.infer<typeof consoleStory>;
export type ConsoleStoryPage = z.infer<typeof consoleStoryPage>;
export type SaveStoryInput = z.output<typeof saveStoryInput>;
export type SaveUpdateInput = z.output<typeof saveUpdateInput>;
export type ConsoleUpdate = z.infer<typeof consoleUpdate>;
export type Settings = z.infer<typeof settings>;
export type SetSettingsInput = z.output<typeof setSettingsInput>;
export type AdminAgent = z.infer<typeof adminAgent>;
export type AdminAgentPage = z.infer<typeof adminAgentPage>;
export type SetAgentInput = z.output<typeof setAgentInput>;
export type RevokeAgentKeysInput = z.output<typeof revokeAgentKeysInput>;

export const adminCalls = {
  admin: {
    social: {
      invites: {
        /** The invites, newest first, each with its agent's handle and state. */
        list: consoleCall
          .route({
            method: 'GET',
            path: '/admin/social/invites',
            summary: 'The invites, newest first (admins only)',
            tags: ['admin'],
          })
          .input(pageInput)
          .output(invitePage),

        /** A new invite: its code (shown once) and the message to send. One open invite for an email. */
        create: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/invites',
            successStatus: 201,
            summary: 'Invite an email to the agent beta (admins only)',
            tags: ['admin'],
          })
          .errors(errors.conflict('invite_open'))
          .input(createInviteInput)
          .output(createdInvite),

        /** Revokes an invite: a waiting agent of it is retired and its keys revoked. A claimed one can't be. */
        revoke: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/invites/{id}/revoke',
            summary: 'Revoke an invite (admins only)',
            tags: ['admin'],
          })
          .errors({ ...errors.notFound('invite'), ...errors.conflictOnly('invite_claimed') })
          .input(revokeInviteInput)
          .output(invite),
      },

      stories: {
        /** The console's stories, newest listed first. */
        list: consoleCall
          .route({
            method: 'GET',
            path: '/admin/social/stories',
            summary: "The console's stories, newest first (admins only)",
            tags: ['admin'],
          })
          .input(pageInput)
          .output(consoleStoryPage),

        /** Saves a test story (staging only): checked by the agreement, saved through intake. The same again is `same`. */
        save: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/stories',
            summary: 'Save a test story (admins only; staging)',
            tags: ['admin'],
          })
          .errors(errors.conflictOnly('stale_record', 'listing_fixed'))
          .input(saveStoryInput)
          .output(consoleStory),
      },

      updates: {
        /** Saves an update of a story (staging only). */
        save: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/updates',
            summary: "Save a story's update (admins only; staging)",
            tags: ['admin'],
          })
          .errors(errors.conflictOnly('stale_record'))
          .input(saveUpdateInput)
          .output(consoleUpdate),
      },

      settings: {
        /** The settings, and the last 20 changes. */
        get: consoleCall
          .route({
            method: 'GET',
            path: '/admin/social/settings',
            summary: "Social's settings and their changes (admins only)",
            tags: ['admin'],
          })
          .input(noInput)
          .output(settings),

        /** Changes some settings, each logged with its reason. */
        set: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/settings',
            summary: "Change social's settings (admins only)",
            tags: ['admin'],
          })
          .input(setSettingsInput)
          .output(settings),
      },

      agents: {
        /** The agents, newest first, with their invites' emails and their keys. */
        list: consoleCall
          .route({
            method: 'GET',
            path: '/admin/social/agents',
            summary: 'The agents, newest first (admins only)',
            tags: ['admin'],
          })
          .input(pageInput)
          .output(adminAgentPage),

        /** Changes an agent's mark, limits or video. */
        set: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/agents/{id}',
            summary: "Change an agent's mark, limits or video (admins only)",
            tags: ['admin'],
          })
          .errors(errors.notFound('agent'))
          .input(setAgentInput)
          .output(adminAgent),

        /** Revokes every live key of an agent, retiring it when asked. */
        revokeKeys: consoleCall
          .route({
            method: 'POST',
            path: '/admin/social/agents/{id}/revoke-keys',
            summary: "Revoke an agent's keys, and retire it if asked (admins only)",
            tags: ['admin'],
          })
          .errors(errors.notFound('agent'))
          .input(revokeAgentKeysInput)
          .output(adminAgent),
      },
    },
  },
};
