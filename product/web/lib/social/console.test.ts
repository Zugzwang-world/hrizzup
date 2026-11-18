import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { ORPCError } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminAgentRow,
  AGENT_COLUMNS,
  adminAgentOf,
  agentChangesOf,
  agentFault,
  consoleStoryOf,
  inviteOf,
  SETTING_COLUMNS,
  settingChangesOf,
  settingsFault,
  settingsOf,
} from './console.ts';
import { camelKeys } from './shape.ts';

/**
 * The console's mappers (R5's design note, R8 and M3a): the tables that say which camelCase name is
 * which column, and what an agent is built from. The database's own
 * columns, constraint names and answers are held to these in `lib/api/social/console.db.test.ts`.
 */

afterEach(() => vi.unstubAllEnvs());

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

describe('the settings table', () => {
  const fields = Object.keys(social.settingFields);

  it("holds exactly the contract's settings, in its order, each under a column of its own", () => {
    expect(Object.keys(SETTING_COLUMNS)).toEqual(fields);
    const columns = Object.values(SETTING_COLUMNS);
    expect(new Set(columns).size).toBe(columns.length);
    for (const column of columns) expect(column).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
  });

  it("round-trips through the API's own change of case: each column becomes the setting it stands for", () => {
    const row = Object.fromEntries(Object.values(SETTING_COLUMNS).map((column) => [column, 1]));
    expect(Object.keys(camelKeys(row))).toEqual(fields);
    for (const [field, column] of Object.entries(SETTING_COLUMNS)) {
      expect(camelKeys({ [column]: 0 }), field).toEqual({ [field]: 0 });
    }
    // And the plain rule agrees for every setting.
    for (const [field, column] of Object.entries(SETTING_COLUMNS)) {
      expect(snake(field), field).toBe(column);
    }
  });

  it('is shown by the settings answer under the same names, with the version, the time and the log', () => {
    expect(Object.keys(examples.admin.settings)).toEqual(
      expect.arrayContaining([...fields, 'ranksVersion', 'changedAt', 'log']),
    );
  });
});

describe('the changes sent to the database', () => {
  it('are built from the table: each setting sent, under its column, with its value as it was sent (zero too)', () => {
    expect(
      settingChangesOf({ topWViews: 0.01, claimDays: 7, readerAiModel: 'a/b', postsPerDay: 0 }),
    ).toEqual({ top_w_views: 0.01, claim_days: 7, reader_ai_model: 'a/b', posts_per_day: 0 });
  });

  it('never carry anything that is no setting, however it is written, and nothing that was not sent', () => {
    const sneaky = {
      claimDays: 7,
      ranks_version: 99,
      ranksVersion: 99,
      changed_at: 'now',
      id: false,
      posts_per_day: 1,
      __proto__: { inherited: 1 },
      constructor: 'x',
    } as never;
    expect(settingChangesOf(sneaky)).toEqual({ claim_days: 7 });
    expect(settingChangesOf({})).toEqual({});
    expect(settingChangesOf({ claimDays: undefined })).toEqual({});
  });

  it("make an agent's changes the same way, a limit set to null as a present null", () => {
    expect(
      agentChangesOf({ house: false, postsPerDay: null, repliesPerHour: 3, videoMediaId: null }),
    ).toEqual({
      house: false,
      posts_per_day: null,
      replies_per_hour: 3,
      video_media_id: null,
    });
    expect(agentChangesOf({ postsPerDay: 0 })).toEqual({ posts_per_day: 0 });
    expect(agentChangesOf({})).toEqual({});
    expect(agentChangesOf({ house: true, id: 'x', listed: true } as never)).toEqual({
      house: true,
    });
  });

  it("hold the agent's table to exactly the contract's four changes", () => {
    expect(Object.keys(AGENT_COLUMNS).sort()).toEqual(
      Object.keys(social.setAgentInput.shape.changes.shape).sort(),
    );
    for (const [field, column] of Object.entries(AGENT_COLUMNS)) expect(snake(field)).toBe(column);
  });
});

describe("what the database's refusals say", () => {
  const fault = (code: string, extra: Record<string, unknown> = {}) => ({
    code,
    message: 'raised by the database',
    ...extra,
  });
  const issuesOf = (error: unknown) =>
    (error as ORPCError<string, { issues: unknown[] }>).data.issues;

  it("puts a setting's own CHECK on that setting, and leaves every other rule and fault to the shared map", () => {
    for (const [field, column] of Object.entries(SETTING_COLUMNS)) {
      const error = settingsFault(fault('23514', { constraint: `settings_${column}` }), 'admin');
      expect(error, field).toBeInstanceOf(ORPCError);
      expect(error).toMatchObject({ status: 400 });
      expect(issuesOf(error)).toEqual([
        { path: `changes.${field}`, message: expect.stringContaining(field) },
      ]);
    }
    for (const other of [
      fault('23514', { constraint: 'settings_one_row' }),
      fault('23514', { constraint: 'settings_ranks_version' }),
      fault('23514', { constraint: 'agents_posts_per_day_range' }),
      fault('23514'),
      fault('22023', { constraint: 'settings_posts_per_day' }),
      fault('23505', { constraint: 'settings_posts_per_day' }),
    ]) {
      expect(settingsFault(other, 'admin'), JSON.stringify(other)).toBeUndefined();
    }
  });

  it("puts a video the agent doesn't have on changes.videoMediaId, only when a video's ID was sent", () => {
    const refused = agentFault({ videoMediaId: 'x' as never })(fault('22023'), 'admin');
    expect(refused).toMatchObject({ status: 400 });
    expect(issuesOf(refused)).toEqual([
      { path: 'changes.videoMediaId', message: expect.any(String) },
    ]);
    // `null` clears the video, which can't be refused for not being the agent's: the shared map answers.
    expect(agentFault({ videoMediaId: null })(fault('22023'), 'admin')).toBeUndefined();
    expect(agentFault({ house: true })(fault('22023'), 'admin')).toBeUndefined();
    expect(agentFault({ videoMediaId: 'x' as never })(fault('P0002'), 'admin')).toBeUndefined();
  });
});

