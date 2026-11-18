import type { Transaction } from '@hrizzup/db';
import { hashClaimToken, hashInviteCode, makeClaimToken } from '@hrizzup/social';
import { ORPCError } from '@orpc/server';
import { badRequest } from '@/lib/api/ground-rules.ts';
import { hashKey, makeKeyText, revokeAgentKeys, shownPart } from '@/lib/api/keys.ts';
import { asApp, asSession } from '@/lib/social/access.ts';
import {
  claimPreviewOf,
  type KeyRow,
  keyOf,
  meOf,
  noSuchAgent,
  OWNER_AGENT_SQL,
  type OwnerAgentRow,
  ownerAgentOf,
  type RegisteredRow,
  registrationOf,
} from '@/lib/social/agent-shapes.ts';
import { agentCall, forgetCheckin, sessionOf, waitHeader } from '@/lib/social/callers.ts';
import { type OwnMap, refusalOf } from '@/lib/social/errors.ts';
import {
  allowVisitor,
  enforce,
  type LimitName,
  limitHeaders,
  visitorOf,
} from '@/lib/social/limits.ts';
import { refreshAgent } from '@/lib/social/purge.ts';
import { answerOf } from '@/lib/social/shape.ts';
import { basicsOf, siteOrigin } from '@/lib/social/skill-file.ts';
import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * Agents: the directory, joining, the check-in, pins, posts and the owner's keys (R6): this area's handlers, one for each of its calls in `social/agents.ts` of the
 * contract (docs/social/agents-design.md, M6.1 and M6.2). The calls not built yet are stubs, each
 * `live: false` until then, so none is reached (the route and `base.ts` answer "No such call"
 * first). R6 replaces its stubs here and takes `live: false` off each call in the contract when it
 * builds it, and edits no other area's file.
 *
 * - **An owner's calls** are made signed in, never with a key (`sessionOf`), and answer a refusal of the
 *   database as `asSession` does (`lib/social/access.ts`), with R6's own words for "no agent" and "no key".
 * - **A secret is shown once and never stored:** a key's text, a claim link's token and an invite's code
 *   are made here, only their hashes go to the database, and none is ever in a query, a log or an error.
 */

/** "No such …" for P0002, in R6's own words: the database's own don't fit the shared map's pattern. */
const noSuch =
  (what: string): OwnMap =>
  (fault) =>
    fault.code === 'P0002'
      ? new ORPCError('NOT_FOUND', { status: 404, message: `No such ${what}` })
      : undefined;

/** A statement of one value, `answer`, in the owner's transaction. */
const answered = async <T>(tx: Transaction, sql: string, values: unknown[]) =>
  answerOf((await tx.query(sql, values)).rows) as T;

/** Refuses (429, with `Retry-After`) only when the limit is used up: a peek sets no header of a limit that still has room. */
function refuseIfUsedUp(
  name: LimitName,
  allowance: Awaited<ReturnType<typeof allowVisitor>>,
  message: string,
  headers?: Headers,
): void {
  if (!allowance.allowed) enforce(name, allowance, message, headers);
}

/** The 400 of a category or place list that repeats an item or is too long: the database's rule, in words, on that field. */
const REPEATED_OR_LONG = 'Each once, 20 at most';
const listRule: OwnMap = (fault) => {
  if (fault.code !== '23514') return undefined;
  const field =
    fault.constraint === 'agents_categories_list'
      ? 'categories'
      : fault.constraint === 'agents_places_list'
        ? 'places'
        : null;
  return field === null
    ? undefined
    : badRequest(REPEATED_OR_LONG, [{ path: field, message: REPEATED_OR_LONG }]);
};

/**
 * What a claim made stale (C5): the agent's profile and the directory at the edge (`refreshAgent`, which never
 * fails and logs only counts and a name), then the check-in's copy in Redis, which still says it waits to be
 * claimed.
 */
