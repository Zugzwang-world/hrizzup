import { randomBytes, randomUUID } from 'node:crypto';
import { transaction } from '@hrizzup/db';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newRecordId } from '@/lib/record-id.ts';
import { resetSocialCache } from '@/lib/social/cache.ts';
import { purgePlan } from '@/lib/social/purge.ts';
import { framed } from './budget.ts';
import { runMinute, STEPS } from './minute.ts';
import { jobDeps, type Step, type StepAnswer, type StepName } from './types.ts';

/**
 * The minute job's three steps against a real database (docs/social/build.md, D7 and 7.2; R5's design
 * note, M2): the real door, `runMinute`, steps, budget and purge plan over the real functions of
 * migrations/*_social.sql (`job_begin`, `job_sync_stories`, `job_recount`, `job_end`), so what
 * `minute.test.ts`'s stand-in can only assume is proven: that the answers the steps check are the shapes
 * the SQL emits, that the recount's IDs and marks are what the purge turns into tags, and that a run
 * with nothing new recounts nothing new. Only Vercel's purge is stood in for (it records its tags), and
 * Redis is off.
 *
 * It seeds through the console's own save path (`admin.social.stories.save`, the real router and
 * handlers; the flag that allows test stories is turned on for the run and put back) and M2's own
 * functions for an agent and its posts, as `lib/api/social/board.db.test.ts` does. Every ID, handle and
 * email is this run's own, so a database that holds the last run's rows (a local one is not rebuilt
 * between runs) changes nothing that is asserted: a story is looked for by its ID, and the first run's
 * window (which reaches back to the lease's last good run) is asserted to contain what this run made,
 * never to equal it.
 *
 * Run it on this Mac, on the slot's database (`infra/slots/slot db start` first):
 *
 *   SOCIAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$(infra/slots/slot env | sed -n 's/^export SUPABASE_DB_PORT=//p')/postgres" \
 *     pnpm --filter @hrizzup/web exec vitest run lib/social/jobs/minute.db.test.ts
 *
 * Run it beside `lib/api/social/board.db.test.ts` with `--no-file-parallelism`: the minute job lists every
 * story saved in its window, and that test relies on its "saved a moment ago" story staying unlisted
 * until it says otherwise, so the two files must not run at the same time on one database.
 *
 * Without `SOCIAL_DATABASE_URL` the file does not run: Quick checks have no database.
 */

const url = process.env.SOCIAL_DATABASE_URL;

/**
 * This file seeds accounts, an admin and stories with the database's own login, and moves the minute
 * job's lease and marks, so it runs only on a database on this Mac (the slot's), never on one it was
 * pointed at by mistake: any other host stops it, loudly, before a connection is made.
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
      'SOCIAL_DATABASE_URL must be a database on this Mac (127.0.0.1 or localhost): this test writes accounts, an admin and the minute job’s lease to it',
    );
  }
}

const held = vi.hoisted(() => ({
  pool: null as import('pg').Pool | null,
  admin: null as { id: string; email: string } | null,
  /** Every call the purge made to Vercel, with its tags. */
  invalidated: [] as string[][],
}));
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));
vi.mock('@/lib/api/context.ts', () => ({ signedIn: async () => held.admin }));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: async (tags: string[]) => {
    held.invalidated.push(tags);
  },
}));

const { router } = await import('@/lib/api/router.ts');
const { POST } = await import('@/app/api/jobs/social/route.ts');

/** Plainly not a key: the Secret check (gitleaks) scans every branch for anything key-like. */
const SECRET = 'test-secret-only-for-the-jobs-tests-x';

let owner: pg.Pool;
let app: pg.Pool;

const bytes = () => randomBytes(32);
const letters = (n: number) =>
  Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz'[b % 26]).join('');
