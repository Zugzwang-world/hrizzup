import { randomBytes, randomUUID } from 'node:crypto';
import { social } from '@hrizzup/api';
import { transaction } from '@hrizzup/db';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newRecordId } from '@/lib/record-id.ts';
import { resetSocialCache } from '@/lib/social/cache.ts';
import {
  type AdminAgentRow,
  AGENT_COLUMNS,
  adminAgentOf,
  agentChangesOf,
  agentFault,
  SETTING_COLUMNS,
  type SettingField,
  settingChangesOf,
  settingsFault,
} from '@/lib/social/console.ts';
import { socialError } from '@/lib/social/errors.ts';
import { camelKeys } from '@/lib/social/shape.ts';

/**
 * The console's six M3a calls against a real database (docs/social/build.md, sections 5, 5.1 and 9.1;
 * R5's design note, M3a): the real router, handlers, mappers and output checks over the real functions of
 * migrations/*_social.sql, so what `admin.test.ts`'s stand-in can only assume is proven: that the
 * hand-written mappers (`lib/social/console.ts`) match what the SQL emits, that every `next` the database
 * makes comes back as a cursor it takes, that the settings table of columns is exactly the table's
 * columns and every setting's CHECK constraint is named `settings_<column>`, that each setting's
 * out-of-range value comes back on its own field, and that an agent's limits and mark change as asked.
 *
 * Who is signed in is stood in for (one account, an admin this run made); whether it is an admin is the
 * real `admin.is_admin()` of the real `private.admins`. The run seeds through M2's own functions, as the
 * pgTAP tests and `board.db.test.ts` do, and every ID, handle and email is its own, so a database that
 * holds the last run's rows (a local one is not rebuilt between runs) changes nothing: a row is looked
 * for by its ID, page by page.
 *
 * Run it on this Mac, on the slot's database (`infra/slots/slot db start` first), beside the other
 * database tests of this folder and the minute job's, one file at a time (they share the database's
 * stories and settings, and a test that lists them must not run beside one that makes them):
 *
 *   SOCIAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$(infra/slots/slot env | sed -n 's/^export SUPABASE_DB_PORT=//p')/postgres" \
 *     pnpm --filter @hrizzup/web exec vitest run --no-file-parallelism lib/api/social/console.db.test.ts
 *
 * Without `SOCIAL_DATABASE_URL` the file does not run: Quick checks have no database, and the website has
 * no `test:db` of its own yet.
 */

const url = process.env.SOCIAL_DATABASE_URL;

/**
 * This file seeds accounts, an admin, agents and stories with the database's own login and changes one
 * setting (and puts it back), so it runs only on a database on this Mac (the slot's), never on one it
 * was pointed at by mistake: any other host stops it, loudly, before a connection is made.
 */
function localDatabaseOrThrow(address: string): void {
  let host: string;
  try {
    host = new URL(address).hostname;
  } catch {
    throw new Error('SOCIAL_DATABASE_URL is not an address');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      'SOCIAL_DATABASE_URL must be a database on this Mac (127.0.0.1 or localhost): this test writes accounts and an admin to it',
    );
  }
}

const held = vi.hoisted(() => ({
  pool: null as import('pg').Pool | null,
  account: null as string | null,
}));
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));
vi.mock('@/lib/api/context.ts', () => ({
  signedIn: async () => (held.account ? { id: held.account } : null),
}));
/** Vercel's purge, stood in for: this Mac has no edge. */
const invalidate = vi.hoisted(() => vi.fn(async (_tags: string[]) => {}));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: (tags: string[]) => invalidate(tags),
}));

const { router } = await import('../router.ts');

function api(context: { url?: string } = {}) {
  return createRouterClient(router, {
    context: {
      headers: new Headers(),
      resHeaders: new Headers(),
      url: 'http://localhost:3103/api/v1/admin/social/invites',
      ...context,
    },
  });
}

const noSuchCall = { code: 'NOT_FOUND', status: 404, message: 'No such call' };

let owner: pg.Pool;
let app: pg.Pool;

const bytes = () => randomBytes(32);
const letters = (n: number) =>
  Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz'[b % 26]).join('');
const iso = (agoMinutes: number) => new Date(Date.now() - agoMinutes * 60_000).toISOString();

type Tx = Parameters<Parameters<typeof transaction>[1]>[0];
const asAccount = <T>(account: string | null, work: (tx: Tx) => Promise<T>) =>
  transaction(app, work, { account });

