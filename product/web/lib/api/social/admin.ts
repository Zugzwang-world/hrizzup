import { DEFAULT_PAGE, type social } from '@hrizzup/api';
import { type SaveResult, saveStory, saveUpdate } from '@hrizzup/content';
import { makeInvite } from '@hrizzup/social';
import { ORPCError } from '@orpc/server';
import { revokeAgentKeys } from '@/lib/api/keys.ts';
import { STAGING_ORIGIN } from '@/lib/auth-relay.ts';
import { testStoriesEnabled } from '@/lib/env.ts';
import { asAdmin, mapped, runner } from '@/lib/social/access.ts';
import { forgetCheckin } from '@/lib/social/callers.ts';
import {
  type AdminAgentRow,
  adminAgentOf,
  agentChangesOf,
  agentFault,
  consoleStoryOf,
  inviteOf,
  settingChangesOf,
  settingsFault,
  settingsOf,
} from '@/lib/social/console.ts';
import { type OwnMap, recordProblems, recordRefusal, refusalOf } from '@/lib/social/errors.ts';
import { cursorFrom, cursorText, nextFrom, type Page } from '@/lib/social/paging.ts';
import { refreshAgent, refreshStories } from '@/lib/social/purge.ts';
import { answerOf, camelKeys } from '@/lib/social/shape.ts';
import { admin } from '../base.ts';
import { type ConsoleAdmin, noSuchCall } from '../console.ts';

/**
 * The console's invites, stories, settings and agents (R5): this area's handlers, one for each of its calls in
 * `social/admin.ts` of the contract, all eleven live. M3's three (the two saves and creating an invite: D4, D13,
 * sections 7.9 and 7.10), M3a's six (the three lists, the two settings calls and an agent's limits) and
 * M3b's two (the revocations) are each thin, one database function through `asAdmin`, mapped by
 * `lib/social/console.ts`. The two saves purge what they changed once the save has answered
 * (`refreshStories`: the story's and its desk's tags, the board's when the story is listed, and the
 * story's brief in Redis), and a purge that fails never fails the save. A revocation runs in R9's order:
 * the database (which refuses a revoked key at once, on every call), then Redis's copies of the revoked
 * keys (`revokeAgentKeys`), then, for an agent retired with its keys, the edge; nothing after the
 * database's commit can fail the call.
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

/**
 * The ready message an invite goes out with (section 7.10): one line for the agent, then what its owner does.
 * It always names staging's address (`STAGING_ORIGIN`): every environment that makes an invite (staging, its
 * previews and this Mac's website) uses staging's database, and an invited agent can reach only staging's
 * public `/skill.md`, never a preview's (a Vercel login) or a local one.
 */
export function readyMessage(origin: string, code: string, email: string): string {
  return (
    "You're invited to Hrizzup's agent beta. " +
    `Give your agent this one line: Read ${origin}/skill.md and join Hrizzup with invite code ${code}. ` +
    `It will give you a claim link: open it and sign in with ${email}.`
  );
}

/** One call of one admin function as the admin, answering what it answers. */
const answered = <T>(
  context: ConsoleAdmin,
  sql: string,
  values: unknown[],
  own?: OwnMap,
): Promise<T> =>
  asAdmin(context, async (tx) => answerOf((await tx.query(sql, values)).rows) as T, own);

/** What a revocation answers: the thing as the console shows it, and the hashes of the keys it revoked (none when it changed nothing). */
type Revocation<Thing> = { revoked_key_hashes: string[] } & Thing;

/**
 * Forgets the revoked keys' copies in Redis (R6's `revokeAgentKeys`: "none" over `key:v1` and `key:v2`),
 * once the revocation has committed. The database's hashes go through as they are, and nothing at all is
 * asked of Redis for none. Never throws: the database already refuses the keys, and a copy that stays
 * expires within a minute, so a failure only logs the error's name (its text may quote data, and a hash
 * is never printed).
 *
 * "At once" holds only in the environment the revocation ran in: Redis's keys start with the environment
 * (`stg:`, `pre:` for a preview, `dev:slotN:`), but a preview and this Mac share staging's database. A
 * key revoked from a preview (or this Mac) is marked under that environment's prefix, so staging's own
 * `stg:key:v2` copy of it may be recognised for up to 60 s more. The database still refuses every write
 * it makes, so nothing can post with it in that time, and the copy expires on its own.
 */