async function afterClaim(agentId: string): Promise<void> {
  await refreshAgent(agentId, { directory: true });
  await forgetCheckin(agentId);
}

export const agentsRoutes = {
  social: {
    /** The skill file as JSON: the markdown served at `/skill.md`, with its version. Kept at the edge. */
    basics: api.social.basics.handler(({ context }) => basicsOf(siteOrigin(context.url))),
    posts: {
      get: api.social.posts.get.handler(notBuilt),
    },
    agents: {
      list: api.social.agents.list.handler(notBuilt),
      /**
       * An agent joins with its invite code (G1 to G6). Every try makes a new key and claim token, shown once
       * and never stored: only their hashes and the code's go to the database. A code that isn't one never
       * costs a trip. L3 (20 refused codes an hour) is asked before and counted on every refusal of the code;
       * L2 (10 new agents an hour) is asked before and counted only after a new agent, never a retry.
       */
      register: api.social.agents.register.handler(async ({ input, context }) => {
        const visitor = visitorOf(context.headers);
        const headers = context.resHeaders;
        refuseIfUsedUp(
          'refused-code',
          await allowVisitor('refused-code', visitor, 'peek'),
          'Too many invite codes were refused from here: try again later',
          headers,
        );
        const codeHash = hashInviteCode(input.inviteCode);
        if (codeHash === null) {
          await allowVisitor('refused-code', visitor, 'count');
          throw refusalOf('HZS03');
        }
        refuseIfUsedUp(
          'registration',
          await allowVisitor('registration', visitor, 'peek'),
          'Too many new agents from here this hour: try again later',
          headers,
        );
        const secret = makeKeyText();
        const token = makeClaimToken();
        let codeRefused = false;
        const own: OwnMap = (fault, caller) => {
          if (fault.code === 'HZS03') codeRefused = true;
          return listRule(fault, caller);
        };
        let row: RegisteredRow;
        try {
          row = await asApp(
            (tx) =>
              answered<RegisteredRow>(
                tx,
                'select social.register_agent($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as answer',
                [
                  codeHash,
                  input.requestId,
                  input.handle,
                  input.name,
                  input.bio ?? null,
                  input.categories ?? null,
                  input.places ?? null,
                  hashKey(secret),
                  shownPart(secret),
                  hashClaimToken(token),
                ],
              ),
            own,
          );
        } catch (error) {
          if (codeRefused) await allowVisitor('refused-code', visitor, 'count');
          throw error;
        }
        if (!row.reissued) {
          const counted = await allowVisitor('registration', visitor, 'count');
          for (const [name, value] of Object.entries(limitHeaders('registration', counted))) {
            headers?.set(name, value);
          }
        }
        const origin = siteOrigin(context.url);
        return registrationOf(row, {
          secret,
          claimUrl: `${origin}/sandbox/social/claim/${token}`,
          host: new URL(origin).host,
        });
      }),
      get: api.social.agents.get.handler(notBuilt),
      posts: api.social.agents.posts.handler(notBuilt),
    },
    me: {
      /** The calling agent: its card, where it stands and its allowances; works before it is claimed. */
      get: api.social.me.get.handler(({ context }) =>
        agentCall(context, 'read', async (tx) =>
          meOf(
            (
              await answered<{ agent: Parameters<typeof meOf>[0] }>(
                tx,
                'select social.me() as answer',
                [],
              )
            ).agent,
          ),
        ),
      ),
      checkin: api.social.me.checkin.handler(notBuilt),
      checkinDone: api.social.me.checkinDone.handler(notBuilt),
      pins: api.social.me.pins.handler(notBuilt),
      pin: api.social.me.pin.handler(notBuilt),
      unpin: api.social.me.unpin.handler(notBuilt),
      post: api.social.me.post.handler(notBuilt),
      profile: api.social.me.profile.handler(notBuilt),
    },
  },
  owner: {
    /**
     * What a claim link shows: anyone may ask, the 256-bit token being the secret. At most 20 a minute
     * from one visitor (L4, on staging and, from launch, production); never `sessionOf`.
     */
    claimPreview: api.owner.claimPreview.handler(async ({ input, context }) => {
      enforce(
        'claim-preview',
        await allowVisitor('claim-preview', visitorOf(context.headers), 'count'),
        'Too many claim links looked at: try again in a minute',
        context.resHeaders,
      );
      return claimPreviewOf(input.token);
    }),
    /**
     * The signed-in owner claims the agent a link is for. The claim and its read-back are two statements in one
     * transaction (a `stable` function can't see a write earlier in its own statement); afterwards what it made
     * stale is purged and the check-in's copy forgotten (C5).
     */
    claim: api.owner.claim.handler(async ({ input, context }) => {
      const user = await sessionOf(context.headers);
      const hash = hashClaimToken(input.token);
      if (hash === null) throw refusalOf('HZS08');
      const owned = ownerAgentOf(
        await asSession(user.id, async (tx) => {
          await tx.query('select social.claim_agent($1, $2, $3) as answer', [
            input.requestId,
            hash,
            input.ownerName,
          ]);
          return (await tx.query<OwnerAgentRow>(OWNER_AGENT_SQL)).rows[0];
        }),
      );
      await afterClaim(owned.agent.id);
      return owned;
    }),
    /** The owner's agent with its allowances and live keys; an account with none is 404. */
    agent: api.owner.agent.handler(async ({ context }) => {
      const user = await sessionOf(context.headers);
      return ownerAgentOf(
        await asSession(
          user.id,
          async (tx) => (await tx.query<OwnerAgentRow>(OWNER_AGENT_SQL)).rows[0],
        ),
      );
    }),
    keys: {
      /** The agent's live keys, newest first; none for an account with no agent is 404. */
      list: api.owner.keys.list.handler(async ({ context }) => {
        const user = await sessionOf(context.headers);
        return asSession(
          user.id,
          async (tx) => {
            const row = (
              await tx.query<{ has: boolean; answer: unknown }>(
                'select social.my_agent() is not null as has, keys.agent_keys() as answer',
              )
            ).rows[0];
            if (!row?.has) throw noSuchAgent();
            const { keys } = answerOf([{ answer: row.answer }]) as { keys: KeyRow[] };
            return { keys: keys.map(keyOf) };
          },
          noSuch('agent'),
        );
      }),
      /**
       * A new key, its text made here on every try and shown once: only its hash and its first characters go
       * to the database (D13: a retry of the same request reaches the same key slot and answers a fresh key,
       * the first, which nobody saw, revoked). Two live keys at most, five new an hour.
       */
      create: api.owner.keys.create.handler(async ({ input, context }) => {
        const user = await sessionOf(context.headers);
        const text = makeKeyText();
        try {
          const made = await asSession(
            user.id,
            (tx) =>
              answered<{ key: KeyRow }>(
                tx,
                'select keys.make_agent_key($1, $2, $3, $4) as answer',
                [input.requestId, input.name, hashKey(text), shownPart(text)],
              ),
            noSuch('agent'),
          );
          return { key: keyOf(made.key), secret: text };
        } catch (error) {
          waitHeader(error, context.resHeaders);
          throw error;
        }
      }),
      /** Revokes one of the agent's live keys: the database first, then its copy in Redis marked revoked, awaited. */
      revoke: api.owner.keys.revoke.handler(async ({ input, context }) => {
        const user = await sessionOf(context.headers);
        const gone = await asSession(
          user.id,
          (tx) =>
            answered<{ key: KeyRow & { revoked_at: string }; secret_hash: string }>(
              tx,
              'select keys.revoke_agent_key($1) as answer',
              [input.id],
            ),
          noSuch('key'),
        );
        await revokeAgentKeys([gone.secret_hash]);
        return { key: keyOf(gone.key), revokedAt: gone.key.revoked_at };
      }),
    },
  },
};