/** What the run seeded. */
const seeded = {
  admin: '',
  stranger: '',
  email: '',
  /** The invite of the claimed agent, the invite made and revoked, and the open one. */
  claimedInvite: '',
  revokedInvite: '',
  openInvite: '',
  claimedAgent: '',
  claimedHandle: '',
  waitingAgent: '',
  waitingHandle: '',
  /** An agent that was claimed, whose owner's account was then deleted: retired, with no reason. */
  orphanAgent: '',
  revokeReason: 'The console db test revoked this invite',
  listedStory: '',
  unlistedStory: '',
  ownerName: 'Console test owner',
  run: '',
};

/** One invite, made as the admin through the database's own function, with the code hash the test chose. */
async function makeInvite(
  email: string,
  listed: boolean,
  options: { house?: boolean; codeHash?: Buffer } = {},
): Promise<string> {
  const made = await asAccount(seeded.admin, async (tx) => {
    const { rows } = await tx.query(
      'select social.admin_create_invite($1, $2, $3, $4, $5, $6::bytea, $7) as answer',
      [
        randomUUID(),
        email,
        `Console db test ${seeded.run}`,
        options.house ?? false,
        listed,
        options.codeHash ?? bytes(),
        'hz-aaaa',
      ],
    );
    return rows[0]?.answer as { invite: { id: string } };
  });
  return made.invite.id;
}

/** An agent joins with the code the invite was made with, and answers its own ID. */
async function register(codeHash: Buffer, handle: string, name: string, claimHash: Buffer) {
  await asAccount(null, (tx) =>
    tx.query(
      'select social.register_agent($1::bytea, $2, $3, $4, null, null, null, $5::bytea, $6, $7::bytea) as answer',
      [codeHash, randomUUID(), handle, name, bytes(), `hz_demo_${letters(4)}`, claimHash],
    ),
  );
  const { rows } = await owner.query<{ id: string }>(
    'select id from social.agents where handle = $1',
    [handle],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('The agent registered');
  return id;
}

beforeAll(async () => {
  if (!url) return;
  localDatabaseOrThrow(url);
  owner = new pg.Pool({ connectionString: url, max: 2 });
  app = new pg.Pool({ connectionString: url, max: 4 });
  owner.on('error', () => {});
  app.on('error', () => {});
  held.pool = app;
  resetSocialCache(null);

  const run = randomUUID().slice(0, 8);
  seeded.run = run;
  seeded.admin = randomUUID();
  seeded.stranger = randomUUID();
  const ownerAccount = randomUUID();
  seeded.email = `console-${run}@social-console.test`;
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now()), ($5, $6, now())',
    [
      seeded.admin,
      `admin-${run}@social-console.test`,
      seeded.stranger,
      `stranger-${run}@social-console.test`,
      ownerAccount,
      seeded.email,
    ],
  );
  await owner.query("insert into private.admins (user_id, note) values ($1, 'A test admin')", [
    seeded.admin,
  ]);
  held.account = seeded.admin;

  // A claimed agent with a key, through its own invite, registration and claim.
  const claimedCode = bytes();
  seeded.claimedInvite = await makeInvite(seeded.email, true, { codeHash: claimedCode });
  seeded.claimedHandle = `console_${letters(8)}`;
  const claimHash = bytes();
  seeded.claimedAgent = await register(
    claimedCode,
    seeded.claimedHandle,
    'Console Test Agent',
    claimHash,
  );
  await asAccount(ownerAccount, (tx) =>
    tx.query('select social.claim_agent($1, $2::bytea, $3) as answer', [
      randomUUID(),
      claimHash,
      seeded.ownerName,
    ]),
  );

  // An agent whose owner's account is deleted after the claim: it stays, retired, and nobody gave a reason.
  const leaver = randomUUID();
  const leaverEmail = `leaver-${run}@social-console.test`;
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())',
    [leaver, leaverEmail],
  );
  const orphanCode = bytes();
  const orphanClaim = bytes();
  await makeInvite(leaverEmail, false, { codeHash: orphanCode });
  seeded.orphanAgent = await register(
    orphanCode,
    `console_${letters(8)}`,
    'Console Orphan Agent',
    orphanClaim,
  );
  await asAccount(leaver, (tx) =>
    tx.query('select social.claim_agent($1, $2::bytea, $3) as answer', [
      randomUUID(),
      orphanClaim,
      'Console leaver',
    ]),
  );
  await owner.query('delete from auth.users where id = $1', [leaver]);

  // A waiting agent whose invite is then revoked: the agent is retired, with the invite's reason.
  const waitingCode = bytes();
  seeded.revokedInvite = await makeInvite(`revoked-${run}@social-console.test`, false, {
    codeHash: waitingCode,
  });
  seeded.waitingHandle = `console_${letters(8)}`;
  seeded.waitingAgent = await register(
    waitingCode,
    seeded.waitingHandle,
    'Console Waiting Agent',
    bytes(),
  );
  await asAccount(seeded.admin, (tx) =>
    tx.query('select social.admin_revoke_invite($1, $2) as answer', [
      seeded.revokedInvite,
      seeded.revokeReason,
    ]),
  );

  // An open invite, unlisted and Hrizzup's own, with no agent.
  seeded.openInvite = await makeInvite(`open-${run}@social-console.test`, false, { house: true });

  // A listed story and an unlisted one, saved as the console does (through intake, then listed).
  for (const [name, listed] of [
    ['listedStory', true],
    ['unlistedStory', false],
  ] as const) {
    const id = newRecordId();
    seeded[name] = id;
    await owner.query('select intake.save_story($1::jsonb)', [
      JSON.stringify({
        format: 'story/1',
        id,
        title: `Console db test ${run}: ${listed ? 'a listed' : 'an unlisted'} story`,
        summary: 'A story made by the console database test.',
        locations: ['mumbai'],
        categories: ['general'],
        state: 'live',
        created_at: iso(10),
        updated_at: iso(9),
      }),
    ]);
    await owner.query("select social._list_story($1, $2, 'console', $3)", [
      id,
      listed,
      seeded.admin,
    ]);
    await owner.query('select social._refresh_story($1)', [id]);
  }
}, 60_000);

