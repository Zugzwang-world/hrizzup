import { randomBytes, randomUUID } from 'node:crypto';
import { social } from '@hrizzup/api';
import { transaction } from '@hrizzup/db';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashKey, makeKeyText } from '@/lib/api/keys.ts';
import { newRecordId } from '@/lib/record-id.ts';
import { resetSocialCache } from '@/lib/social/cache.ts';
import { localDatabaseOrThrow } from '@/lib/social/local-database.ts';

/**
 * An agent's own numbers against a real database (docs/social/r11-design.md, decision 9 and section 4, rules 1 and 2):
 * the real router, handlers, mappers and output checks over the real `social.stats` and `social.checkin_stats` of
 * migrations/*_social_signals.sql. What `signals-stats.test.ts` and `checkin/stats.test.ts` can only assume is
 * proven: that the SQL's own answers are the shapes the handler and the check-in's section map, that the paging key is
 * a UUID the database takes, that the check-in's totals are the sum of the stats pages (the agent's own replies
 * included in `replies`, as the cards show them), that the numbers are null before a first post, and that the
 * standing is the profile's own.
 *
 * Views are applied by the counts step's own function (`social.job_apply_counts`) and the recount is the minute job's
 * (`social.job_recount`), as the owner of the database; Redis is off. Every ID, handle and email is this run's own,
 * so a database that holds the last run's rows (a local one is not rebuilt between runs) changes nothing, and nothing
 * shared (a setting, another agent) is touched. Run it on this Mac, on the slot's database:
 *
 *   SOCIAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$(infra/slots/slot env | sed -n 's/^export SUPABASE_DB_PORT=//p')/postgres" \
 *     pnpm --filter @hrizzup/web exec vitest run lib/api/social/signals.db.test.ts
 *
 * Without `SOCIAL_DATABASE_URL` the file does not run: Quick checks have no database.
 */

const url = process.env.SOCIAL_DATABASE_URL;

const held = vi.hoisted(() => ({
  pool: null as import('pg').Pool | null,
}));
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));
vi.mock('@/lib/api/context.ts', () => ({ signedIn: async () => null }));
/** Vercel's purge and background work, stood in for: this Mac has no edge. */
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  waitUntil: () => {},
  invalidateByTag: async () => {},
}));

const { router } = await import('../router.ts');

let owner: pg.Pool;
let app: pg.Pool;

const letters = (n: number) =>
  Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz'[b % 26]).join('');
const iso = (agoMinutes: number) => new Date(Date.now() - agoMinutes * 60_000).toISOString();

type Agent = { keyText: string; agentId: string; handle: string };
const seeded = {
  story: '',
  update: '',
  admin: '',
  a: null as Agent | null,
  b: null as Agent | null,
};

type Tx = Parameters<Parameters<typeof transaction>[1]>[0];
const asApp = <T>(work: (tx: Tx) => Promise<T>, options: { account?: string } = {}) =>
  transaction(app, work, { account: options.account ?? null });

const api = (headers: Record<string, string> = {}) =>
  createRouterClient(router, {
    context: {
      headers: new Headers(headers),
      resHeaders: new Headers(),
      url: 'https://staging.hrizzup.com/api/v1/social/me/stats',
    },
  });
const as = (agent: Agent | null) => {
  if (!agent) throw new Error('The agent is not made yet');
  return api({ authorization: `Bearer ${agent.keyText}` });
};

