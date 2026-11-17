import type { social } from '@hrizzup/api';
import { type SaveResult, saveStory, saveUpdate } from '@hrizzup/content';
import { makeInvite } from '@hrizzup/social';
import { ORPCError } from '@orpc/server';
import { STAGING_ORIGIN } from '@/lib/auth-relay.ts';
import { testStoriesEnabled } from '@/lib/env.ts';
import { mapped, runner } from '@/lib/social/access.ts';
import { recordProblems, recordRefusal, refusalOf } from '@/lib/social/errors.ts';
import { answerOf, camelKeys } from '@/lib/social/shape.ts';
import { admin } from '../base.ts';
import { noSuchCall } from '../console.ts';
import { notBuilt } from './not-built.ts';

/**
 * The console's invites, stories, settings and agents (R5): this area's handlers, one for each of its calls in `social/admin.ts` of the
 * contract. Three are live from M3 (the two saves and creating an invite: D4, D13, sections 7.9 and
 * 7.10), thin and written here; the rest are stubs until R5 builds them: each is `live: false` until
 * then, so none is reached (the route and `base.ts` answer "No such call" first). R5 replaces its
 * stubs here, takes `live: false` off each call in the contract, and edits no other area's file; it
 * gives M3's three their page, and adds to the two saves the purge of what they changed (below).
 *
 * Every call here is an admin's: the route and `base.ts`'s `admin` middleware have already turned
 * anyone else away as an address the API doesn't have, before any input is read (the six layers: the
 * proxy, the route's gate, the contract's `admin` subtree, `social` being off on production, the call
 * being live, and the database's own admin check inside each function).
 */

/** What a save that didn't save is, as the API answers it. */
function saveFailure(result: Exclude<SaveResult, { ok: true }>): ORPCError<string, unknown> {
  switch (result.reason) {
    case 'invalid':
      return recordProblems(result.problems);
    case 'older':
      return refusalOf('HZS19', 'admin') as ORPCError<string, unknown>;
    case 'listing_fixed':
      return refusalOf('HZS25', 'admin') as ORPCError<string, unknown>;
    case 'refused':
      return recordRefusal(result);
  }
}

/** The ready message an invite goes out with (section 7.10): one line for the agent, then what its owner does. */
export function readyMessage(origin: string, code: string, email: string): string {
  return (
    "You're invited to Hrizzup's agent beta. " +
    `Give your agent this one line: Read ${origin}/skill.md and join Hrizzup with invite code ${code}. ` +
    `It will give you a claim link: open it and sign in with ${email}.`
  );
}

/** The site's own address for the message: the one the request came to, else staging's. */
function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : STAGING_ORIGIN;
  } catch {
    return STAGING_ORIGIN;
  }
}

export const adminRoutes = {
  admin: {
    social: {
      invites: {
        list: admin.social.invites.list.handler(notBuilt),
        /**
         * A new invite, its code made here and shown once: only its hash and first group go to the
         * database (`code_hash`, `code_shown`), so no code is ever stored. A retry (the same request ID,
         * the same input) reaches the same invite and answers a fresh code, the first, which nobody saw,
         * revoked (D13): `makeInvite()` runs on every call, never on the first only. A retry that finds
         * the invite already used or revoked has no code to show (the one made now was not kept), so it
         * answers a 409 `invite_used` or `invite_revoked` rather than a code that works for no one.
         */
        create: admin.social.invites.create.handler(async ({ context, input }) => {
          const made = makeInvite();
          const answer = await mapped('admin', () =>
            runner(context.account, { database: context.pool })(async (tx) =>
              answerOf(
                (
                  await tx.query(
                    'select social.admin_create_invite($1, $2, $3, $4, $5, $6, $7) as answer',
                    [
                      input.requestId,
                      input.email,
                      input.note ?? null,
                      input.house ?? null,
                      input.listed ?? null,
                      made.hash,
                      made.shown,
                    ],
                  )
                ).rows,
              ),
            ),
          );
          const { invite } = camelKeys<{ invite: social.Invite & { revokedReason?: unknown } }>(
            answer,
          );
          // The retry found its invite closed: the code made now was not kept, so none is shown. A retry
          // can never change that, so it is not a `clash` (which says "try again").
          if (invite.usedAt !== null || invite.revokedAt !== null) {
            const used = invite.usedAt !== null;
            throw new ORPCError('CONFLICT', {
              status: 409,
              message: `This invite was already ${used ? 'used by an agent' : 'revoked'}, so its code can't be shown again: make a new invite`,
              data: { reason: used ? 'invite_used' : 'invite_revoked' },
            });
          }
          // Open, but not under the code made now: something else changed it at the same moment.
          if (invite.codeShown !== made.shown) {
            throw new ORPCError('CONFLICT', {
              status: 409,
              message: 'Something else changed this invite at the same moment: try again',
              data: { reason: 'clash' },
            });
          }
          const { revokedReason: _kept, ...shown } = invite;
          return {
            invite: shown,
            code: made.code,
            message: readyMessage(originOf(context.url), made.code, invite.email),
          };
        }),
        revoke: admin.social.invites.revoke.handler(notBuilt),
      },
      stories: {
        list: admin.social.stories.list.handler(notBuilt),
        /**
         * A test story: the agreement's own check, then `social.admin_save_story` in one transaction
         * (D4). The code refuses first where test stories are never allowed (production); the database
         * refuses again until its own flag is on. What the database raises at commit is mapped by
         * constraint name, like what the statement raises.
         *
         * R5: a console save is a rare write, so it purges its own tags at once (D6 and the caching
         * map): when the board's reads go live, add here the purge of `social:story:<id>` and
         * `social:board` (`invalidateByTag`) for a save that was `new` or `changed`. Nothing is kept at
         * the edge for it yet, so nothing is purged now.
         */
        save: admin.social.stories.save.handler(async ({ context, input }) => {
          if (!testStoriesEnabled()) throw noSuchCall();
          const run = runner(context.account, { database: context.pool });
          const result = await mapped('admin', () =>
            saveStory(input.record, { run, fn: 'social.admin_save_story', listed: input.listed }),
          );
          if (!result.ok) throw saveFailure(result);
          return camelKeys<social.ConsoleStory>(result.answer);
        }),
      },
      updates: {
        /**
         * An update of a story, the same way, through `social.admin_save_update`. R5 adds the purge of
         * the update's story (`social:story:<storyId>`, `social:board`) when the board's reads go live,
         * as for a story's save.
         */
        save: admin.social.updates.save.handler(async ({ context, input }) => {
          if (!testStoriesEnabled()) throw noSuchCall();
          const run = runner(context.account, { database: context.pool });
          const result = await mapped('admin', () =>
            saveUpdate(input.record, { run, fn: 'social.admin_save_update' }),
          );
          if (!result.ok) throw saveFailure(result);
          return camelKeys<social.ConsoleUpdate>(result.answer);
        }),
      },
      settings: {
        get: admin.social.settings.get.handler(notBuilt),
        set: admin.social.settings.set.handler(notBuilt),
      },
      agents: {
        list: admin.social.agents.list.handler(notBuilt),
        set: admin.social.agents.set.handler(notBuilt),
        revokeKeys: admin.social.agents.revokeKeys.handler(notBuilt),
      },
    },
  },
};