afterAll(async () => {
  held.account = null;
  await Promise.all([owner?.end(), app?.end()]);
  resetSocialCache();
});

describe('the database this test seeds', () => {
  it('is on this Mac: any other host stops it before a connection is made', () => {
    expect(() =>
      localDatabaseOrThrow('postgresql://postgres:postgres@127.0.0.1:55352/postgres'),
    ).not.toThrow();
    expect(() =>
      localDatabaseOrThrow('postgresql://postgres:postgres@localhost:5432/postgres'),
    ).not.toThrow();
    for (const elsewhere of [
      'postgresql://postgres:x@db.example.supabase.co:5432/postgres',
      'postgresql://postgres:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
      'postgresql://postgres:x@127.0.0.1.example.com:5432/postgres',
      'postgresql://postgres:x@localhost.example.com/postgres',
      'postgresql://postgres:x@10.0.0.5:5432/postgres',
      'not an address',
    ]) {
      expect(() => localDatabaseOrThrow(elsewhere), elsewhere).toThrow();
    }
  });
});

/** Every row of a list, page by page, following `next`, until `found` says the run's own row has turned up (or the list ends). */
async function pageUntil<Item extends { id: string }, Page extends { next: string | null }>(
  page: (cursor: string | undefined) => Promise<Page>,
  itemsOf: (page: Page) => Item[],
  wanted: string[],
): Promise<{ found: Map<string, Item>; pages: Page[] }> {
  const found = new Map<string, Item>();
  const pages: Page[] = [];
  let cursor: string | undefined;
  for (let round = 0; round < 60; round++) {
    const current = await page(cursor);
    pages.push(current);
    for (const item of itemsOf(current)) found.set(item.id, item);
    if (wanted.every((id) => found.has(id)) || current.next === null) return { found, pages };
    cursor = current.next;
  }
  throw new Error('The list never ended');
}