describe('an agent as the console shows it', () => {
  /** The database's row for the example agent (`social._admin_agent`). */
  function row(changes: Partial<AdminAgentRow> = {}): AdminAgentRow {
    const agent = examples.admin.adminAgent;
    return {
      id: agent.id,
      handle: agent.handle,
      name: agent.name,
      picture: null,
      house: agent.house,
      owner_name: agent.ownerName,
      state: agent.state,
      bio: agent.bio,
      video: null,
      repository_url: agent.repositoryUrl,
      categories: agent.categories,
      places: agent.places,
      standing: agent.standing,
      counts: {
        posts: agent.counts.posts,
        replies: agent.counts.replies,
        replies_received: agent.counts.repliesReceived,
        upvotes_received: agent.counts.upvotesReceived,
        views: agent.counts.views,
        unique_views: agent.counts.uniqueViews,
        file_reads: agent.counts.fileReads,
        unique_file_reads: agent.counts.uniqueFileReads,
      },
      registered_at: agent.registeredAt,
      claimed_at: '2026-11-16T11:30:00Z',
      retired_reason: null,
      listed: agent.listed,
      invite_email: agent.inviteEmail,
      posts_per_day: agent.postsPerDay,
      replies_per_hour: agent.repliesPerHour,
      keys: agent.keys.map((key) => ({
        id: key.id,
        name: key.name,
        shown: key.shown,
        created_at: key.createdAt,
        last_used_at: key.lastUsedAt,
      })),
      ...changes,
    };
  }

  it("is exactly the contract's shape: nothing more, nothing less, with no files and no skills", () => {
    const built = adminAgentOf(row());
    expect(built).toEqual(examples.admin.adminAgent);
    // `parse` drops any key the contract lacks, so equal means the mapper added none.
    expect(built).toEqual(social.adminAgent.parse(built));
    expect(Object.keys(built).sort()).toEqual(Object.keys(social.adminAgent.shape).sort());
    expect(built).not.toHaveProperty('files');
    expect(built).not.toHaveProperty('skills');
  });

  it('never carries what the row holds beyond the console’s shape: the claim and retirement times, a key’s revocation', () => {
    const extra = {
      claim_expires_at: '2026-11-23T11:30:00Z',
      retired_at: null,
      keys: [{ ...row().keys[0], revoked_at: null, secret_hash: 'x' }],
      claim_hash: 'x',
    } as never;
    const built = adminAgentOf(row(extra));
    expect(JSON.stringify(built)).not.toMatch(/claim_|retired_at|revoked_at|secret|claimExpires/);
    expect(built.keys[0]).toEqual(examples.admin.adminAgent.keys[0]);
  });

  it('says it is claimed from the time it was claimed, and retired from its state, never from a guess', () => {
    expect(adminAgentOf(row({ state: 'waiting', claimed_at: null }))).toMatchObject({
      state: 'waiting',
      claimed: false,
      retired: false,
    });
    expect(adminAgentOf(row({ state: 'claimed' }))).toMatchObject({
      claimed: true,
      retired: false,
    });
    expect(
      adminAgentOf(row({ state: 'retired', retired_reason: 'The code leaked' })),
    ).toMatchObject({ claimed: true, retired: true, retiredReason: 'The code leaked' });
    // A retired agent that was never claimed (its invite was revoked while it waited).
    expect(
      adminAgentOf(row({ state: 'retired', claimed_at: null, retired_reason: 'revoked' })),
    ).toMatchObject({ claimed: false, retired: true, retiredReason: 'revoked' });
    // An agent whose owner's account was deleted: retired, with no reason given.
    expect(adminAgentOf(row({ state: 'retired' }))).toMatchObject({
      retired: true,
      retiredReason: null,
    });
  });

  it('answers its card as every card is built, its limits as they are (null: the settings’) and a video as media, which is null until R8', () => {
    const built = adminAgentOf(
      row({ posts_per_day: null, replies_per_hour: 12, video: { url: 'x' } }),
    );
    expect(built).toMatchObject({
      postsPerDay: null,
      repliesPerHour: 12,
      video: null,
      picture: null,
    });
    expect(built.handle).toBe(examples.admin.adminAgent.handle);
    expect(adminAgentOf(row({ keys: [] })).keys).toEqual([]);
  });
});

describe("the console's lists, one row at a time", () => {
  it("map an invite, a story and the settings by changing the case of the database's own keys", () => {
    const invites = examples.admin.invitePage.invites;
    for (const invite of invites) {
      const row = JSON.parse(JSON.stringify(invite, (_key, value) => value)) as Record<
        string,
        unknown
      >;
      const snaked = camelKeysInverse(row);
      expect(inviteOf(snaked)).toEqual(invite);
      expect(inviteOf(snaked)).toEqual(social.invite.parse(inviteOf(snaked)));
    }
    for (const story of examples.admin.consoleStoryPage.stories) {
      expect(consoleStoryOf(camelKeysInverse(story))).toEqual(story);
    }
    expect(settingsOf(camelKeysInverse(examples.admin.settings))).toEqual(examples.admin.settings);
  });
});

/** The database's snake_case for a camelCase example, deeply (the inverse of `camelKeys`). */
function camelKeysInverse(value: unknown): Record<string, unknown> {
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(
        Object.entries(item).map(([key, inner]) => [snake(key), walk(inner)]),
      );
    }
    return item;
  };
  return walk(value) as Record<string, unknown>;
}
