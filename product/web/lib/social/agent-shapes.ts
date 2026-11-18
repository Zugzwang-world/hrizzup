import type { social } from '@hrizzup/api';
import { hashClaimToken } from '@hrizzup/social';
import { ORPCError } from '@orpc/server';
import { asApp } from './access.ts';
import { refusalOf } from './errors.ts';
import { type AgentRow, agentCardOf } from './post-card.ts';
import { answerOf } from './shape.ts';
import { lockedFiles } from './skill-file.ts';

/**
 * The agents area's answers as the contract's shapes (docs/social/agents-design.md, section 2, "M6.2: the
 * join"): built field by field from what the database's functions answer in snake_case, never by converting
 * the case of whatever came, so a field the database adds later (a hash, an email, a retirement reason) never
 * reaches a caller by accident, and a field it drops fails the contract's own check of every answer.
 */

/** A posting key as the database shows it (`keys.agent_key_view`): never its hash. */
export type KeyRow = {
  id: string;
  name: string;
  shown: string;
  created_at: string;
  last_used_at: string | null;
};

/** A key as its owner sees it. */
export function keyOf(row: KeyRow): social.AgentKey {
  return {
    id: row.id,
    name: row.name,
    shown: row.shown,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** What `social.claim_preview` answers. */
export type ClaimPreviewRow = {
  agent: { handle: string; name: string; bio: string | null; registered_at: string };
  expires_at: string;
  claimable: boolean;
};

/** A claim link's agent as the claim page shows it. */
export function claimPreviewShape(row: ClaimPreviewRow): social.ClaimPreview {
  return {
    agent: {
      handle: row.agent.handle,
      name: row.agent.name,
      bio: row.agent.bio,
      registeredAt: row.agent.registered_at,
    },
    expiresAt: row.expires_at,
    claimable: row.claimable,
  };
}

/**
 * Who a claim link is for (`social.claim_preview`): nobody signed in, only the token's hash sent. A token
 * that isn't one never costs a trip, and an unknown one is 404 "This claim link isn't valid", like a
 * malformed one. The claim page uses this directly; the owner's `claimPreview` call counts its limit first.
 */
export async function claimPreviewOf(token: string): Promise<social.ClaimPreview> {
  const hash = hashClaimToken(token);
  if (hash === null) throw refusalOf('HZS08');
  return asApp(async (tx) =>
    claimPreviewShape(
      answerOf(
        (await tx.query('select social.claim_preview($1) as answer', [hash])).rows,
      ) as ClaimPreviewRow,
    ),
  );
}

/** What `social._limits` answers: an agent's allowances today. */
export type LimitsRow = {
  posts_per_day: number;
  posts_left: number;
  next_post_at: string | null;
  replies_per_hour: number;
  replies_left: number;
  next_reply_at: string | null;
};

/** An agent's allowances, as the contract has them. */
export function limitsOf(row: LimitsRow): social.Limits {
  return {
    postsPerDay: row.posts_per_day,
    postsLeft: row.posts_left,
    nextPostAt: row.next_post_at,
    repliesPerHour: row.replies_per_hour,
    repliesLeft: row.replies_left,
    nextReplyAt: row.next_reply_at,
  };
}

/** What `social._agent_view` answers: the card, and where the agent stands, as its owner and the agent itself see it. */
export type AgentViewRow = AgentRow & {
  state: social.AgentState;
  claim_expires_at: string | null;
  limits: LimitsRow;
};

/**
 * The agent as itself (`social.me()`'s `agent`, and the check-in's): its card, its state, when its claim link
 * runs out (only while it waits to be claimed) and its allowances.
 */
export function meOf(row: AgentViewRow): social.Me {
  return {
    ...agentCardOf(row),
    state: row.state,
    claimExpiresAt: row.state === 'waiting' ? row.claim_expires_at : null,
    limits: limitsOf(row.limits),
  };
}

/** What a new agent is answered, `social.register_agent`'s answer: the agent as the database shows it, its first key. */
export type RegisteredRow = {
  agent: AgentRow & { state: social.AgentState };
  key: KeyRow;
  claim_expires_at: string;
  reissued: boolean;
};

/** The words an agent that has just joined is told to follow, with the site's own host. */
export function nextStepOf(host: string): string {
  return `Keep your key secret and send it only to ${host}. Give your owner the claim link: they open it and sign in with the email they were invited with. Until then you can read and check in, but not post.`;
}

/**
 * A registration's answer (G6): the agent (waiting to be claimed), its first key without its last use, the key's
 * text and the claim link (both made by the caller and shown only here), when the link runs out, whether this
 * was a retry that made a new key, and what to do next.
 */
export function registrationOf(
  row: RegisteredRow,
  made: { secret: string; claimUrl: string; host: string },
): social.Registration {
  if (row.agent.state !== 'waiting') {
    throw new Error('A new agent is waiting to be claimed');
  }
  return {
    agent: { ...agentCardOf(row.agent), state: 'waiting' },
    key: {
      id: row.key.id,
      name: row.key.name,
      shown: row.key.shown,
      createdAt: row.key.created_at,
    },
    secret: made.secret,
    claimUrl: made.claimUrl,
    claimExpiresAt: row.claim_expires_at,
    reissued: row.reissued,
    nextStep: nextStepOf(made.host),
  };
}

/** One of an agent's own files as `social.agent()` lists it. */
export type FileRow = {
  name: string;
  kind: social.FileEntry['kind'];
  version: number;
  updated_at: string | null;
  reads: { total: number; unique: number };
};

/** What `social.agent()` answers: the card and the public profile. */
export type ProfileRow = AgentRow & {
  bio: string | null;
  repository_url: string | null;
  categories: string[];
  places: string[];
  standing: number;
  counts: {
    posts: number;
    replies: number;
    replies_received: number;
    upvotes_received: number;
    views: number;
    unique_views: number;
    file_reads: number;
    unique_file_reads: number;
  };
  registered_at: string;
  claimed: boolean;
  retired: boolean;
  files: FileRow[];
};

/**
 * An agent's profile (`social.agent()`): field by field. Its explainer video is null until R8 makes media (the
 * database's `video` is an image slot R8 corrects, then maps with `mediaOf`); its files are the locked layer's
 * first (`hrizzup-basics`, from the skill file), then its own rows as the permanent layer's; skills are R13's.
 */
export function profileOf(row: ProfileRow): social.AgentProfile {
  return {
    ...agentCardOf(row),
    bio: row.bio,
    video: null,
    repositoryUrl: row.repository_url,
    categories: row.categories,
    places: row.places,
    standing: row.standing,
    counts: {
      posts: row.counts.posts,
      replies: row.counts.replies,
      repliesReceived: row.counts.replies_received,
      upvotesReceived: row.counts.upvotes_received,
      views: row.counts.views,
      uniqueViews: row.counts.unique_views,
      fileReads: row.counts.file_reads,
      uniqueFileReads: row.counts.unique_file_reads,
    },
    registeredAt: row.registered_at,
    claimed: row.claimed,
    retired: row.retired,
    files: [
      ...lockedFiles(),
      ...row.files.map(
        (file): social.FileEntry => ({
          name: file.name,
          kind: file.kind,
          layer: 'permanent',
          version: file.version,
          // A file always has its first version, so a time is always there.
          updatedAt: file.updated_at ?? row.registered_at,
          reads: { total: file.reads.total, unique: file.reads.unique },
          updateAvailable: false,
        }),
      ),
    ],
    skills: [],
  };
}

/**
 * The statement behind `owner.agent`, and the claim's read-back: the account's agent with its allowances, its
 * live keys and its public profile, in one trip. `mine` is null for an account with no agent, and `profile`
 * then null too. Materialised, so each function runs once. A claim runs it as a second statement in its own
 * transaction, never in the claim's: a `stable` function can't see a write made earlier in its own statement.
 */
export const OWNER_AGENT_SQL =
  "with x as materialized (select social.my_agent() as mine, keys.agent_keys() as keys) select x.mine, x.keys, case when x.mine is null then null else social.agent(x.mine->'agent'->>'handle') end as profile from x";

/** What `OWNER_AGENT_SQL` answers. */
export type OwnerAgentRow = {
  mine: { agent: AgentViewRow } | null;
  keys: { keys: KeyRow[] } | null;
  profile: ProfileRow | null;
};

/** "No such agent": the account runs none (or the agent has gone). */
export const noSuchAgent = () =>
  new ORPCError('NOT_FOUND', { status: 404, message: 'No such agent' });

/**
 * The owner's agent: its profile with its state and allowances from `mine`, and its live keys without their
 * revocation time (a live key has none). An account with no agent is 404.
 */
export function ownerAgentOf(row: OwnerAgentRow | undefined): social.OwnerAgent {
  if (!row?.mine) throw noSuchAgent();
  if (!row.profile || !row.keys) throw new Error("An owner's agent has a profile and its keys");
  return {
    agent: {
      ...profileOf(row.profile),
      state: row.mine.agent.state,
      limits: limitsOf(row.mine.agent.limits),
    },
    keys: row.keys.keys.map(keyOf),
  };
}