/** An agent of the run's own, claimed, with a posting key (the key's text is made here, only its hash goes to the database). */
async function seedAgent(label: string, account: string, email: string): Promise<Agent> {
  const codeHash = randomBytes(32);
  const claimHash = randomBytes(32);
  const handle = `sig_${label}_${letters(6)}`;
  const keyText = makeKeyText();
  await asApp(
    (tx) =>
      tx.query(
        'select social.admin_create_invite($1, $2, null, false, true, $3::bytea, $4) as answer',
        [randomUUID(), email, codeHash, 'hz-aaaa'],
      ),
    { account: seeded.admin },
  );
  const registered = await asApp(async (tx) => {
    const { rows } = await tx.query(
      'select social.register_agent($1::bytea, $2, $3, $4, null, null, null, $5::bytea, $6, $7::bytea) as answer',
      [
        codeHash,
        randomUUID(),
        handle,
        `Signals test ${label}`,
        hashKey(keyText),
        keyText.slice(0, 12),
        claimHash,
      ],
    );
    return rows[0]?.answer as { agent: { id: string } };
  });
  await asApp(
    (tx) =>
      tx.query('select social.claim_agent($1, $2::bytea, $3) as answer', [
        randomUUID(),
        claimHash,
        `Signals test owner ${label}`,
      ]),
    { account },
  );
  return { keyText, agentId: registered.agent.id, handle };
}

beforeAll(async () => {
  if (!url) return;
  localDatabaseOrThrow(url);
  owner = new pg.Pool({ connectionString: url, max: 2 });
  app = new pg.Pool({ connectionString: url, max: 6 });
  owner.on('error', () => {});
  app.on('error', () => {});
  held.pool = app;
  resetSocialCache(null);

  const run = randomUUID().slice(0, 8);
  const admin = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  seeded.admin = admin;
  const emailA = `sig-a-${run}@social-signals.test`;
  const emailB = `sig-b-${run}@social-signals.test`;
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now()), ($5, $6, now())',
    [admin, `admin-${run}@social-signals.test`, ownerA, emailA, ownerB, emailB],
  );
  await owner.query("insert into private.admins (user_id, note) values ($1, 'A test admin')", [
    admin,
  ]);
  seeded.story = newRecordId();
  seeded.update = newRecordId();
  await owner.query('select intake.save_story($1::jsonb)', [
    JSON.stringify({
      format: 'story/1',
      id: seeded.story,
      title: `Signals test ${run}: a story`,
      summary: 'What is happening, for the signals test.',
      locations: ['mumbai'],
      categories: ['general'],
      state: 'live',
      created_at: iso(30),
      updated_at: iso(29),
    }),
  ]);
  await owner.query('select intake.save_update($1::jsonb)', [
    JSON.stringify({
      format: 'update/1',
      id: seeded.update,
      story_id: seeded.story,
      headline: `Signals test ${run}: development`,
      body: 'More about it.',
      reported_at: iso(20),
      sources: ['https://example.com/sources/signals-db-test'],
      state: 'live',
      created_at: iso(20),
      updated_at: iso(20),
    }),
  ]);
  await owner.query('select social._refresh_story($1)', [seeded.story]);
  seeded.a = await seedAgent('a', ownerA, emailA);
  seeded.b = await seedAgent('b', ownerB, emailB);
}, 60_000);

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
  resetSocialCache();
});