describe.skipIf(!url)('the three lists over the real functions', () => {
  it('lists the invites newest first with their reasons and their agents, a page at a time with the cursors the database makes', async () => {
    const called = api();
    const wanted = [seeded.claimedInvite, seeded.revokedInvite, seeded.openInvite];
    const { found, pages } = await pageUntil(
      (cursor) => called.admin.social.invites.list({ limit: 2, ...(cursor ? { cursor } : {}) }),
      (page) => page.invites,
      wanted,
    );
    for (const page of pages) expect(social.invitePage.parse(page)).toEqual(page);
    const all = pages.flatMap((page) => page.invites);
    expect(new Set(all.map((invite) => invite.id)).size, 'no invite twice').toBe(all.length);
    const created = all.map((invite) => Date.parse(invite.createdAt));
    expect(created, 'newest first').toEqual([...created].sort((a, b) => b - a));
    expect(pages[0]?.invites.length).toBeLessThanOrEqual(2);
    // The claimed agent's invite: used, not revoked, with its agent's handle and state.
    expect(found.get(seeded.claimedInvite)).toMatchObject({
      email: seeded.email,
      listed: true,
      house: false,
      codeShown: 'hz-aaaa',
      revokedAt: null,
      revokedReason: null,
      agent: { id: seeded.claimedAgent, handle: seeded.claimedHandle, state: 'claimed' },
    });
    expect(found.get(seeded.claimedInvite)?.usedAt).not.toBeNull();
    // The revoked one carries why, and its waiting agent was retired with the same words.
    expect(found.get(seeded.revokedInvite)).toMatchObject({
      revokedReason: seeded.revokeReason,
      listed: false,
      agent: { id: seeded.waitingAgent, handle: seeded.waitingHandle, state: 'retired' },
    });
    expect(found.get(seeded.revokedInvite)?.revokedAt).not.toBeNull();
    // The open one is Hrizzup's own, unlisted, with no agent.
    expect(found.get(seeded.openInvite)).toMatchObject({
      house: true,
      listed: false,
      usedAt: null,
      revokedAt: null,
      revokedReason: null,
      agent: null,
    });
    // Never a code, only its first group.
    expect(JSON.stringify(pages)).not.toMatch(/"code"|code_hash|codeHash/);
  });

  it('lists the stories newest listed first, each with whether it is listed, who made it and a null `saved`', async () => {
    const called = api();
    const wanted = [seeded.listedStory, seeded.unlistedStory];
    const { found, pages } = await pageUntil(
      (cursor) => called.admin.social.stories.list({ limit: 3, ...(cursor ? { cursor } : {}) }),
      (page) => page.stories,
      wanted,
    );
    for (const page of pages) expect(social.consoleStoryPage.parse(page)).toEqual(page);
    const all = pages.flatMap((page) => page.stories);
    expect(new Set(all.map((story) => story.id)).size, 'no story twice').toBe(all.length);
    expect(found.get(seeded.listedStory)).toMatchObject({
      listed: true,
      madeBy: 'console',
      state: 'live',
      saved: null,
      categories: ['general'],
      places: ['mumbai'],
      counts: { posts: 0, replies: 0, upvotes: 0, views: 0, uniqueViews: 0, pins: 0 },
    });
    expect(found.get(seeded.unlistedStory)).toMatchObject({ listed: false, saved: null });
    expect(found.get(seeded.listedStory)?.title).toContain(seeded.run);
    // The unlisted story is in the console's list, though never on the board.
    const board = await api().social.board({ limit: 100 });
    expect(board.stories.map((story) => story.id)).not.toContain(seeded.unlistedStory);
  });

  it('lists the agents newest first, each as the console shows it: its state, listing, reason, invite, limits and keys', async () => {
    const called = api();
    const { found, pages } = await pageUntil(
      (cursor) => called.admin.social.agents.list({ limit: 2, ...(cursor ? { cursor } : {}) }),
      (page) => page.agents,
      [seeded.claimedAgent, seeded.waitingAgent, seeded.orphanAgent],
    );
    for (const page of pages) expect(social.adminAgentPage.parse(page)).toEqual(page);
    const all = pages.flatMap((page) => page.agents);
    expect(new Set(all.map((agent) => agent.id)).size, 'no agent twice').toBe(all.length);
    const claimed = found.get(seeded.claimedAgent);
    expect(claimed).toMatchObject({
      handle: seeded.claimedHandle,
      name: 'Console Test Agent',
      state: 'claimed',
      claimed: true,
      retired: false,
      retiredReason: null,
      listed: true,
      house: false,
      inviteEmail: seeded.email,
      ownerName: seeded.ownerName,
      postsPerDay: null,
      repliesPerHour: null,
      picture: null,
      video: null,
    });
    expect(claimed?.keys).toHaveLength(1);
    expect(claimed?.keys[0]).toMatchObject({
      shown: expect.stringMatching(/^hz_demo_/),
      lastUsedAt: null,
    });
    // A key's secret never shows: only its id, name, first characters, creation and last use.
    expect(Object.keys(claimed?.keys[0] ?? {}).sort()).toEqual(
      ['createdAt', 'id', 'lastUsedAt', 'name', 'shown'].sort(),
    );
    // The agent whose invite was revoked while it waited: retired, with the reason, and no live key.
    expect(found.get(seeded.waitingAgent)).toMatchObject({
      state: 'retired',
      claimed: false,
      retired: true,
      retiredReason: seeded.revokeReason,
      listed: false,
      inviteEmail: `revoked-${seeded.run}@social-console.test`,
      keys: [],
    });
    // The agent whose owner's account was deleted: retired by its state, claimed, and no reason was given.
    expect(found.get(seeded.orphanAgent)).toMatchObject({
      state: 'retired',
      claimed: true,
      retired: true,
      retiredReason: null,
      ownerName: 'Console leaver',
    });
  });

  it("builds every agent from exactly the row's own fields: the mapper's type is what the SQL answers, and what it leaves out never shows", async () => {
    const page = await asAccount(seeded.admin, async (tx) => {
      const { rows } = await tx.query('select social.admin_agents(null, 100) as answer');
      return rows[0]?.answer as { agents: (AdminAgentRow & Record<string, unknown>)[] };
    });
    const row = page.agents.find((agent) => agent.id === seeded.claimedAgent);
    expect(row).toBeDefined();
    if (!row) return;
    // Every field the mapper reads is in the row (an absent one would make `undefined` reach the contract).
    const reads: (keyof AdminAgentRow)[] = [
      'id',
      'handle',
      'name',
      'picture',
      'house',
      'owner_name',
      'state',
      'bio',
      'video',
      'repository_url',
      'categories',
      'places',
      'standing',
      'counts',
      'registered_at',
      'claimed_at',
      'retired_reason',
      'listed',
      'invite_email',
      'posts_per_day',
      'replies_per_hour',
      'keys',
    ];
    for (const field of reads) expect(row, field).toHaveProperty(field);
    expect(Object.keys(row.counts).sort()).toEqual(
      [
        'file_reads',
        'posts',
        'replies',
        'replies_received',
        'unique_file_reads',
        'unique_views',
        'upvotes_received',
        'views',
      ].sort(),
    );
    const built = adminAgentOf(row);
    // `parse` strips any key the contract lacks, so equal means the mapper added none.
    expect(built).toEqual(social.adminAgent.parse(built));
    expect(built).not.toHaveProperty('files');
    expect(built).not.toHaveProperty('skills');
    expect(row.claimed_at).not.toBeNull();
    expect(built.claimed).toBe(true);
    // The retired one, from its own row.
    const retired = page.agents.find((agent) => agent.id === seeded.waitingAgent);
    if (!retired) throw new Error('The waiting agent is in the list');
    expect(adminAgentOf(retired)).toMatchObject({
      retired: true,
      retiredReason: seeded.revokeReason,
    });
  });
});

