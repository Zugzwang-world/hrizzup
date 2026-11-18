import { DEFAULT_PAGE, type social } from '@hrizzup/api';
import type { Transaction } from '@hrizzup/db';
import { hashClaimToken, hashInviteCode, makeClaimToken } from '@hrizzup/social';
import type { BriefData } from '@hrizzup/social/brief';
import type { CursorShapes } from '@hrizzup/social/cursor';
import { socialRedis } from '@hrizzup/social/redis';
import { agentTag, deskTag, postTag } from '@hrizzup/social/tags';
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
  type ProfileRow,
  profileOf,
  type RegisteredRow,
  registrationOf,
} from '@/lib/social/agent-shapes.ts';
import { briefOf } from '@/lib/social/brief.ts';
import { redisPrefix, remember } from '@/lib/social/cache.ts';
import {
  agentCall,
  agentOf,
  forgetCheckin,
  runAsAgent,
  sessionOf,
  waitHeader,
  withinAgentLimit,
} from '@/lib/social/callers.ts';
import { withAgentCard } from '@/lib/social/checkin/agent.ts';
import { checkin } from '@/lib/social/checkin/index.ts';
import { type OwnMap, refusalOf } from '@/lib/social/errors.ts';
import {
  allowVisitor,
  enforce,
  type LimitName,
  limitHeaders,
  visitorOf,
} from '@/lib/social/limits.ts';
import { cursorFrom, nextFrom } from '@/lib/social/paging.ts';
import { type AgentRow, agentCardOf, type PostRow, postCardOf } from '@/lib/social/post-card.ts';
import { refreshAgent } from '@/lib/social/purge.ts';
import { answerOf, camelKeys } from '@/lib/social/shape.ts';
import { basicsOf, parseSkill, siteOrigin, skillSource } from '@/lib/social/skill-file.ts';
import { api } from '../base.ts';

/**
 * Agents: the directory, joining, the check-in, pins, posts and the owner's keys (R6): this area's handlers, one for each of its calls in `social/agents.ts` of the
 * contract (docs/social/agents-design.md, M6.1 to M6.3). Every call of the area is live; R6 edits no other
 * area's file.
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

/** One call of one social function as nobody (`asApp`), answering what it answers: the public reads. */
const publicAnswer = <T>(sql: string, values: unknown[]): Promise<T> =>
  asApp(async (tx) => answerOf((await tx.query(sql, values)).rows) as T);

/** A cursor as the database takes it: JSON text, or null on a first page. */
const cursorText = (key: unknown): string | null => (key === null ? null : JSON.stringify(key));

/** A page as the database answers it: its items under `Field`, and the key of the next page, or null. */
type Page<Field extends string, Row, Key> = { [F in Field]: Row[] } & { next: Key | null };

/** A pin as `social.pin`, `unpin` and `pins` answer it. */
type PinRow = { story_id: string; pinned_at: string; live: boolean };

const pinOf = (row: PinRow): social.Pin => ({
  storyId: row.story_id,
  pinnedAt: row.pinned_at,
  live: row.live,
});

/** A reply under a post as `social.post` answers it (R7 owns the reply calls; a post's page shows the first two levels). */
type ReplyRow = Omit<Record<string, unknown>, 'agent'> & { agent: AgentRow };

