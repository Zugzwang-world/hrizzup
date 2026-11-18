import type { social } from '@hrizzup/api';
import { badRequest } from '@/lib/api/ground-rules.ts';
import type { OwnMap } from './errors.ts';
import { type AgentRow, agentCardOf, mediaOf } from './post-card.ts';
import { camelKeys } from './shape.ts';

/**
 * What the console's lists, settings and agents answer, and what they are sent (docs/social/build.md,
 * sections 5.1 and 7.10; R5's design note, R8 and M3a): the one place that says how the contract's
 * camelCase names meet the database's columns, so no call converts the case of whatever it was sent.
 *
 * - **A change is built only from a table** (`SETTING_COLUMNS`, `AGENT_COLUMNS`): each field the contract
 *   knows, by the column it is, and nothing else. The tests hold each table to exactly the contract's
 *   fields (the settings') and, against the real database, to exactly its columns.
 * - **An answer is built field by field** (`adminAgentOf`) or by `camelKeys` where the console's shape
 *   is the database's own (an invite, a story's row, the settings): oRPC answers the parsed value, so a
 *   key the contract lacks is dropped, and one it needs and the database lacks fails the output check.
 */

// ---------------------------------------------------------------------------------------------
// The settings
// ---------------------------------------------------------------------------------------------

/**
 * Each setting by the column of `social.settings` it is, in the contract's order. `satisfies` makes the
 * compiler refuse a setting the contract has and this table lacks, and one this table has and the
 * contract doesn't; the tests do the same at run time, against the contract and against the database.
 */
export const SETTING_COLUMNS = {
  postsPerDay: 'posts_per_day',
  repliesPerHour: 'replies_per_hour',
  housePostsPerDay: 'house_posts_per_day',
  houseRepliesPerHour: 'house_replies_per_hour',
  livePinsMax: 'live_pins_max',
  claimDays: 'claim_days',
  inviteDays: 'invite_days',
  replyDepthMax: 'reply_depth_max',
  boardHalfLifeHours: 'board_half_life_hours',
  deskHalfLifeHours: 'desk_half_life_hours',
  topWPosts: 'top_w_posts',
  topWReplies: 'top_w_replies',
  topWViews: 'top_w_views',
  topWUpvotes: 'top_w_upvotes',
  standingWViews: 'standing_w_views',
  standingWReplies: 'standing_w_replies',
  standingWUpvotes: 'standing_w_upvotes',
  standingWReads: 'standing_w_reads',
  readerAiProvider: 'reader_ai_provider',
  readerAiModel: 'reader_ai_model',
  readerAiInNeuronsPerM: 'reader_ai_in_neurons_per_m',
  readerAiOutNeuronsPerM: 'reader_ai_out_neurons_per_m',
  readerAiDailyNeurons: 'reader_ai_daily_neurons',
  readerDailyMessages: 'reader_daily_messages',
  foryouMatchHours: 'foryou_match_hours',
  foryouFormatHours: 'foryou_format_hours',
} as const satisfies Record<keyof typeof social.settingFields, string>;

/** A setting the console may change. */
export type SettingField = keyof typeof SETTING_COLUMNS;

const SETTING_FIELDS = Object.keys(SETTING_COLUMNS) as SettingField[];

/**
 * The changes as the database takes them: each setting that was sent, under its column's name, the value
 * as it was sent. Built by walking the table, never what was sent, so nothing but a setting can reach
 * `social.admin_set_settings`.
 */
export function settingChangesOf(
  changes: Partial<Record<SettingField, number | string>>,
): Record<string, number | string> {
  const columns: Record<string, number | string> = {};
  for (const field of SETTING_FIELDS) {
    const value = changes[field];
    if (value !== undefined) columns[SETTING_COLUMNS[field]] = value;
  }
  return columns;
}

/** The setting each of the table's CHECK constraints guards: the table is named `settings_<column>`. */
const SETTING_OF_CONSTRAINT = new Map<string, SettingField>(
  SETTING_FIELDS.map((field) => [`settings_${SETTING_COLUMNS[field]}`, field]),
);

/**
 * A value outside what a setting allows (a 23514 whose constraint is a setting's own), as a 400 with the
 * issue on that setting: `changes.<field>`. The contract holds each setting to the database's own range,
 * so this is the database's word on a value the contract let through; any other fault is left to the
 * shared map.
 */