/** The columns of `social.settings` that are no setting: the row's own key, its version and who changed it, and when. */
const NOT_SETTINGS = ['id', 'ranks_version', 'changed_at', 'changed_by'];

/** A value just outside each setting's range, which the database must refuse (and the contract must too). */
const OUT_OF_RANGE = {
  postsPerDay: 1001,
  repliesPerHour: 10_001,
  housePostsPerDay: 1001,
  houseRepliesPerHour: 10_001,
  livePinsMax: 0,
  claimDays: 31,
  inviteDays: 366,
  replyDepthMax: 101,
  boardHalfLifeHours: 0,
  deskHalfLifeHours: 8761,
  topWPosts: -1,
  topWReplies: 1001,
  topWViews: -0.5,
  topWUpvotes: 1000.5,
  standingWViews: -1,
  standingWReplies: 1001,
  standingWUpvotes: -1,
  standingWReads: 1001,
  readerAiProvider: 'Not A Provider',
  readerAiModel: 'has a space',
  readerAiInNeuronsPerM: 0,
  readerAiOutNeuronsPerM: -5,
  readerAiDailyNeurons: 10_001,
  readerDailyMessages: 1001,
  foryouMatchHours: 720.5,
  foryouFormatHours: -1,
} as const satisfies Record<SettingField, number | string>;

/** The value at each setting's own limit, one end or the other, which the database must accept (and the contract too). */
const AT_THE_LIMIT = {
  postsPerDay: 1000,
  repliesPerHour: 10_000,
  housePostsPerDay: 0,
  houseRepliesPerHour: 10_000,
  livePinsMax: 1,
  claimDays: 30,
  inviteDays: 365,
  replyDepthMax: 100,
  boardHalfLifeHours: 8760,
  deskHalfLifeHours: 0.001,
  topWPosts: 0,
  topWReplies: 1000,
  topWViews: 0,
  topWUpvotes: 1000,
  standingWViews: 0,
  standingWReplies: 1000,
  standingWUpvotes: 0,
  standingWReads: 1000,
  readerAiProvider: 'a-1',
  readerAiModel: '@cf/meta/llama-3.2-3b-instruct',
  readerAiInNeuronsPerM: 0.5,
  readerAiOutNeuronsPerM: 1_000_000,
  readerAiDailyNeurons: 10_000,
  readerDailyMessages: 0,
  foryouMatchHours: 720,
  foryouFormatHours: 0,
} as const satisfies Record<SettingField, number | string>;

class RolledBack extends Error {}

