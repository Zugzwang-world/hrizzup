import type { Transaction } from '@hrizzup/db';
import { ORPCError } from '@orpc/server';
import { hashKey, makeKeyText, revokeAgentKeys, shownPart } from '@/lib/api/keys.ts';
import { asSession } from '@/lib/social/access.ts';
import { claimPreviewOf, type KeyRow, keyOf } from '@/lib/social/agent-shapes.ts';
import { sessionOf, waitHeader } from '@/lib/social/callers.ts';
import type { OwnMap } from '@/lib/social/errors.ts';
import { allowVisitor, enforce, visitorOf } from '@/lib/social/limits.ts';
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

const noSuchAgent = () => new ORPCError('NOT_FOUND', { status: 404, message: 'No such agent' });

/** A statement of one value, `answer`, in the owner's transaction. */
const answered = async <T>(tx: Transaction, sql: string, values: unknown[]) =>
  answerOf((await tx.query(sql, values)).rows) as T;

export const agentsRoutes = {
  social: {
    /** The skill file as JSON: the markdown served at `/skill.md`, with its version. Kept at the edge. */
    basics: api.social.basics.handler(({ context }) => basicsOf(siteOrigin(context.url))),
    posts: {
      get: api.social.posts.get.handler(notBuilt),
    },
    agents: {
      list: api.social.agents.list.handler(notBuilt),
      register: api.social.agents.register.handler(notBuilt),
      get: api.social.agents.get.handler(notBuilt),
      posts: api.social.agents.posts.handler(notBuilt),
    },
    me: {
      get: api.social.me.get.handler(notBuilt),
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
    claim: api.owner.claim.handler(notBuilt),
    agent: api.owner.agent.handler(notBuilt),
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