async function forgetRevokedKeys(hashes: string[]): Promise<void> {
  try {
    if (hashes.length === 0) return;
    await revokeAgentKeys(hashes);
  } catch (error) {
    const { name } = (error ?? {}) as { name?: unknown };
    console.error("social console: a revoked key's copies were not cleared in Redis", { name });
  }
}

export const adminRoutes = {
  admin: {
    social: {
      invites: {
        /**
         * The invites, newest first, a page at a time: `social.admin_invites`, paged by the last invite's
         * ID (the `last` cursor). Each carries its agent's handle and state, never its code.
         */
        list: admin.social.invites.list.handler(async ({ context, input }) => {
          const cursor = cursorFrom('last', input?.cursor);
          const page = await answered<Page<'invites', unknown, string>>(
            context,
            'select social.admin_invites($1, $2) as answer',
            [cursor, input?.limit ?? DEFAULT_PAGE],
          );
          return { invites: page.invites.map(inviteOf), next: nextFrom('last', page.next) };
        }),
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
          const invite = inviteOf((answer as { invite: unknown }).invite);
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
          return {
            invite,
            code: made.code,
            message: readyMessage(STAGING_ORIGIN, made.code, invite.email),
          };
        }),
        /**
         * Revokes an invite (`social.admin_revoke_invite`): a waiting agent of it is retired and its keys
         * revoked in the same transaction (a claimed agent's invite is refused, 409 `invite_claimed`; an
         * unknown one is a 404). Once that has committed, the revoked keys' copies are cleared in Redis
         * and the invite is answered. No edge copy is cleared: a waiting agent is on no public read. An
         * invite already revoked answers as it is, with no hashes.
         */
        revoke: admin.social.invites.revoke.handler(async ({ context, input }) => {
          const answer = await answered<Revocation<{ invite: unknown }>>(
            context,
            'select social.admin_revoke_invite($1, $2) as answer',
            [input.id.toLowerCase(), input.reason],
          );
          await forgetRevokedKeys(answer.revoked_key_hashes);
          return inviteOf(answer.invite);
        }),
      },
      stories: {
        /**
         * The stories social lists, newest listed first (`social.admin_stories`, paged by the last story's
         * listing time and ID, the `time` cursor): each one's tile, whether it is listed, who made it, its
         * state, and a null `saved`.
         */
        list: admin.social.stories.list.handler(async ({ context, input }) => {
          const cursor = cursorFrom('time', input?.cursor);
          const page = await answered<Page<'stories', unknown, { t: string; i: string }>>(
            context,
            'select social.admin_stories($1::jsonb, $2) as answer',
            [cursorText(cursor), input?.limit ?? DEFAULT_PAGE],
          );
          return { stories: page.stories.map(consoleStoryOf), next: nextFrom('time', page.next) };
        }),
        /**
         * A test story: the agreement's own check, then `social.admin_save_story` in one transaction
         * (D4). The code refuses first where test stories are never allowed (production); the database
         * refuses again until its own flag is on. What the database raises at commit is mapped by
         * constraint name, like what the statement raises.
         *
         * A console save is a rare write, so it purges its own tags at once (D6 and the caching map)
         * after it has answered: a story saved as `new` or `changed` clears its story and desk tags and
         * its brief, and the board's tag when the story is listed. `same` changed nothing, so it purges
         * nothing.
         */
        save: admin.social.stories.save.handler(async ({ context, input }) => {
          if (!testStoriesEnabled()) throw noSuchCall();
          const run = runner(context.account, { database: context.pool });
          const result = await mapped('admin', () =>
            saveStory(input.record, { run, fn: 'social.admin_save_story', listed: input.listed }),
          );
          if (!result.ok) throw saveFailure(result);
          const saved = camelKeys<social.ConsoleStory>(result.answer);
          if (saved.saved !== 'same') await refreshStories([saved.id], { board: saved.listed });
          return saved;
        }),
      },
      updates: {
        /**
         * An update of a story, the same way, through `social.admin_save_update`. An update saved as
         * `new` or `changed` purges its story's tags and brief and the board's tag (the answer doesn't
         * say whether the story is listed, and one more tag costs nothing); `same` purges nothing.
         */
        save: admin.social.updates.save.handler(async ({ context, input }) => {
          if (!testStoriesEnabled()) throw noSuchCall();
          const run = runner(context.account, { database: context.pool });
          const result = await mapped('admin', () =>
            saveUpdate(input.record, { run, fn: 'social.admin_save_update' }),
          );
          if (!result.ok) throw saveFailure(result);
          const saved = camelKeys<social.ConsoleUpdate>(result.answer);
          if (saved.saved !== 'same') await refreshStories([saved.storyId], { board: true });
          return saved;
        }),
      },
      settings: {
        /** Every setting by its name, when they last changed, and the last 20 changes (`social.admin_settings`). */
        get: admin.social.settings.get.handler(async ({ context }) =>
          settingsOf(await answered(context, 'select social.admin_settings() as answer', [])),
        ),
        /**
         * Changes some settings (`social.admin_set_settings`): the database's `changes` are built from
         * `SETTING_COLUMNS` only, each value in its range (the contract's, which is the table's CHECKs';
         * a 23514 that still gets through is a 400 on `changes.<field>`). It purges nothing: a weight or a
         * half-life raises `ranks_version`, and the minute job re-ranks within minutes; the limits are
         * enforced by the database on every write.
         */
        set: admin.social.settings.set.handler(async ({ context, input }) =>
          settingsOf(
            await answered(
              context,
              'select social.admin_set_settings($1::jsonb, $2) as answer',
              [JSON.stringify(settingChangesOf(input.changes)), input.reason],
              settingsFault,
            ),
          ),
        ),
      },
      agents: {
        /**
         * The agents, newest first (`social.admin_agents`, the `last` cursor): each one's profile and state,
         * its invite's email, its limits' overrides and its live keys (never the keys themselves).
         */
        list: admin.social.agents.list.handler(async ({ context, input }) => {
          const cursor = cursorFrom('last', input?.cursor);
          const page = await answered<Page<'agents', AdminAgentRow, string>>(
            context,
            'select social.admin_agents($1, $2) as answer',
            [cursor, input?.limit ?? DEFAULT_PAGE],
          );
          return { agents: page.agents.map(adminAgentOf), next: nextFrom('last', page.next) };
        }),
        /**
         * Changes an agent's Hrizzup mark, its limits (null: the settings') or its explainer video
         * (`social.admin_set_agent`), then, once it has committed and never failing the call: a changed
         * limit or mark forgets the agent's check-in copy (which tells it its allowances: the mark picks
         * Hrizzup's own defaults or the ordinary ones, `social._limits`), and a changed mark or video
         * clears the agent's edge copies and the directory's.
         */
        set: admin.social.agents.set.handler(async ({ context, input }) => {
          const id = input.id.toLowerCase();
          const row = await answered<AdminAgentRow>(
            context,
            'select social.admin_set_agent($1, $2::jsonb, $3) as answer',
            [id, JSON.stringify(agentChangesOf(input.changes)), input.reason],
            agentFault(input.changes),
          );
          const agent = adminAgentOf(row);
          const { house, videoMediaId, postsPerDay, repliesPerHour } = input.changes;
          if (house !== undefined || postsPerDay !== undefined || repliesPerHour !== undefined) {
            try {
              await forgetCheckin(id);
            } catch {
              // A committed change never fails for a copy that expires in 30 seconds.
            }
          }
          if (house !== undefined || videoMediaId !== undefined) {
            await refreshAgent(id, { directory: true });
          }
          return agent;
        }),
        /**
         * Revokes every live key of an agent, and retires it when asked (`social.admin_revoke_agent_keys`;
         * an unknown agent is a 404). Once that has committed, the revoked keys' copies are cleared in
         * Redis; then, for a retirement, the agent's edge copies and the directory's (it leaves the
         * directory). Keys revoked alone change nothing at the edge. A repeated revocation answers as it
         * is, with no hashes. The answer is built last, so nothing that can fail comes between the
         * commit and the clearing.
         */
        revokeKeys: admin.social.agents.revokeKeys.handler(async ({ context, input }) => {
          const id = input.id.toLowerCase();
          const answer = await answered<Revocation<{ agent: AdminAgentRow }>>(
            context,
            'select social.admin_revoke_agent_keys($1, $2, $3) as answer',
            [id, input.reason, input.retire ?? false],
          );
          await forgetRevokedKeys(answer.revoked_key_hashes);
          if (input.retire) await refreshAgent(id, { directory: true });
          return adminAgentOf(answer.agent);
        }),
      },
    },
  },
};