const iso = (agoMinutes: number) =>
  new Date(Date.now() - agoMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

type Tx = Parameters<Parameters<typeof transaction>[1]>[0];
const asApp = <T>(
  work: (tx: Tx) => Promise<T>,
  options: { account?: string; apiKey?: string } = {},
) =>
  transaction(app, work, {
    account: options.account ?? null,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  });

/** What the run seeded. */
const seeded = {
  story: '',
  /** A listed story with no posts, pins or replies: the recount's own window can't reach it, only the IDs the stories step answered can. */
  bare: '',
  postIds: [] as string[],
  agentId: '',
};
/** What the database held before the run changed it, put back afterwards. */
const before = {
  testStories: false,
  job: null as Record<string, unknown> | null,
};

type Recorded = Partial<Record<StepName, StepAnswer>>;

/** The real steps, each recording what it answered (the summaries hold counts only). */
function recording(into: Recorded): Step[] {
  return STEPS.map((one) => ({
    name: one.name,
    run: async (context) => {
      const answer = await one.run(context);
      into[one.name] = answer;
      return answer;
    },
  }));
}

/** One run of the minute job on the real database, as the door runs it. */
async function runOnce(into: Recorded) {
  const deps = jobDeps();
  if (!deps) throw new Error('The database is not set up');
  return runMinute({ ...deps, run: framed(deps.run) }, recording(into));
}

/** The minute job's lease row, as it stands. */
async function lease() {
  const { rows } = await owner.query(
    "select run, lease_until, last_ok_started_at from social.job_runs where job = 'minute'",
  );
  return rows[0] as {
    run: string | null;
    lease_until: Date | null;
    last_ok_started_at: Date | null;
  };
}

async function storyCounts() {
  const { rows } = await owner.query(
    'select posts, replies, upvotes, pins, top_rank::text as top_rank from social.stories where story_id = $1',
    [seeded.story],
  );
  return rows[0] as Record<string, unknown>;
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
  vi.stubEnv('SOCIAL_JOBS_SECRET', SECRET);

  // What to put back, then a lease nobody holds and a window of ten minutes (a local database is not
  // rebuilt between runs, so the last run's marks may be anything).
  before.testStories = (await owner.query('select test_stories from social.environment')).rows[0]
    ?.test_stories as boolean;
  before.job =
    (
      await owner.query(
        "select run, lease_until, last_ok_started_at, last_ok_at from social.job_runs where job = 'minute'",
      )
    ).rows[0] ?? null;
  if (!before.job) throw new Error("social.job_runs has no row for the 'minute' job");
  await owner.query('update social.environment set test_stories = true');
  await owner.query(
    "update social.job_runs set run = null, lease_until = null, last_ok_started_at = now() - interval '10 minutes' where job = 'minute'",
  );

  const run = randomUUID().slice(0, 8);
  const admin = randomUUID();
  const ownerAccount = randomUUID();
  const email = `jobs-${run}@social-jobs.test`;
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())',
    [admin, `admin-${run}@social-jobs.test`, ownerAccount, email],
  );
  await owner.query("insert into private.admins (user_id, note) values ($1, 'A test admin')", [
    admin,
  ]);
  held.admin = { id: admin, email: `admin-${run}@social-jobs.test` };

  // A listed story, saved through the console's own path (the real router and handler).
  seeded.story = newRecordId();
  const consoleApi = createRouterClient(router, {
    context: {
      headers: new Headers(),
      url: 'https://staging.hrizzup.com/api/v1/admin/social/stories',
    },
  });
  const saved = await consoleApi.admin.social.stories.save({
    record: {
      format: 'story/1',
      id: seeded.story,
      title: `Jobs test ${run}: a story the console saved`,
      summary: 'What is happening in a story the minute job recounts.',
      locations: ['mumbai', 'india'],
      categories: ['ai'],
      state: 'live',
      created_at: iso(5),
      updated_at: iso(4),
    },
    listed: true,
  } as never);
  expect(saved).toMatchObject({ id: seeded.story, saved: 'new', listed: true });
  seeded.bare = newRecordId();
  const bare = await consoleApi.admin.social.stories.save({
    record: {
      format: 'story/1',
      id: seeded.bare,
      title: `Jobs test ${run}: a story nobody has posted on`,
      summary: 'What is happening in a story with no posts.',
      locations: ['india'],
      categories: ['sports'],
      state: 'live',
      created_at: iso(5),
      updated_at: iso(4),
    },
    listed: true,
  } as never);
  expect(bare).toMatchObject({ id: seeded.bare, saved: 'new', listed: true });

  // An agent, through the invite, registration and claim, and two posts it makes with its posting key.
  const codeHash = bytes();
  const claimHash = bytes();
  await asApp(
    (tx) =>
      tx.query(
        'select social.admin_create_invite($1, $2, null, false, true, $3::bytea, $4) as answer',
        [randomUUID(), email, codeHash, 'hz-aaaa'],
      ),
    { account: admin },
  );
  const registered = await asApp(async (tx) => {
    const { rows } = await tx.query(
      'select social.register_agent($1::bytea, $2, $3, $4, null, null, null, $5::bytea, $6, $7::bytea) as answer',
      [
        codeHash,
        randomUUID(),
        `jobs_${letters(8)}`,
        'Jobs Test Agent',
        bytes(),
        `hz_demo_${letters(4)}`,
        claimHash,
      ],
    );
    return rows[0]?.answer as { key: { id: string }; agent?: { id: string } };
  });
  await asApp(
    (tx) =>
      tx.query('select social.claim_agent($1, $2::bytea, $3) as answer', [
        randomUUID(),
        claimHash,
        'Jobs Test Owner',
      ]),
    { account: ownerAccount },
  );
  for (const body of ['The first take on the story', 'The second take on the story']) {
    const { rows } = await asApp(
      (tx) =>
        tx.query('select social.create_post($1, $2, $3, $4, null, null, null, null) as answer', [
          randomUUID(),
          seeded.story,
          'text',
          body,
        ]),
      { apiKey: registered.key.id },
    );
    const made = rows[0]?.answer as { id: string } | undefined;
    if (!made) throw new Error('The agent made no post');
    seeded.postIds.push(made.id);
  }
  const agent = await owner.query('select agent_id from social.posts where id = $1', [
    seeded.postIds[0],
  ]);
  seeded.agentId = String(agent.rows[0]?.agent_id);
  // The console's save purged what it changed; what this test checks is the job's own purge.
  held.invalidated.length = 0;
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  if (url && owner && before.job) {
    await owner.query('update social.environment set test_stories = $1', [before.testStories]);
    await owner.query(
      "update social.job_runs set run = $1, lease_until = $2, last_ok_started_at = $3, last_ok_at = $4 where job = 'minute'",
      [
        before.job.run,
        before.job.lease_until,
        before.job.last_ok_started_at,
        before.job.last_ok_at,
      ],
    );
  }
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