describe.skipIf(!url)('the settings over the real functions', () => {
  it('reads every setting by its name, with the version, the time and the log, as the contract says', async () => {
    const settings = await api().admin.social.settings.get();
    expect(social.settings.parse(settings)).toEqual(settings);
    for (const field of Object.keys(SETTING_COLUMNS)) {
      expect(settings, field).toHaveProperty(field);
      expect(settings[field as SettingField], field).not.toBeUndefined();
    }
    expect(settings.ranksVersion).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(settings.log)).toBe(true);
    expect(settings.log.length).toBeLessThanOrEqual(20);
  });

  it("has a table of columns that is exactly the settings table's own: every column but the row's key, version and who changed it, and nothing else", async () => {
    const { rows } = await owner.query<{ column: string }>(
      `select a.attname as "column" from pg_catalog.pg_attribute a
       where a.attrelid = 'social.settings'::regclass and a.attnum > 0 and not a.attisdropped`,
    );
    const columns = rows.map((row) => row.column);
    expect(Object.values(SETTING_COLUMNS).sort()).toEqual(
      columns.filter((column) => !NOT_SETTINGS.includes(column)).sort(),
    );
    // And the settings the database answers, changed to camelCase, are those fields (plus the version, time and log).
    const answered = await asAccount(seeded.admin, async (tx) => {
      const { rows: answer } = await tx.query('select social.admin_settings() as answer');
      return answer[0]?.answer as Record<string, unknown>;
    });
    expect(Object.keys(camelKeys(answered)).sort()).toEqual(
      [...Object.keys(SETTING_COLUMNS), 'ranksVersion', 'changedAt', 'log'].sort(),
    );
  });

  it('names every setting’s CHECK constraint `settings_<column>`, the name the 23514 map reads', async () => {
    const { rows } = await owner.query<{ name: string }>(
      `select c.conname as name from pg_catalog.pg_constraint c
       where c.conrelid = 'social.settings'::regclass and c.contype = 'c'`,
    );
    const names = rows.map((row) => row.name);
    for (const column of Object.values(SETTING_COLUMNS))
      expect(names, column).toContain(`settings_${column}`);
    // The only other CHECKs are the row's own, which no change can reach (the function refuses those names).
    const others = names.filter(
      (name) => !Object.values(SETTING_COLUMNS).some((column) => name === `settings_${column}`),
    );
    expect(others.sort()).toEqual(['settings_one_row', 'settings_ranks_version']);
  });

  it("refuses a value just outside each setting's range on that setting: the database's 23514, by its own constraint, as a 400 on `changes.<field>`, and the contract refuses the very same value", async () => {
    for (const [field, column] of Object.entries(SETTING_COLUMNS) as [SettingField, string][]) {
      const bad = OUT_OF_RANGE[field];
      expect(social.settingFields[field].safeParse(bad).success, `${field}: the contract`).toBe(
        false,
      );
      const error = await asAccount(seeded.admin, (tx) =>
        tx.query('select social.admin_set_settings($1::jsonb, $2) as answer', [
          JSON.stringify(settingChangesOf({ [field]: bad })),
          'A test of the range',
        ]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error, `${field}: the database refused ${column}`).toMatchObject({
        code: '23514',
        constraint: `settings_${column}`,
      });
      const mapped = socialError(error, 'admin', settingsFault);
      expect(mapped, field).toMatchObject({
        code: 'BAD_REQUEST',
        status: 400,
        data: { issues: [{ path: `changes.${field}` }] },
      });
    }
  });

  it("accepts a value at each setting's own limit, as the contract does (and the changes are rolled back)", async () => {
    for (const field of Object.keys(SETTING_COLUMNS) as SettingField[]) {
      expect(social.settingFields[field].safeParse(AT_THE_LIMIT[field]).success, field).toBe(true);
    }
    const changes = settingChangesOf(AT_THE_LIMIT);
    expect(Object.keys(changes)).toHaveLength(Object.keys(SETTING_COLUMNS).length);
    let answered: Record<string, unknown> = {};
    await asAccount(seeded.admin, async (tx) => {
      const { rows } = await tx.query('select social.admin_set_settings($1::jsonb, $2) as answer', [
        JSON.stringify(changes),
        'Every setting at its limit',
      ]);
      answered = camelKeys(rows[0]?.answer);
      throw new RolledBack();
    }).catch((caught: unknown) => {
      if (!(caught instanceof RolledBack)) throw caught;
    });
    for (const field of Object.keys(SETTING_COLUMNS) as SettingField[]) {
      expect(answered[field], field).toBe(AT_THE_LIMIT[field]);
    }
  });

  it('changes a setting for real: the answer shows it, the log holds the old and the new value and the reason, a rank setting is untouched, and putting it back is another logged change', async () => {
    invalidate.mockClear();
    const called = api();
    const before = await called.admin.social.settings.get();
    const old = before.readerDailyMessages;
    const next = old === 7 ? 8 : 7;
    const changed = await called.admin.social.settings.set({
      changes: { readerDailyMessages: next },
      reason: `The console db test, ${seeded.run}`,
    });
    try {
      expect(social.settings.parse(changed)).toEqual(changed);
      expect(changed.readerDailyMessages).toBe(next);
      // Not a Top or standing weight, nor a half-life: the version doesn't move, nothing is re-ranked.
      expect(changed.ranksVersion).toBe(before.ranksVersion);
      expect(changed.log[0]).toEqual({
        changedAt: expect.any(String),
        changes: { readerDailyMessages: [old, next] },
        reason: `The console db test, ${seeded.run}`,
      });
      expect(changed.changedAt).not.toBeNull();
      // Every other setting is as it was.
      for (const field of Object.keys(SETTING_COLUMNS) as SettingField[]) {
        if (field !== 'readerDailyMessages') expect(changed[field], field).toEqual(before[field]);
      }
      // The same value again changes nothing and logs nothing.
      const again = await called.admin.social.settings.set({
        changes: { readerDailyMessages: next },
        reason: 'Said twice',
      });
      expect(again.log).toEqual(changed.log);
      // Nothing was purged: a setting re-ranks through the job.
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      const restored = await called.admin.social.settings.set({
        changes: { readerDailyMessages: old },
        reason: `The console db test, ${seeded.run}: put back`,
      });
      expect(restored.readerDailyMessages).toBe(old);
    }
  });
});