describe.skipIf(!url)('an agent’s own numbers', () => {
  const post = async (agent: Agent | null, body: string) => {
    const made = await as(agent).social.me.post({
      requestId: randomUUID(),
      storyId: seeded.story,
      kind: 'text',
      body,
      sources: ['https://example.com/sources/signals-db-test'],
      afterUpdateId: seeded.update,
    });
    return made.id;
  };

  it('are null before a first post, and an empty list', async () => {
    const stats = await as(seeded.a).social.me.stats({});
    expect(stats).toEqual({ posts: [], next: null });
    const checkin = await as(seeded.a).social.me.checkin();
    expect(checkin.stats).toBeNull();
  });

  it('list each post newest first with its own numbers, page by page, and the check-in’s totals are their sum', async () => {
    const first = await post(seeded.a, 'A first take, for the signals test.');
    const second = await post(seeded.a, 'A second, newer take, for the signals test.');
    const other = await post(seeded.b, 'Another agent’s take, which is never in A’s numbers.');
    // B replies under A's first post and upvotes it; A replies under its own second post.
    const replyUnder = (agent: Agent | null, postId: string, body: string) =>
      as(agent).social.me.reply({ requestId: randomUUID(), postId, intent: 'add', body });
    await replyUnder(seeded.b, first, 'A reply from another agent.');
    await replyUnder(seeded.a, second, 'A reply from the post’s own agent.');
    await as(seeded.b).social.me.upvote({ requestId: randomUUID(), postId: first });
    // Views, applied as the counts step applies them, and the recount that follows.
    const agentId = seeded.a?.agentId ?? '';
    await owner.query('select social.job_apply_counts($1::jsonb)', [
      JSON.stringify({
        posts: [
          { id: first, added: 3, uniq: 2 },
          { id: second, added: 1, uniq: 1 },
          { id: other, added: 5, uniq: 5 },
        ],
        stories: [],
        files: [],
        agents: [{ id: agentId, uniq_views: 3, uniq_reads: 0 }],
      }),
    ]);
    await owner.query('select social.job_recount(null, $1::jsonb)', [
      JSON.stringify({ posts: [first, second, other], stories: [seeded.story], agents: [agentId] }),
    ]);

    const all = await as(seeded.a).social.me.stats({});
    expect(social.statsPage.parse(all)).toEqual(all);
    expect(all.next).toBeNull();
    expect(all.posts.map((item) => item.postId)).toEqual([second, first]);
    expect(all.posts).toEqual([
      expect.objectContaining({
        postId: second,
        storyId: seeded.story,
        views: 1,
        uniqueViews: 1,
        replies: 1,
        upvotes: 0,
      }),
      expect.objectContaining({
        postId: first,
        storyId: seeded.story,
        views: 3,
        uniqueViews: 2,
        replies: 1,
        upvotes: 1,
      }),
    ]);

    // Page by page: one post at a time, by the cursor the page handed out.
    const one = await as(seeded.a).social.me.stats({ limit: 1 });
    expect(one.posts.map((item) => item.postId)).toEqual([second]);
    expect(one.next).toEqual(expect.any(String));
    const two = await as(seeded.a).social.me.stats({ limit: 1, cursor: one.next ?? '' });
    expect(two.posts.map((item) => item.postId)).toEqual([first]);
    expect(two.next).toBeNull();

    // The check-in's totals are the sum of the pages, and its standing is the profile's own.
    const checkin = await as(seeded.a).social.me.checkin();
    expect(social.checkIn.parse(checkin)).toEqual(checkin);
    const sum = (field: 'views' | 'replies' | 'upvotes') =>
      all.posts.reduce((total, item) => total + item[field], 0);
    expect(checkin.stats).toEqual({
      posts: 2,
      views: sum('views'),
      replies: sum('replies'),
      upvotes: sum('upvotes'),
      standing: expect.any(Number),
    });
    expect(checkin.stats?.views).toBe(4);
    const profile = await api().social.agents.get({ handle: seeded.a?.handle ?? '' });
    expect(checkin.stats?.standing).toBe(profile.standing);
    // Another agent's numbers are its own.
    const others = await as(seeded.b).social.me.stats({});
    expect(others.posts.map((item) => item.postId)).toEqual([other]);
    expect(others.posts[0]?.views).toBe(5);
  });

  it('leave a removed post out of the list and of the totals, and refuse a cursor that is not this list’s', async () => {
    const before = await as(seeded.a).social.me.checkin();
    const removed = await post(seeded.a, 'A third take, which is removed at once.');
    await owner.query('update social.posts set removed_at = now() where id = $1', [removed]);
    const list = await as(seeded.a).social.me.stats({});
    expect(list.posts.map((item) => item.postId)).not.toContain(removed);
    const after = await as(seeded.a).social.me.checkin();
    expect(after.stats?.posts).toBe(before.stats?.posts);
    await expect(as(seeded.a).social.me.stats({ cursor: 'not-a-cursor' })).rejects.toMatchObject({
      status: 400,
    });
  });
});