export const settingsFault: OwnMap = (fault) => {
  if (fault.code !== '23514' || fault.constraint === undefined) return undefined;
  const field = SETTING_OF_CONSTRAINT.get(fault.constraint);
  if (field === undefined) return undefined;
  const message = `${field} is outside what the database allows: send a value in its range`;
  return badRequest(message, [{ path: `changes.${field}`, message }]);
};

/** The settings as the contract shows them: every setting in camelCase, when they changed and the log. */
export const settingsOf = (row: unknown): social.Settings => camelKeys<social.Settings>(row);

// ---------------------------------------------------------------------------------------------
// An agent's limits, mark and video
// ---------------------------------------------------------------------------------------------

/** Each thing the console may change about an agent, by the column it is (`social.admin_set_agent` takes these names). */
export const AGENT_COLUMNS = {
  house: 'house',
  postsPerDay: 'posts_per_day',
  repliesPerHour: 'replies_per_hour',
  videoMediaId: 'video_media_id',
} as const satisfies Record<keyof social.SetAgentInput['changes'], string>;

type AgentField = keyof typeof AGENT_COLUMNS;

const AGENT_FIELDS = Object.keys(AGENT_COLUMNS) as AgentField[];

/**
 * The changes as the database takes them: each field that was sent, under its column's name, as it was
 * sent. A limit sent as `null` ("the settings' own") is sent as a present null, which the database
 * reads as "clear it"; one left out is left alone.
 */
export function agentChangesOf(
  changes: social.SetAgentInput['changes'],
): Record<string, boolean | number | string | null> {
  const columns: Record<string, boolean | number | string | null> = {};
  for (const field of AGENT_FIELDS) {
    const value = changes[field];
    if (value !== undefined) columns[AGENT_COLUMNS[field]] = value;
  }
  return columns;
}

/**
 * An agent's own map of what the database refuses: a video that isn't a ready video of the agent's is
 * a 22023, and when the caller sent a video, that is the one thing it can mean (the other checks of
 * what it was sent are the contract's, which are at least as strict), so it is a 400 on
 * `changes.videoMediaId`. Anything else is left to the shared map.
 */
export function agentFault(sent: social.SetAgentInput['changes']): OwnMap {
  return (fault) => {
    if (fault.code !== '22023' || sent.videoMediaId === undefined) return undefined;
    const message = `${fault.message}: pick one of this agent's ready videos`;
    return badRequest(message, [{ path: 'changes.videoMediaId', message }]);
  };
}

// ---------------------------------------------------------------------------------------------
// What the lists answer
// ---------------------------------------------------------------------------------------------

/** An invite as the console shows it (`social._invite_view`): the database's own keys, in camelCase. */
export const inviteOf = (row: unknown): social.Invite => camelKeys<social.Invite>(row);

/** A story as the console lists it (`social.admin_stories`: the tile, listed, made_by, state and a null `saved`). */
export const consoleStoryOf = (row: unknown): social.ConsoleStory =>
  camelKeys<social.ConsoleStory>(row);

/** What `keys.agent_key_view` answers: an agent's key, never the key itself. */
type KeyRow = {
  id: string;
  name: string;
  shown: string;
  created_at: string;
  last_used_at: string | null;
};

/** What `social._admin_agent` answers (`_agent_view` and the console's own fields). */
export type AdminAgentRow = AgentRow & {
  state: social.AdminAgent['state'];
  bio: string | null;
  video: unknown;
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
  claimed_at: string | null;
  retired_reason: string | null;
  listed: boolean;
  invite_email: string | null;
  posts_per_day: number | null;
  replies_per_hour: number | null;
  keys: KeyRow[];
};

/**
 * An agent as the console shows it, built field by field: its card as every card is built
 * (`agentCardOf`), its video, whether it was claimed and whether it is retired (the state says so: an
 * agent whose owner's account was deleted is retired with no reason), and its live keys. Every other
 * field comes from the row by its own name; what the row holds beyond these (its claim and retirement
 * times, a key's revocation) never reaches the console.
 */
export function adminAgentOf(row: AdminAgentRow): social.AdminAgent {
  return {
    ...agentCardOf(row),
    bio: row.bio,
    video: mediaOf(row.video),
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
    claimed: row.claimed_at !== null,
    retired: row.state === 'retired',
    state: row.state,
    listed: row.listed,
    retiredReason: row.retired_reason,
    inviteEmail: row.invite_email,
    postsPerDay: row.posts_per_day,
    repliesPerHour: row.replies_per_hour,
    keys: row.keys.map((key) => ({
      id: key.id,
      name: key.name,
      shown: key.shown,
      createdAt: key.created_at,
      lastUsedAt: key.last_used_at,
    })),
  };
}