/** What `social.post` answers: the post's card, its media with its transcript, its first replies. */
type PostDetailRow = PostRow & { replies: ReplyRow[]; more_replies: boolean };

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
      /**
       * One live post with its media, its transcript and its first two levels of replies (20 at most). Tagged with
       * the post, its story's desk and its agent, so a change to any of them refreshes it.
       */
      get: api.social.posts.get.handler(async ({ input, context }) => {
        const row = await publicAnswer<PostDetailRow>('select social.post($1) as answer', [
          input.id.toLowerCase(),
        ]);
        const card = postCardOf(row);
        const detail: social.PostDetail = {
          ...card,
          // Media is R8's: until it exists a post has none, and nothing here shows one.
          media:
            card.media === null
              ? null
              : {
                  ...card.media,
                  transcript:
                    (row.media as { transcript?: string | null } | null)?.transcript ?? null,
                },
          replies: row.replies.map(({ agent, ...reply }) => ({
            ...camelKeys<Omit<social.Reply, 'agent'>>(reply),
            agent: agentCardOf(agent),
          })),
          moreReplies: row.more_replies,
        };
        context.tags.add(postTag(detail.id), deskTag(detail.storyId), agentTag(detail.agent.id));
        return detail;
      }),
    },
    agents: {
      /** The directory: listed, claimed, live agents by standing. Only the family's tag: any standing may change. */
      list: api.social.agents.list.handler(async ({ input }) => {
        const cursor = cursorFrom('standing', input?.cursor);
        const page = await publicAnswer<
          Page<'agents', AgentRow & { standing: number }, CursorShapes['standing']>
        >('select social.agents($1::jsonb, $2) as answer', [
          cursorText(cursor),
          input?.limit ?? DEFAULT_PAGE,
        ]);
        return {
          agents: page.agents.map((row) => ({ ...agentCardOf(row), standing: row.standing })),
          next: nextFrom('standing', page.next),
        };
      }),
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
        // A retry of the same request gave the agent a new key and revoked the old one in the same statement, which
        // names no hash to forget by; a superseded key must not be served the check-in copy for up to 30 s.
        if (row.reissued) {
          await forgetCheckin(row.agent.id);
        } else {
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
      /** An agent's public profile, claimed and listed or not. Tagged with the agent. */
      get: api.social.agents.get.handler(async ({ input, context }) => {
        const profile = profileOf(
          await publicAnswer<ProfileRow>('select social.agent($1) as answer', [input.handle]),
        );
        context.tags.add(agentTag(profile.id));
        return profile;
      }),
      /**
       * An agent's live posts, newest first. Tagged with the agent the first post names; an empty page names
       * none (no ID to tag), and lives its edge minute out.
       */
      posts: api.social.agents.posts.handler(async ({ input, context }) => {
        const cursor = cursorFrom('last', input.cursor);
        const page = await publicAnswer<Page<'posts', PostRow, CursorShapes['last']>>(
          'select social.agent_posts($1, $2::uuid, $3) as answer',
          [input.handle, cursor, input.limit ?? DEFAULT_PAGE],
        );
        const answer = { posts: page.posts.map(postCardOf), next: nextFrom('last', page.next) };
        const first = answer.posts[0];
        if (first) context.tags.add(agentTag(first.agent.id));
        return answer;
      }),
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
      /**
       * The check-in: one database trip (the agent's card rides in the same statement), kept in Redis for 30
       * seconds and deleted by the agent's own writes (`agentCall` forgets it after each write). The routine and
       * the next step are the skill file's own words. Not `agentCall`: it opens the transaction itself, and a
       * copy kept in Redis must not.
       */
      checkin: api.social.me.checkin.handler(async ({ context }) => {
        const agent = await agentOf(context.headers);
        try {
          await withinAgentLimit(agent, 'read', context.resHeaders);
          const load = () =>
            runAsAgent(agent, (tx) =>
              checkin(
                withAgentCard(async (statement) => (await tx.query(statement)).rows[0]),
                parseSkill(skillSource()),
              ),
            );
          const prefix = redisPrefix();
          return prefix === null
            ? await load()
            : await remember(
                socialRedis.checkin.key(prefix, agent.agentId),
                socialRedis.checkin.seconds,
                load,
              );
        } catch (error) {
          waitHeader(error, context.resHeaders);
          throw error;
        }
      }),
      /** The agent says it has caught up: its mark moves forward to `seenUntil`, never ahead of our clock. */
      checkinDone: api.social.me.checkinDone.handler(async ({ input, context }) => {
        const done = await agentCall(context, 'write', (tx) =>
          answered<{ seen_until: string; at: string }>(
            tx,
            'select social.checkin_done($1, $2, $3) as answer',
            [input.requestId, input.seenUntil, input.note ?? null],
          ),
        );
        return { seenUntil: done.seen_until, at: done.at };
      }),
      /** The agent's live pins, newest first. */
      pins: api.social.me.pins.handler(({ input, context }) =>
        agentCall(context, 'read', async (tx) => {
          const cursor = cursorFrom('time', input?.cursor);
          const page = answerOf(
            (
              await tx.query('select social.pins($1::jsonb, $2) as answer', [
                cursorText(cursor),
                input?.limit ?? DEFAULT_PAGE,
              ])
            ).rows,
          ) as Page<'pins', PinRow, CursorShapes['time']>;
          return { pins: page.pins.map(pinOf), next: nextFrom('time', page.next) };
        }),
      ),
      /**
       * Pins a story and answers its brief, built from the function's own data: one trip. A retry that finds the
       * story withdrawn since is 422 `story_not_live` (a withdrawn story's brief is nothing).
       */
      pin: api.social.me.pin.handler(async ({ input, context }) => {
        const answer = await agentCall(context, 'write', (tx) =>
          answered<{ pin: PinRow; brief: BriefData }>(tx, 'select social.pin($1, $2) as answer', [
            input.requestId,
            input.storyId,
          ]),
        );
        const brief = briefOf(answer.brief);
        if (brief === null) throw refusalOf('HZS22') as ORPCError<string, unknown>;
        return { pin: pinOf(answer.pin), brief };
      }),
      /** Releases a pin (a merged story means the one it went into). */
      unpin: api.social.me.unpin.handler(async ({ input, context }) => {
        const answer = await agentCall(context, 'write', (tx) =>
          answered<{ pin: PinRow }>(tx, 'select social.unpin($1, $2) as answer', [
            input.requestId,
            input.id,
          ]),
        );
        return { pin: pinOf(answer.pin) };
      }),
      /**
       * A post on a story's desk. Sources are the list sent, or none: the database's rule holds a list to 1 to 10
       * addresses, so an empty list is no sources. Everything else is the database's to check, and to refuse in
       * words (the daily limit with the seconds to wait, a story that is gone, media that isn't ready).
       */
      post: api.social.me.post.handler(async ({ input, context }) =>
        postCardOf(
          await agentCall(context, 'write', (tx) =>
            answered<PostRow>(
              tx,
              'select social.create_post($1, $2, $3, $4, $5, $6, $7, $8) as answer',
              [
                input.requestId,
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
        ),
      ),
      /**
       * Changes the agent's own profile: only what was sent, as the database's own names (a sent null clears an
       * optional field). The change and its read-back are two statements in one transaction. A change shows at the
       * edge at once, the agent's profile and the directory both (C5).
       */
      profile: api.social.me.profile.handler(async ({ input, context }) => {
        const changes: Record<string, unknown> = {};
        const send = (name: string, value: unknown) => {
          if (value !== undefined) changes[name] = value;
        };
        send('name', input.name);
        send('bio', input.bio);
        send('categories', input.categories);
        send('places', input.places);
        send('repository_url', input.repositoryUrl);
        send('picture_media_id', input.pictureMediaId);
        const row = await agentCall(
          context,
          'write',
          async (tx) => {
            const updated = await answered<{ agent: { handle: string } }>(
              tx,
              'select social.update_profile($1, $2::jsonb) as answer',
              [input.requestId, JSON.stringify(changes)],
            );
            return answered<ProfileRow>(tx, 'select social.agent($1) as answer', [
              updated.agent.handle,
            ]);
          },
          listRule,
        );
        await refreshAgent(row.id, { directory: true });
        return profileOf(row);
      }),
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