describe.skipIf(!url)('the three steps over the real functions', () => {
  const first: Recorded = {};
  const second: Recorded = {};
  let countsAfterFirst: Record<string, unknown>;

  it('runs the whole minute job clean: lists, recounts and purges what the console saved, and closes its lease', async () => {
    const answer = await runOnce(first);
    expect(answer).toMatchObject({ ran: true, ok: true });
    expect(answer).not.toHaveProperty('failed');
    expect(Object.keys((answer as { steps: object }).steps)).toEqual([
      'stories',
      'counts',
      'recount',
      'purge',
    ]);
    // The lease is closed (nobody holds it), and the good run's mark has moved on.
    expect(await lease()).toMatchObject({ run: null, lease_until: null });
  });

  it('answers the story it listed (the window reaches back, so others may be there too) and the posts moved by no merge', async () => {
    // The console's save is in `intake.saves` since the window began, so the stories step saw it.
    expect(first.stories?.ids?.stories).toContain(seeded.story);
    expect(first.stories?.ids?.stories).toContain(seeded.bare);
    expect(first.stories?.ids?.posts).toEqual(expect.any(Array));
    // The summary names IDs and counts only.
    expect(first.stories?.summary).toMatchObject({
      counts: { stories: expect.any(Number), posts: expect.any(Number) },
    });
  });

  it('recounts the story, both its posts and their agent, exactly, and marks the board and the directory', async () => {
    const ids = first.recount?.ids;
    expect(ids?.stories).toContain(seeded.story);
    // A story with no posts is in no window of the recount's own: it is here because the stories step
    // answered it and the recount was given it (`also`).
    expect(ids?.stories).toContain(seeded.bare);
    for (const post of seeded.postIds) expect(ids?.posts).toContain(post);
    expect(ids?.agents).toContain(seeded.agentId);
    expect(first.recount?.data).toEqual({ board: true, directory: true });
    // Exact counts, from the rows: two posts on the story.
    countsAfterFirst = await storyCounts();
    expect(countsAfterFirst).toMatchObject({ posts: 2, replies: 0, upvotes: 0, pins: 0 });
    expect(first.recount?.summary).toMatchObject({
      counts: {
        stories: first.recount?.ids?.stories?.length,
        posts: first.recount?.ids?.posts?.length,
        agents: first.recount?.ids?.agents?.length,
      },
      board: true,
      directory: true,
    });
  });

  it('purges the tags of what the recount answered, the board’s and the directory’s among them, and nothing else', async () => {
    const plan = purgePlan({
      stories: first.recount?.ids?.stories,
      posts: first.recount?.ids?.posts,
      agents: first.recount?.ids?.agents,
      board: true,
      directory: true,
    });
    expect(plan.overflow).toBe(false);
    const purged = held.invalidated.flat();
    expect(new Set(purged)).toEqual(new Set(plan.tags));
    expect(purged).toHaveLength(new Set(purged).size);
    for (const tag of [
      `social:story:${seeded.story}`,
      `social:desk:${seeded.story}`,
      `social:story:${seeded.bare}`,
      `social:desk:${seeded.bare}`,
      `social:post:${seeded.postIds[0]}`,
      `social:post:${seeded.postIds[1]}`,
      `social:agent:${seeded.agentId}`,
      'social:board',
      'social:agents',
    ]) {
      expect(purged, tag).toContain(tag);
    }
    // Calls of at most 16 tags, as many as the tags need.
    expect(held.invalidated.every((call) => call.length <= 16)).toBe(true);
    expect(held.invalidated).toHaveLength(Math.ceil(plan.tags.length / 16));
    expect(first.purge?.summary).toEqual({
      briefs: first.recount?.ids?.stories?.length,
      tags: plan.tags.length,
      calls: held.invalidated.length,
      failed: 0,
      late: 0,
      overflow: false,
    });
  });

  it('a second run with nothing new recounts nothing new: what it recounts, the first did, and the counts stand', async () => {
    held.invalidated.length = 0;
    const answer = await runOnce(second);
    expect(answer).toMatchObject({ ran: true, ok: true });
    // The window overlaps the last run's by its 2 minutes, so the story is in it again; nothing in it is new.
    for (const kind of ['stories', 'posts', 'agents'] as const) {
      const again = second.recount?.ids?.[kind] ?? [];
      const known = new Set(first.recount?.ids?.[kind] ?? []);
      expect(
        again.filter((id) => !known.has(id)),
        kind,
      ).toEqual([]);
    }
    expect(second.recount?.ids?.stories).toContain(seeded.story);
    expect(await storyCounts()).toEqual(countsAfterFirst);
  });

  it('through the door, once the window has moved past everything: nothing is listed, recounted or purged', async () => {
    held.invalidated.length = 0;
    // Time passing: the window starts 2 minutes before the last good run, so push the mark past the 2 minutes.
    await owner.query(
      "update social.job_runs set last_ok_started_at = clock_timestamp() + interval '5 minutes' where job = 'minute'",
    );
    const response = await POST(
      new Request('https://staging.hrizzup.com/api/jobs/social?job=minute', {
        method: 'POST',
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = (await response.json()) as {
      ran: boolean;
      ok: boolean;
      runId: string;
      steps: Record<string, Record<string, unknown>>;
    };
    expect(body).toMatchObject({ ran: true, ok: true });
    expect(body.steps.stories).toEqual({
      counts: { stories: 0, posts: 0 },
      sample: { stories: [], posts: [] },
    });
    expect(body.steps.counts).toEqual({});
    expect(body.steps.recount).toEqual({
      counts: { stories: 0, posts: 0, agents: 0 },
      board: false,
      directory: false,
    });
    expect(body.steps.purge).toEqual({
      briefs: 0,
      tags: 0,
      calls: 0,
      failed: 0,
      late: 0,
      overflow: false,
    });
    expect(held.invalidated).toEqual([]);
    expect(await lease()).toMatchObject({ run: null, lease_until: null });
  });

  it('through the door, while another run holds the lease: 200 busy, and nothing is done', async () => {
    held.invalidated.length = 0;
    await owner.query(
      "update social.job_runs set run = gen_random_uuid(), lease_until = now() + interval '1 minute' where job = 'minute'",
    );
    try {
      const response = await POST(
        new Request('https://staging.hrizzup.com/api/jobs/social?job=minute', {
          method: 'POST',
          headers: { authorization: `Bearer ${SECRET}` },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ran: false, busy: true });
      expect(held.invalidated).toEqual([]);
      // The run that holds the lease is left holding it.
      expect((await lease()).run).not.toBeNull();
    } finally {
      await owner.query(
        "update social.job_runs set run = null, lease_until = null where job = 'minute'",
      );
    }
  });

  it('through the door, for the jobs not built yet: 404, as an address the site does not have', async () => {
    for (const job of ['counts', 'skills']) {
      const response = await POST(
        new Request(`https://staging.hrizzup.com/api/jobs/social?job=${job}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${SECRET}` },
          body: '{}',
        }),
      );
      expect(response.status, job).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND', message: 'No such call' });
    }
  });
});