const hasChangeLogged = async (agent: string, reason: string) =>
  (
    await owner.query(
      "select 1 from social.console_log where action = 'set_agent' and target = $1 and reason = $2",
      [agent, reason],
    )
  ).rowCount;

describe.skipIf(!url)("an agent's limits, mark and video over the real function", () => {
  it('changes the limits and the mark as asked, logs it, and answers the agent as the list shows it', async () => {
    invalidate.mockClear();
    const called = api();
    const reason = `The console db test, ${seeded.run}: limits`;
    const changed = await called.admin.social.agents.set({
      id: seeded.claimedAgent,
      changes: { postsPerDay: 5, repliesPerHour: 40, house: true },
      reason,
    });
    expect(social.adminAgent.parse(changed)).toEqual(changed);
    expect(changed).toMatchObject({
      id: seeded.claimedAgent,
      postsPerDay: 5,
      repliesPerHour: 40,
      house: true,
      state: 'claimed',
      claimed: true,
    });
    expect(await hasChangeLogged(seeded.claimedAgent, reason)).toBe(1);
    // The mark changed: the agent's edge copies and the directory's were cleared.
    expect(invalidate).toHaveBeenCalledWith([
      `social:agent:${seeded.claimedAgent}`,
      'social:agents',
    ]);
    // The list shows what the call answered.
    const { found } = await pageUntil(
      (cursor) => called.admin.social.agents.list({ limit: 5, ...(cursor ? { cursor } : {}) }),
      (page) => page.agents,
      [seeded.claimedAgent],
    );
    expect(found.get(seeded.claimedAgent)).toEqual(changed);
    // A limit sent as null is "the settings' own": the override is cleared; a left-out one is left alone.
    const cleared = await called.admin.social.agents.set({
      id: seeded.claimedAgent,
      changes: { postsPerDay: null, house: false },
      reason: `${reason}: cleared`,
    });
    expect(cleared).toMatchObject({ postsPerDay: null, repliesPerHour: 40, house: false });
    const nothing = await called.admin.social.agents.set({
      id: seeded.claimedAgent,
      changes: { repliesPerHour: null },
      reason: `${reason}: back`,
    });
    expect(nothing).toMatchObject({ postsPerDay: null, repliesPerHour: null });
    // The same again changes nothing and logs nothing.
    await called.admin.social.agents.set({
      id: seeded.claimedAgent,
      changes: { repliesPerHour: null },
      reason: `${reason}: twice`,
    });
    expect(await hasChangeLogged(seeded.claimedAgent, `${reason}: twice`)).toBe(0);
  });

  it('takes the agent\'s ID in any case, and an agent that isn\'t there is 404 "No such agent"', async () => {
    const called = api();
    await expect(
      called.admin.social.agents.set({
        id: seeded.claimedAgent.toUpperCase(),
        changes: { postsPerDay: null },
        reason: 'Upper case',
      }),
    ).resolves.toMatchObject({ id: seeded.claimedAgent });
    await expect(
      called.admin.social.agents.set({
        id: randomUUID(),
        changes: { house: true },
        reason: 'None',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'No such agent' });
  });

  it("refuses a video that isn't a ready video of the agent's on `changes.videoMediaId` (the database's 22023), and changes nothing", async () => {
    invalidate.mockClear();
    const called = api();
    await expect(
      called.admin.social.agents.set({
        id: seeded.claimedAgent,
        changes: { videoMediaId: randomUUID(), postsPerDay: 9 },
        reason: 'A video that is not there',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      data: { issues: [{ path: 'changes.videoMediaId' }] },
    });
    // Nothing was changed along with it (one transaction), and nothing was purged.
    const row = await owner.query('select posts_per_day from social.agents where id = $1', [
      seeded.claimedAgent,
    ]);
    expect(row.rows[0]?.posts_per_day).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    // The same fault through the map by hand, to see that it is the video check that raised it.
    const error = await asAccount(seeded.admin, (tx) =>
      tx.query('select social.admin_set_agent($1, $2::jsonb, $3) as answer', [
        seeded.claimedAgent,
        JSON.stringify(agentChangesOf({ videoMediaId: randomUUID() })),
        'By hand',
      ]),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: '22023' });
    expect(socialError(error, 'admin', agentFault({ videoMediaId: randomUUID() }))).toMatchObject({
      data: { issues: [{ path: 'changes.videoMediaId' }] },
    });
  });

  it("names the columns the function takes: each of the table's four changes is one the function reads", async () => {
    for (const [field, column] of Object.entries(AGENT_COLUMNS)) {
      const sent = { [field]: field === 'house' ? false : null } as never;
      await expect(
        asAccount(seeded.admin, (tx) =>
          tx.query('select social.admin_set_agent($1, $2::jsonb, $3) as answer', [
            seeded.claimedAgent,
            JSON.stringify(agentChangesOf(sent)),
            `By its column, ${column}`,
          ]),
        ),
        field,
      ).resolves.toBeDefined();
    }
  });
});

describe.skipIf(!url)('who may make these calls, over the real admins table', () => {
  const calls = [
    () => api().admin.social.invites.list(),
    () => api().admin.social.stories.list(),
    () => api().admin.social.settings.get(),
    () => api().admin.social.settings.set({ changes: { postsPerDay: 5 }, reason: 'x' }),
    () => api().admin.social.agents.list(),
    () =>
      api().admin.social.agents.set({
        id: seeded.claimedAgent,
        changes: { house: true },
        reason: 'x',
      }),
  ];

  it('is an admin only: nobody signed in, and an account that is no admin, are told "No such call"', async () => {
    for (const account of [null, seeded.stranger]) {
      held.account = account;
      for (const call of calls) await expect(call()).rejects.toMatchObject(noSuchCall);
    }
    held.account = seeded.admin;
  });

  it('is refused by the database itself too, as the same "No such call", for every function', async () => {
    const statements: [string, unknown[]][] = [
      ['select social.admin_invites(null, 5) as answer', []],
      ['select social.admin_stories(null, 5) as answer', []],
      ['select social.admin_settings() as answer', []],
      ['select social.admin_set_settings($1::jsonb, $2) as answer', ['{"posts_per_day": 5}', 'x']],
      ['select social.admin_agents(null, 5) as answer', []],
      [
        'select social.admin_set_agent($1, $2::jsonb, $3) as answer',
        [seeded.claimedAgent, '{"house": true}', 'x'],
      ],
    ];
    for (const account of [null, seeded.stranger]) {
      for (const [sql, values] of statements) {
        const error = await asAccount(account, (tx) => tx.query(sql, values)).then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(socialError(error, 'admin'), sql).toMatchObject(noSuchCall);
      }
    }
  });
});

describe.skipIf(!url)("the ready message's address, on this Mac", () => {
  it("names this website's own address, the one the request came to, and the code in it works for no one else", async () => {
    const created = await api({
      url: 'http://localhost:3103/api/v1/admin/social/invites',
    }).admin.social.invites.create({
      requestId: randomUUID(),
      email: `message-${seeded.run}@social-console.test`,
      listed: false,
    });
    expect(created.message).toContain('Read http://localhost:3103/skill.md and join Hrizzup');
    expect(created.message).toContain(created.code);
    expect(created.invite).toMatchObject({ revokedAt: null, revokedReason: null });
    // The invite the database holds never holds the code.
    const stored = await owner.query('select code_shown from social.invites where id = $1', [
      created.invite.id,
    ]);
    expect(stored.rows[0]?.code_shown).toBe(created.code.slice(0, 7));
  });
});
